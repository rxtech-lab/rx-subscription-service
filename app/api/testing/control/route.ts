import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { testRuns } from "@/lib/db/schema";
import { isControlOp, runControlOp } from "@/lib/testing/control";
import { isTerminal } from "@/lib/testing/runs";
import { verifyControlToken } from "@/lib/testing/token";

export const maxDuration = 60;

/**
 * The callback surface for a suite running in a sandbox.
 *
 * Three things have to be true before an operation runs, and all three are
 * checked here rather than trusted from the request body: the bearer token has
 * to verify, the run it names has to still be in flight, and the operation has
 * to be one of the declared ops. `applicationId` comes from the token's claims,
 * never from the payload, so a suite cannot address another application even
 * though it controls every byte it sends.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const claims = token ? await verifyControlToken(token) : null;
  if (!claims) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }

  // A token outlives its run by up to its TTL. Refusing finished runs keeps a
  // leaked token from being replayed against the application afterwards.
  const [run] = await db
    .select({ status: testRuns.status, applicationId: testRuns.applicationId })
    .from(testRuns)
    .where(eq(testRuns.id, claims.runId))
    .limit(1);
  if (!run || run.applicationId !== claims.applicationId) {
    return Response.json({ error: "unknown_run" }, { status: 401 });
  }
  if (isTerminal(run.status)) {
    return Response.json({ error: "run_finished" }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as {
    op?: string;
    args?: unknown;
  } | null;
  if (!body?.op || !isControlOp(body.op)) {
    return Response.json(
      { error: "unknown_op", error_description: `No such operation: ${body?.op}` },
      { status: 400 },
    );
  }

  try {
    const result = await runControlOp({
      applicationId: claims.applicationId,
      op: body.op,
      args: body.args,
      // Audit rows point back at the run that caused them.
      actor: { type: "system", id: `test_run:${claims.runId}` },
    });
    return Response.json(result ?? {}, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "ValidationError" || name === "NotFoundError") {
      return Response.json(
        {
          error: name === "NotFoundError" ? "not_found" : "invalid_request",
          error_description: (error as Error).message,
        },
        { status: name === "NotFoundError" ? 404 : 400 },
      );
    }
    console.error(`Test control op ${body.op} failed:`, error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
