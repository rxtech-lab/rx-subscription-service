import { authorizeRun } from "@/lib/testing/access";
import { RUN_TIMEOUT_MS } from "@/lib/testing/runner";
import {
  isTerminal,
  listRunEvents,
  reconcileStaleRun,
  requireRun,
} from "@/lib/testing/runs";

/**
 * Everything a viewer needs to draw a run, from any point in its life.
 *
 * Progress is polled rather than streamed. A run outlives the request that
 * started it and can be watched from two places at once — the tab and the chat
 * card — so "replay everything after sequence N" is the shape that actually
 * fits: a viewer that arrives late, reloads, or opens a finished run gets the
 * identical sequence of events as one that watched it live.
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
  const { run, cases } = await requireRun(access.applicationId, runId);
  const status = await reconcileStaleRun(run, RUN_TIMEOUT_MS + 60_000);
  const events = await listRunEvents(runId, Number.isFinite(after) ? after : -1);

  return Response.json(
    {
      run: {
        id: run.id,
        suiteId: run.suiteId,
        status,
        trigger: run.trigger,
        total: run.total,
        passed: run.passed,
        failed: run.failed,
        skipped: run.skipped,
        durationMs: run.durationMs,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      },
      cases: cases.map((entry) => ({
        suiteName: entry.suiteName,
        name: entry.name,
        status: entry.status,
        position: entry.position,
        durationMs: entry.durationMs,
        error: entry.error,
        steps: entry.steps,
      })),
      events,
      done: isTerminal(status),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
