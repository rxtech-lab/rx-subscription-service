"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TestOutline } from "@/lib/testing/protocol";
import type { RunSnapshot } from "@/lib/testing/runs";

/**
 * Follow a run from anywhere.
 *
 * Both the Test cases tab and the card in the assistant chat use this, and the
 * only thing either needs to supply is a run id.
 *
 * Progress is polled. A run outlives the request that started it and may be
 * opened long after it finished, so the endpoint replays every event after a
 * sequence number rather than streaming only what happens next; that makes
 * "watching live" and "reading history" the same code path.
 *
 * A caller that already holds the run — the suite page and the assistant panel
 * both read theirs on the server — passes it as `initial`. A run that had
 * already finished by then is drawn from that snapshot alone: no execute
 * request, no polling, no empty first frame that reads as the suite starting
 * over. A run still in flight is followed exactly as before.
 */

const POLL_INTERVAL_MS = 700;

export interface CaseState {
  suiteName: string;
  name: string;
  status: "running" | "passed" | "failed" | "skipped";
  position: number;
  durationMs: number | null;
  error: string | null;
  steps: { name: string; status: string; durationMs: number | null }[];
}

export interface RunState {
  id: string;
  suiteId: string;
  status: "queued" | "running" | "passed" | "failed" | "error" | "canceled";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface TestRunView {
  run: RunState | null;
  cases: CaseState[];
  /** The suites and tests the run itself reported, once it has started. */
  outline: TestOutline | null;
  logs: { stream: "stdout" | "stderr"; message: string }[];
  /** The step currently executing, for the node the diagram should pulse. */
  activeStep: { suite: string; test: string; step: string } | null;
  done: boolean;
  /** A transport failure, distinct from a run that failed on its merits. */
  loadError: string | null;
}

const EMPTY: TestRunView = {
  run: null,
  cases: [],
  outline: null,
  logs: [],
  activeStep: null,
  done: false,
  loadError: null,
};

/**
 * Keeps a run's last client-side view across card unmounts.
 *
 * Closing the assistant unmounts its transcript. Without this small cache, a
 * run created after the page's server snapshot would replay its entire event
 * log every time the assistant reopened. Run ids are globally unique; the cap
 * only bounds a long-lived tab's memory.
 */
const RUN_VIEW_CACHE_LIMIT = 100;
const runViewCache = new Map<string, { view: TestRunView; cursor: number }>();

function remember(runId: string, view: TestRunView, cursor: number) {
  runViewCache.delete(runId);
  runViewCache.set(runId, { view, cursor });
  const oldest = runViewCache.keys().next().value as string | undefined;
  if (runViewCache.size > RUN_VIEW_CACHE_LIMIT && oldest) runViewCache.delete(oldest);
}

interface EventEnvelope {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

interface RunPayload {
  run: RunState;
  cases: CaseState[];
  events: EventEnvelope[];
  done: boolean;
}

/** Fold one batch of events into the view. Shared by the seed and every poll. */
function apply(previous: TestRunView, data: RunPayload): TestRunView {
  return {
    run: data.run,
    cases: data.cases,
    outline: extractOutline(data.events) ?? previous.outline,
    logs: [...previous.logs, ...extractLogs(data.events)].slice(-300),
    activeStep: latestStep(data.events) ?? previous.activeStep,
    done: data.done,
    loadError: null,
  };
}

function seed(runId: string | null, initial?: RunSnapshot | null) {
  // A snapshot of some *other* run is stale the moment Run is pressed.
  if (!runId) return { view: EMPTY, cursor: -1 };
  if (initial?.run.id === runId) {
    const seeded = {
      view: apply(EMPTY, initial),
      cursor: initial.events.reduce((high, event) => Math.max(high, event.seq), -1),
    };
    remember(runId, seeded.view, seeded.cursor);
    return seeded;
  }
  return runViewCache.get(runId) ?? { view: EMPTY, cursor: -1 };
}

export function useTestRun(
  runId: string | null,
  options: { initial?: RunSnapshot | null } = {},
): TestRunView {
  const { initial } = options;
  const [view, setView] = useState<TestRunView>(() => seed(runId, initial).view);
  const cursor = useRef(seed(runId, initial).cursor);
  const executed = useRef<string | null>(null);

  // The snapshot is a server prop, so it is a new object on every refresh; only
  // its run id decides whether it applies, and that is what the effect reads.
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const reset = useCallback(() => {
    cursor.current = -1;
    setView(EMPTY);
  }, []);

  useEffect(() => {
    if (!runId) {
      reset();
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const seeded = seed(runId, initialRef.current);
    cursor.current = seeded.cursor;
    setView(seeded.view);

    // A run that was already over when the page was rendered is complete as it
    // stands: nothing to start, nothing to follow.
    if (seeded.view.done) return;

    /**
     * Ask for the run to be executed, but only when it could actually be.
     *
     * Only a queued run can be claimed, so that is the only status worth a
     * request. Asking regardless — as this used to — meant a replayed chat
     * transcript fired one POST per run card every time the panel was opened,
     * each of them a no-op that nonetheless looked, in the log and on screen,
     * like the suite starting over.
     */
    const ensureStarted = (status: RunState["status"]) => {
      if (status !== "queued" || executed.current === runId) return;
      executed.current = runId;
      void fetch(`/api/testing/runs/${runId}/execute`, { method: "POST" }).catch(
        () => {},
      );
    };

    // A run the page handed over as queued needs no round trip to establish it.
    if (seeded.view.run) ensureStarted(seeded.view.run.status);

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/testing/runs/${runId}/events?after=${cursor.current}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`Could not read the run (${response.status})`);

        const data = (await response.json()) as RunPayload;
        if (cancelled) return;

        for (const event of data.events) cursor.current = Math.max(cursor.current, event.seq);

        setView((previous) => {
          const next = apply(previous, data);
          remember(runId, next, cursor.current);
          return next;
        });
        ensureStarted(data.run.status);

        if (!data.done && !cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        setView((previous) => ({
          ...previous,
          loadError: error instanceof Error ? error.message : "Could not read the run",
        }));
        timer = setTimeout(poll, POLL_INTERVAL_MS * 3);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, reset]);

  return view;
}

function extractOutline(events: EventEnvelope[]): TestOutline | null {
  const start = events.find((event) => event.type === "run:start");
  if (!start) return null;
  const outline = start.payload.outline;
  return Array.isArray(outline) ? (outline as TestOutline) : null;
}

function extractLogs(events: EventEnvelope[]) {
  return events
    .filter((event) => event.type === "log" || event.type === "error")
    .map((event) => ({
      stream:
        event.type === "error" || event.payload.stream === "stderr"
          ? ("stderr" as const)
          : ("stdout" as const),
      message: String(event.payload.message ?? ""),
    }));
}

function latestStep(events: EventEnvelope[]) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== "step") continue;
    return {
      suite: String(event.payload.suite ?? ""),
      test: String(event.payload.test ?? ""),
      step: String(event.payload.step ?? ""),
    };
  }
  return null;
}
