import { authorizeRun } from "@/lib/testing/access";
import { readRunSnapshot } from "@/lib/testing/runs";

/**
 * Everything a viewer needs to draw a run, from any point in its life.
 *
 * Progress is polled rather than streamed. A run outlives the request that
 * started it and can be watched from two places at once — the tab and the chat
 * card — so "replay everything after sequence N" is the shape that actually
 * fits: a viewer that arrives late, reloads, or opens a finished run gets the
 * identical sequence of events as one that watched it live.
 *
 * The suite page renders the same snapshot on the server, so this endpoint is
 * only reached for a run that is still moving.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const access = await authorizeRun(runId);
  if (!access.ok) {
    return Response.json({ error: "forbidden" }, { status: access.status });
  }

  const after = Number(new URL(request.url).searchParams.get("after") ?? "-1");
  const snapshot = await readRunSnapshot(
    access.applicationId,
    runId,
    Number.isFinite(after) ? after : -1,
  );

  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
