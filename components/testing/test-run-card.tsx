"use client";

import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import Link from "next/link";
import type { TestOutline } from "@/lib/testing/protocol";
import type { RunSnapshot } from "@/lib/testing/runs";
import { cn } from "@/lib/utils";
import { WorkflowDiagram } from "./workflow-diagram";
import { useTestRun, type TestRunView } from "./use-test-run";

/**
 * One run, rendered as a card.
 *
 * The assistant chat and the Test cases tab show the same component: a run
 * triggered from chat is not a different kind of run, and watching it should
 * not look like a different feature. `compact` only trims the chrome for the
 * narrower panel.
 *
 * Drawing and following are separate — `TestRunCardView` takes a view, and
 * `TestRunCard` fetches one — because the suite editor already follows the run
 * for its output panel. One `useTestRun` per run means one poll loop, not one
 * per component that happens to show it.
 */

function summaryTone(status: string) {
  if (status === "passed") return "border-emerald-200 bg-emerald-50/70";
  if (status === "failed" || status === "error") return "border-rose-200 bg-rose-50/70";
  return "border-slate-200 bg-slate-50/70";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "passed") {
    return <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />;
  }
  if (status === "failed") {
    return <XCircle className="size-4 text-rose-600" aria-hidden="true" />;
  }
  if (status === "error") {
    return <AlertTriangle className="size-4 text-rose-600" aria-hidden="true" />;
  }
  return <Loader2 className="size-4 animate-spin text-blue-600" aria-hidden="true" />;
}

function headline(view: TestRunView, suiteName?: string): string {
  const run = view.run;
  const name = suiteName ?? "Test run";
  if (!run) return `${name} — starting…`;
  if (run.status === "queued") return `${name} — queued`;
  if (run.status === "running") {
    const done = view.cases.filter((entry) => entry.status !== "running").length;
    return run.total > 0
      ? `${name} — running ${done}/${run.total}`
      : `${name} — running`;
  }
  if (run.status === "error") return `${name} — could not run`;
  return `${name} — ${run.passed} passed, ${run.failed} failed${
    run.skipped > 0 ? `, ${run.skipped} skipped` : ""
  }`;
}

/** Follows the run itself. For a caller that already has a view, see below. */
export function TestRunCard({
  runId,
  initial,
  ...rest
}: Omit<TestRunCardViewProps, "view"> & {
  runId: string;
  /** A run already read on the server, so a finished one needs no request. */
  initial?: RunSnapshot | null;
}) {
  const view = useTestRun(runId, { initial });
  return <TestRunCardView view={view} {...rest} />;
}

interface TestRunCardViewProps {
  view: TestRunView;
  suiteName?: string;
  /** When given, the card links through to the suite in the console. */
  applicationId?: string;
  compact?: boolean;
  /**
   * Offered where the card occupies a panel that has something else to show —
   * the editor's workflow diagram. The chat has no such fallback, so it omits
   * this and keeps the run as part of the transcript.
   */
  onDismiss?: () => void;
  /**
   * Shown until the run reports the suites it collected. The editor knows the
   * shape of the file already, so there is no reason for the panel to go blank
   * for the second it takes a sandbox to boot.
   */
  outlineFallback?: TestOutline;
}

export function TestRunCardView({
  view,
  suiteName,
  applicationId,
  compact = false,
  outlineFallback,
  onDismiss,
}: TestRunCardViewProps) {
  const run = view.run;
  const status = run?.status ?? "queued";
  const failures = view.cases.filter((entry) => entry.status === "failed");
  const outline = view.outline ?? outlineFallback ?? [];

  return (
    <div className={cn("rounded-xl border", summaryTone(status))}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <span className="mt-0.5">
          <StatusIcon status={status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-900">
            {headline(view, suiteName)}
          </p>
          {run?.durationMs != null ? (
            <p className="text-[11px] tabular-nums text-slate-500">
              {(run.durationMs / 1000).toFixed(1)}s
            </p>
          ) : null}
          {run?.error ? (
            <p className="mt-1 text-[11px] leading-4 text-rose-700">{run.error}</p>
          ) : null}
          {view.loadError ? (
            <p className="mt-1 text-[11px] leading-4 text-amber-700">{view.loadError}</p>
          ) : null}
        </div>

        {applicationId && run ? (
          <Link
            href={`/apps/${applicationId}/test/cases/${run.suiteId}?run=${run.id}`}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-white hover:text-slate-900"
          >
            Open
          </Link>
        ) : null}

        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss this run"
            className="-mr-1 shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-slate-900"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {outline.length > 0 ? (
        <div
          className={cn(
            "border-t border-white/60 bg-white/60 px-3 py-2.5",
            compact && "max-h-80 overflow-y-auto",
          )}
        >
          <WorkflowDiagram
            outline={outline}
            cases={view.cases}
            activeStep={view.activeStep}
          />
        </div>
      ) : null}

      {/* Only where the diagram is scroll-capped. In a full-height panel every
          failure is already visible on its own node, and repeating them just
          makes the card twice as long. */}
      {compact && view.done && failures.length > 0 ? (
        <div className="border-t border-white/60 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
            Failures
          </p>
          <ul className="mt-1 space-y-1">
            {failures.map((entry) => (
              <li key={entry.position} className="text-[11px] leading-4 text-slate-700">
                <span className="font-medium">{entry.name}</span>
                {entry.error ? (
                  <span className="text-rose-700"> — {entry.error}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
