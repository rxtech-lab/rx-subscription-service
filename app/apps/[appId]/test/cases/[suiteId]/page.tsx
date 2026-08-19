import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { renameTestSuiteAction } from "@/app/actions/test-cases";
import { ActionForm } from "@/components/forms/action-form";
import { SuiteDetail } from "@/components/testing/suite-detail";
import { FormDialog } from "@/components/ui/form-dialog";
import { Field, Input } from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { NotFoundError } from "@/lib/subscription/shared";
import { listRuns, readRunSnapshot, type RunSnapshot } from "@/lib/testing/runs";
import { getTestSuite } from "@/lib/testing/suites";
import { formatDate } from "@/lib/utils";

export default async function TestSuitePage({
  params,
  searchParams,
}: PageProps<"/apps/[appId]/test/cases/[suiteId]">) {
  const { appId, suiteId } = await params;
  await requireApplicationAccess(appId);

  const suite = await getTestSuite(appId, suiteId);
  if (!suite) notFound();

  const query = await searchParams;
  const requestedRun = typeof query.run === "string" ? query.run : undefined;

  // Reopening a suite should show where it last got to, not an empty panel —
  // so the run is read here rather than fetched again from the browser. A
  // finished one is then on screen in the first paint, which is the difference
  // between reading a result and appearing to start one.
  const [latest] = requestedRun ? [] : await listRuns(appId, { suiteId, limit: 1 });
  const runId = requestedRun ?? latest?.id;
  let initialRun: RunSnapshot | null = null;
  if (runId) {
    // `?run=` is whatever was in the URL; a stale link is not an error page.
    try {
      const snapshot = await readRunSnapshot(appId, runId);
      // A valid run from another suite in the same app is stale here too.
      initialRun = snapshot.run.suiteId === suite.id ? snapshot : null;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/apps/${appId}/test/cases`}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Test cases
          </Link>
          {suite.description ? (
            <p className="truncate text-xs text-slate-500">{suite.description}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-slate-400">
            Updated {formatDate(suite.updatedAt)}
          </span>
          <FormDialog
            triggerLabel="Rename"
            title="Rename this suite"
            size="sm"
            triggerSize="sm"
            triggerVariant="secondary"
          >
            <ActionForm
              action={renameTestSuiteAction}
              submitLabel="Save"
              autoComplete="off"
            >
              <input type="hidden" name="applicationId" value={appId} />
              <input type="hidden" name="suiteId" value={suite.id} />
              <div className="space-y-4">
                <Field label="Name">
                  <Input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={suite.name}
                  />
                </Field>
                <Field label="Description" hint="Optional.">
                  <Input
                    name="description"
                    maxLength={200}
                    defaultValue={suite.description ?? ""}
                  />
                </Field>
              </div>
            </ActionForm>
          </FormDialog>
        </div>
      </div>

      <SuiteDetail
        applicationId={appId}
        suiteId={suite.id}
        suiteName={suite.name}
        initialCode={suite.code}
        initialRun={initialRun}
      />
    </div>
  );
}
