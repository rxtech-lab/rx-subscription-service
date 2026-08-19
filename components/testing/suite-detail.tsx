"use client";

import { ChevronDown, Loader2, Play, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveTestSuiteAction, startTestRunAction } from "@/app/actions/test-cases";
import { Button } from "@/components/ui/primitives";
import { parseOutline } from "@/lib/testing/outline";
import type { RunSnapshot } from "@/lib/testing/runs";
import { cn } from "@/lib/utils";
import { SuiteEditor } from "./suite-editor";
import { TestRunCardView } from "./test-run-card";
import { useTestRun } from "./use-test-run";
import { WorkflowDiagram } from "./workflow-diagram";

/**
 * One suite: its code on the left, what it does on the right.
 *
 * The right panel is a diagram of the file scanned from the source as you type,
 * and the live state of the run once you press Run — deliberately the same
 * panel, because the thing worth watching during a run is the thing you were
 * just editing.
 *
 * The run shown on arrival comes in as `initialRun`, already read from the
 * database by the page. Reopening a suite therefore paints the last result
 * outright; only a run still in flight is followed over the network.
 */
export function SuiteDetail({
  applicationId,
  suiteId,
  suiteName,
  initialCode,
  initialRun,
}: {
  applicationId: string;
  suiteId: string;
  suiteName: string;
  initialCode: string;
  initialRun?: RunSnapshot | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [saved, setSaved] = useState(initialCode);
  const [runId, setRunId] = useState<string | null>(initialRun?.run.id ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "warn" | "ok";
    text: string;
  } | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const view = useTestRun(runId, { initial: initialRun });
  const running = Boolean(view.run && !view.done);
  const dirty = code !== saved;

  const staticOutline = useMemo(() => parseOutline(code), [code]);

  const save = useCallback(async () => {
    if (code === saved) return true;
    const result = await saveTestSuiteAction({ applicationId, suiteId, code });
    if (result.error) {
      setMessage({ tone: "error", text: result.error });
      return false;
    }
    setSaved(code);
    setMessage(
      result.typeErrors
        ? {
            tone: "warn",
            text: `Saved · ${result.typeErrors} type ${
              result.typeErrors === 1 ? "error" : "errors"
            }`,
          }
        : { tone: "ok", text: "Saved" },
    );
    return true;
  }, [applicationId, code, saved, suiteId]);

  const run = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Running the buffer you are looking at is the only sane behaviour; an
      // unsaved edit is saved first rather than silently ignored.
      if (!(await save())) return;
      const result = await startTestRunAction({ applicationId, suiteId });
      if (result.error || !result.runId) {
        setMessage({ tone: "error", text: result.error ?? "Could not start the run" });
        return;
      }
      setRunId(result.runId);
    } finally {
      setBusy(false);
    }
  }, [applicationId, save, suiteId]);

  const dismissRun = useCallback(() => {
    setRunId(null);
    // The page also opens the latest run on mount, so clearing the state alone
    // would put the card back on the next navigation. Dropping the query makes
    // the dismissal survive one.
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // The suites table shows each suite's latest outcome, so it is stale the
  // moment a run finishes here. The run the page arrived with is already
  // accounted for — seeding the ref with it stops every reload from spending a
  // round trip re-rendering the server component that just rendered.
  const settled = useRef<string | null>(initialRun?.done ? initialRun.run.id : null);
  useEffect(() => {
    if (!view.done || !runId || settled.current === runId) return;
    settled.current = runId;
    router.refresh();
  }, [router, runId, view.done]);

  useSaveShortcut(dirty ? save : null);

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[540px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
      <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-950">{suiteName}</p>
          {dirty ? <p className="text-[11px] text-amber-600">Unsaved changes</p> : null}
        </div>

        {message ? (
          <span
            className={cn(
              "shrink-0 text-[11px]",
              message.tone === "error"
                ? "text-rose-600"
                : message.tone === "warn"
                  ? "text-amber-600"
                  : "text-emerald-600",
            )}
          >
            {message.text}
          </span>
        ) : null}

        <Button variant="secondary" size="sm" onClick={save} disabled={!dirty || busy}>
          <Save className="size-3.5" aria-hidden="true" />
          Save
        </Button>
        <Button size="sm" onClick={run} disabled={running || busy}>
          {running || busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          {running ? "Running" : "Run"}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-slate-100">
          <SuiteEditor value={code} onChange={setCode} readOnly={running} />
        </div>

        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto bg-slate-50/50 p-3">
          {runId ? (
            <TestRunCardView
              view={view}
              suiteName={suiteName}
              outlineFallback={staticOutline}
              onDismiss={dismissRun}
            />
          ) : (
            <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                Workflow
              </p>
              <WorkflowDiagram outline={staticOutline} />
            </>
          )}
        </aside>
      </div>

      {view.logs.length > 0 ? (
        <div className="border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowLogs((open) => !open)}
            className="flex w-full items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-900"
          >
            <ChevronDown
              className={cn("size-3.5 transition", showLogs ? "" : "-rotate-90")}
              aria-hidden="true"
            />
            Output ({view.logs.length})
          </button>
          {showLogs ? (
            <pre className="max-h-40 overflow-y-auto bg-slate-950 px-4 py-3 font-mono text-[11px] leading-5 text-slate-200">
              {view.logs
                .map((entry) =>
                  entry.stream === "stderr" ? `! ${entry.message}` : entry.message,
                )
                .join("\n")}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** ⌘S / Ctrl-S saves, because this is an editor and that is what editors do. */
function useSaveShortcut(save: (() => void | Promise<unknown>) | null) {
  const handler = useRef(save);

  useEffect(() => {
    handler.current = save;
  }, [save]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "s") return;
      if (!handler.current) return;
      event.preventDefault();
      void handler.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
