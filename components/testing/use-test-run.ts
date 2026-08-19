"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TestOutline } from "@/lib/testing/protocol";

/**
 * Follow a run from anywhere.
 *
 * Both the Test cases tab and the card in the assistant chat use this, and the
 * only thing either needs to supply is a run id. Mounting is what starts the
 * run: the execute request is idempotent, so two viewers — or a reload — cost
 * nothing beyond a duplicate no-op request.
 *
 * Progress is polled. A run outlives the request that started it and may be
 * opened long after it finished, so the endpoint replays every event after a
 * sequence number rather than streaming only what happens next; that makes
 * "watching live" and "reading history" the same code path.
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

interface EventEnvelope {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

export function useTestRun(runId: string | null): TestRunView {
  const [view, setView] = useState<TestRunView>(EMPTY);
  const cursor = useRef(-1);
  const executed = useRef<string | null>(null);

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
    cursor.current = -1;
    setView(EMPTY);

    // Asking twice is harmless — the run is claimed with a conditional update —
    // but asking once per mounted viewer is enough.
    if (executed.current !== runId) {
      executed.current = runId;
      void fetch(`/api/testing/runs/${runId}/execute`, { method: "POST" }).catch(
        () => {},
      );
    }

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/testing/runs/${runId}/events?after=${cursor.current}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`Could not read the run (${response.status})`);

        const data = (await response.json()) as {
          run: RunState;
          cases: CaseState[];
          events: EventEnvelope[];
          done: boolean;
        };
        if (cancelled) return;

        for (const event of data.events) cursor.current = Math.max(cursor.current, event.seq);

        setView((previous) => ({
          run: data.run,
          cases: data.cases,
          outline: extractOutline(data.events) ?? previous.outline,
          logs: [...previous.logs, ...extractLogs(data.events)].slice(-300),
          activeStep: latestStep(data.events) ?? previous.activeStep,
          done: data.done,
          loadError: null,
        }));

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
