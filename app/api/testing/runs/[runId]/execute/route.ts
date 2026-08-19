import { authorizeRun } from "@/lib/testing/access";
import { executeRun } from "@/lib/testing/runner";

/** A run may take minutes; this request is alive for as long as it does. */
export const maxDuration = 300;

/**
 * Execute a queued run.
 *
 * Starting a run and watching it are separate on purpose: the server action
 * creates the row and returns immediately, and whoever displays the run — the
 * Test cases tab, or the card in the assistant chat — asks for it to be
 * executed. Both can ask, and a reload asks again; `executeRun` claims the row
 * with a conditional update, so every caller after the first is a no-op and
 * follows the same event log.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const access = await authorizeRun(runId);
  if (!access.ok) {
    return Response.json({ error: "forbidden" }, { status: access.status });
  }

  await executeRun(runId);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
