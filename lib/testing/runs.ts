import "server-only";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { testRunCases, testRunEvents, testRuns } from "@/lib/db/schema";
import { newId, NotFoundError } from "@/lib/subscription/shared";
import type { RunEvent, TestOutline } from "./protocol";

/**
 * Run state, derived entirely from the event log.
 *
 * Events are appended as they arrive and *also* folded into the `test_runs` and
 * `test_run_cases` rows. The duplication is deliberate: the fold gives the list
 * view an O(1) answer to "did this suite pass", while the log lets a viewer that
 * connects halfway through — or after the run finished — replay the whole thing
 * instead of joining a stream it cannot rewind.
 */

export async function createRun(input: {
  applicationId: string;
  suiteId: string;
  code: string;
  trigger: "console" | "ai";
  triggeredBy: string | null;
  conversationId?: string | null;
  driver: string;
}) {
  const [row] = await db
    .insert(testRuns)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      suiteId: input.suiteId,
      code: input.code,
      status: "queued",
      trigger: input.trigger,
      triggeredBy: input.triggeredBy,
      conversationId: input.conversationId ?? null,
      driver: input.driver,
      startedAt: new Date(),
    })
    .returning();
  return row;
}

/**
 * Append one event and apply what it implies.
 *
 * The sequence number is supplied by the caller rather than derived from
 * `max(seq) + 1` here. A run emits its lines in bursts — a chunk of stdout can
 * carry a dozen at once — and deriving the number per call makes it a
 * read-modify-write that two concurrent appends both win, colliding on the
 * unique `(run_id, seq)` index. `executeRun` owns a counter instead, which is
 * sound because claiming a run guarantees exactly one executor.
 */
export async function recordEvent(
  runId: string,
  event: RunEvent,
  seq: number,
): Promise<void> {
  const now = new Date();

  await db.insert(testRunEvents).values({
    id: newId(),
    runId,
    seq,
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
    createdAt: now,
  });

  switch (event.type) {
    case "run:start": {
      await db
        .update(testRuns)
        .set({ status: "running", total: countOutline(event.outline) })
        .where(eq(testRuns.id, runId));
      break;
    }

    case "test:start": {
      await db.insert(testRunCases).values({
        id: newId(),
        runId,
        suiteName: event.suite,
        name: event.test,
        status: "running",
        position: event.position,
        steps: [],
        startedAt: now,
      });
      break;
    }

    case "test:end": {
      const existing = await db
        .select({ id: testRunCases.id })
        .from(testRunCases)
        .where(
          and(eq(testRunCases.runId, runId), eq(testRunCases.position, event.position)),
        )
        .limit(1);

      const values = {
        status: event.status,
        durationMs: event.durationMs,
        error: event.error,
        steps: event.steps,
      };

      if (existing.length > 0) {
        await db
          .update(testRunCases)
          .set(values)
          .where(eq(testRunCases.id, existing[0].id));
      } else {
        // A skipped test never emits `test:start`.
        await db.insert(testRunCases).values({
          id: newId(),
          runId,
          suiteName: event.suite,
          name: event.test,
          position: event.position,
          startedAt: now,
          ...values,
        });
      }
      break;
    }

    case "run:end": {
      await db
        .update(testRuns)
        .set({
          status: event.failed > 0 ? "failed" : "passed",
          total: event.total,
          passed: event.passed,
          failed: event.failed,
          skipped: event.skipped,
          durationMs: event.durationMs,
          finishedAt: now,
        })
        .where(eq(testRuns.id, runId));
      break;
    }

    case "error": {
      // A harness-level error is terminal; `failRun` records the final state.
      break;
    }
  }
}

function countOutline(outline: TestOutline): number {
  return outline.reduce((total, suite) => total + suite.tests.length, 0);
}

/** Mark a run that could not complete — a crash, a timeout, a missing sandbox. */
export async function failRun(runId: string, message: string): Promise<void> {
  const [run] = await db
    .select({ status: testRuns.status })
    .from(testRuns)
    .where(eq(testRuns.id, runId))
    .limit(1);
  // `run:end` already settled it; a late stderr line must not undo that.
  if (run && (run.status === "passed" || run.status === "failed")) return;

  await db
    .update(testRuns)
    .set({ status: "error", error: message, finishedAt: new Date() })
    .where(eq(testRuns.id, runId));
}

export async function getRun(applicationId: string, runId: string) {
  const [run] = await db
    .select()
    .from(testRuns)
    .where(and(eq(testRuns.id, runId), eq(testRuns.applicationId, applicationId)))
    .limit(1);
  if (!run) return null;

  const cases = await db
    .select()
    .from(testRunCases)
    .where(eq(testRunCases.runId, runId))
    .orderBy(asc(testRunCases.position));

  return { run, cases };
}

export async function requireRun(applicationId: string, runId: string) {
  const found = await getRun(applicationId, runId);
  if (!found) throw new NotFoundError("test run", runId);
  return found;
}

/** Events after `afterSeq`, for a viewer catching up or following along. */
export async function listRunEvents(runId: string, afterSeq: number) {
  return db
    .select({
      seq: testRunEvents.seq,
      type: testRunEvents.type,
      payload: testRunEvents.payload,
    })
    .from(testRunEvents)
    .where(and(eq(testRunEvents.runId, runId), gt(testRunEvents.seq, afterSeq)))
    .orderBy(asc(testRunEvents.seq))
    .limit(500);
}

export async function listRuns(
  applicationId: string,
  options: { suiteId?: string; limit?: number } = {},
) {
  const where = options.suiteId
    ? and(
        eq(testRuns.applicationId, applicationId),
        eq(testRuns.suiteId, options.suiteId),
      )
    : eq(testRuns.applicationId, applicationId);

  return db
    .select({
      id: testRuns.id,
      suiteId: testRuns.suiteId,
      status: testRuns.status,
      trigger: testRuns.trigger,
      total: testRuns.total,
      passed: testRuns.passed,
      failed: testRuns.failed,
      skipped: testRuns.skipped,
      durationMs: testRuns.durationMs,
      error: testRuns.error,
      startedAt: testRuns.startedAt,
      finishedAt: testRuns.finishedAt,
    })
    .from(testRuns)
    .where(where)
    .orderBy(desc(testRuns.startedAt))
    .limit(Math.min(options.limit ?? 20, 100));
}

/** Whether a run has settled, so a follower knows to stop polling. */
export function isTerminal(status: string): boolean {
  return status === "passed" || status === "failed" || status === "error" || status === "canceled";
}

/**
 * Settle a run that stopped reporting.
 *
 * The process executing a run can disappear without a word — the platform
 * reclaims the function, the sandbox is killed, the browser tab that triggered
 * it is closed mid-flight. Nothing would then ever write a terminal status, and
 * the tab would show a spinner forever. Any run still open well past the point
 * where it could legitimately still be running is therefore closed on read.
 */
export async function reconcileStaleRun(
  run: { id: string; status: string; startedAt: Date },
  timeoutMs: number,
): Promise<string> {
  if (isTerminal(run.status)) return run.status;
  if (Date.now() - run.startedAt.getTime() < timeoutMs) return run.status;

  const message = "The run stopped reporting and was marked as failed.";
  await db
    .update(testRuns)
    .set({ status: "error", error: message, finishedAt: new Date() })
    .where(eq(testRuns.id, run.id));
  return "error";
}
