"use client";

import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { startTestRunAction } from "@/app/actions/test-cases";
import { Button } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useTestRun } from "./use-test-run";

export function RunSuiteButton({
  applicationId,
  suiteId,
  suiteName,
  activeRunId,
}: {
  applicationId: string;
  suiteId: string;
  suiteName: string;
  activeRunId?: string | null;
}) {
  const router = useRouter();
  const [starting, startTransition] = useTransition();
  const [runId, setRunId] = useState<string | null>(activeRunId ?? null);
  const view = useTestRun(runId);
  const toastId = useRef<string | number | null>(null);
  const settledRunId = useRef<string | null>(null);

  const run = useCallback(() => {
    if (starting || (runId && !view.done)) return;

    toastId.current = toast.loading(`Running ${suiteName}…`);
    startTransition(async () => {
      const result = await startTestRunAction({ applicationId, suiteId });
      if (result.error || !result.runId) {
        toast.error(result.error ?? `Could not run ${suiteName}.`, {
          id: toastId.current ?? undefined,
        });
        toastId.current = null;
        return;
      }
      settledRunId.current = null;
      setRunId(result.runId);
    });
  }, [applicationId, runId, starting, suiteId, suiteName, view.done]);

  useEffect(() => {
    if (!runId || !view.done || settledRunId.current === runId) return;
    settledRunId.current = runId;

    if (toastId.current !== null) {
      if (view.run?.status === "passed") {
        toast.success(
          `${suiteName} passed ${view.run.passed} ${
            view.run.passed === 1 ? "test" : "tests"
          }.`,
          { id: toastId.current },
        );
      } else {
        const detail = view.run?.error
          ? view.run.error
          : `${view.run?.failed ?? 0} failed`;
        toast.error(`${suiteName}: ${detail}.`, { id: toastId.current });
      }
      toastId.current = null;
    }

    router.refresh();
  }, [router, runId, suiteName, view.done, view.run]);

  useEffect(
    () => () => {
      if (toastId.current !== null) toast.dismiss(toastId.current);
    },
    [],
  );

  const running = starting || Boolean(runId && !view.done);

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={running}
      onClick={run}
    >
      {running ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Play className="size-3.5" aria-hidden="true" />
      )}
      {running ? "Running…" : "Run"}
    </Button>
  );
}
