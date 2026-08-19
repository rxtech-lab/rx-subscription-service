import "server-only";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { testRunCases, testRunEvents, testRuns } from "@/lib/db/schema";
import { newId, NotFoundError } from "@/lib/subscription/shared";
import type { RunEvent, TestOutline } from "./protocol";

/** A whole suite, not one test — the harness enforces its own per-test limit. */
export const RUN_TIMEOUT_MS = 4 * 60_000;

/**
 * How long a run may go without reporting before it is declared dead.
 *
 * Its own timeout plus enough slack that a run finishing at the wire is not
 * mistaken for one that never will.
 */
const STALE_AFTER_MS = RUN_TIMEOUT_MS + 60_000;

/** As many events as one read returns — a run is a few dozen, not a stream. */
const EVENT_PAGE_SIZE = 500;

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
    .limit(EVENT_PAGE_SIZE);
}

export type RunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "error"
  | "canceled";

export type CaseStatus = "running" | "passed" | "failed" | "skipped";

/**
 * Everything a viewer needs to draw a run, as one value.
 *
 * This is the shape the events endpoint returns, which is the point: the suite
 * page renders it straight into the initial HTML, so reopening a suite paints
 * the stored result immediately rather than showing an empty panel that fills
 * in once the first poll lands. A finished run should look like something being
 * read, not something being started.
 */
export interface RunSnapshot {
  run: {
    id: string;
    suiteId: string;
    status: RunStatus;
    trigger: string;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  };
  cases: {
    suiteName: string;
    name: string;
    status: CaseStatus;
    position: number;
    durationMs: number | null;
    error: string | null;
    steps: { name: string; status: string; durationMs: number | null }[];
  }[];
  events: { seq: number; type: string; payload: Record<string, unknown> }[];
  done: boolean;
}

function toSnapshot(
  run: typeof testRuns.$inferSelect,
  status: RunStatus,
  cases: (typeof testRunCases.$inferSelect)[],
  events: RunSnapshot["events"],
): RunSnapshot {
  return {
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
      // Serialized here rather than at each caller: the API route hands this to
      // `Response.json` and the page hands it to a client component, and only
      // one of those would turn a `Date` into a string on its own.
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
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
  };
}

export async function readRunSnapshot(
  applicationId: string,
  runId: string,
  afterSeq = -1,
): Promise<RunSnapshot> {
  const { run, cases } = await requireRun(applicationId, runId);
  const status = await reconcileStaleRun(run, STALE_AFTER_MS);
  const events = await listRunEvents(runId, afterSeq);
  return toSnapshot(run, status, cases, events);
}

/**
 * Snapshots for a set of runs, keyed by id.
 *
 * Read in three queries rather than three per run: this runs while an
 * application layout renders, which is a place that has to stay cheap. The
 * transcript already contains every card we are reading, so every referenced
 * run is seeded — otherwise opening a long history would still fan out one
 * request per older card. Only the `run:start` event is needed here: it carries
 * the workflow outline, while the durable case rows carry the finished result.
 *
 * An id that no longer resolves — another application's run, or one deleted
 * with its suite — is simply absent, and its card falls back to asking for
 * itself.
 */
export async function readRunSnapshots(
  applicationId: string,
  runIds: string[],
): Promise<Record<string, RunSnapshot>> {
  const wanted = [...new Set(runIds)];
  if (wanted.length === 0) return {};

  const runs = await db
    .select()
    .from(testRuns)
    .where(and(eq(testRuns.applicationId, applicationId), inArray(testRuns.id, wanted)));
  if (runs.length === 0) return {};

  const ids = runs.map((run) => run.id);
  const cases = await db
    .select()
    .from(testRunCases)
    .where(inArray(testRunCases.runId, ids))
    .orderBy(asc(testRunCases.runId), asc(testRunCases.position));
  const events = await db
    .select({
      runId: testRunEvents.runId,
      seq: testRunEvents.seq,
      type: testRunEvents.type,
      payload: testRunEvents.payload,
    })
    .from(testRunEvents)
    .where(
      and(
        inArray(testRunEvents.runId, ids),
        eq(testRunEvents.type, "run:start"),
      ),
    )
    .orderBy(asc(testRunEvents.runId), asc(testRunEvents.seq));

  const casesByRun = groupBy(cases, (entry) => entry.runId);
  const eventsByRun = groupBy(events, (entry) => entry.runId);

  const snapshots: Record<string, RunSnapshot> = {};
  for (const run of runs) {
    const status = await reconcileStaleRun(run, STALE_AFTER_MS);
    snapshots[run.id] = toSnapshot(
      run,
      status,
      casesByRun.get(run.id) ?? [],
      (eventsByRun.get(run.id) ?? []).map(({ seq, type, payload }) => ({
        seq,
        type,
        payload,
      })),
    );
  }
  return snapshots;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
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
  run: { id: string; status: RunStatus; startedAt: Date },
  timeoutMs: number,
): Promise<RunStatus> {
  if (isTerminal(run.status)) return run.status;
  if (Date.now() - run.startedAt.getTime() < timeoutMs) return run.status;

  const message = "The run stopped reporting and was marked as failed.";
  await db
    .update(testRuns)
    .set({ status: "error", error: message, finishedAt: new Date() })
    .where(eq(testRuns.id, run.id));
  return "error";
}
