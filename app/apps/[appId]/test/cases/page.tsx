import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  createTestSuiteAction,
  deleteTestSuiteAction,
} from "@/app/actions/test-cases";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu, ActionMenuDivider } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { countTests, parseOutline } from "@/lib/testing/outline";
import { selectDriver } from "@/lib/testing/runner";
import { listTestSuites } from "@/lib/testing/suites";
import { formatDate } from "@/lib/utils";

function lastRunBadge(
  lastRun: { status: string; total: number; passed: number; failed: number } | null,
) {
  if (!lastRun) return <span className="text-xs text-neutral-400">Never run</span>;
  if (lastRun.status === "error") return <Badge tone="red">Could not run</Badge>;
  if (lastRun.status === "queued" || lastRun.status === "running") {
    return <Badge tone="blue">Running</Badge>;
  }
  if (lastRun.failed > 0) {
    return <Badge tone="red">{lastRun.failed} failed</Badge>;
  }
  return <Badge tone="green">{lastRun.passed} passed</Badge>;
}

export default async function TestCasesPage({
  params,
}: PageProps<"/apps/[appId]/test/cases">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const suites = await listTestSuites(appId);

  // Worth saying out loud rather than discovering through a failed run.
  let driverNotice: string | null = null;
  try {
    if (selectDriver().name === "local") {
      driverNotice =
        "Runs execute as a local child process because this is not a deployment. In production they run in a Vercel Sandbox.";
    }
  } catch (error) {
    driverNotice = error instanceof Error ? error.message : "No test runner is available.";
  }

  return (
    <div className="space-y-4">
      {driverNotice ? (
        <p
          role="status"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs leading-5 text-slate-600"
        >
          {driverNotice}
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Test cases"
          description="Suites that exercise this application end to end — subscribing, buying a topup, spending a balance, crossing a usage limit. They run against disposable test users, never a real subscriber."
          action={
            <FormDialog
              triggerLabel="Create"
              title="Create a test suite"
              description="Starts from a template you can edit. Runs are triggered from the suite itself."
              size="sm"
              triggerSize="sm"
            >
              <ActionForm
                action={createTestSuiteAction}
                submitLabel="Create suite"
                pendingLabel="Creating…"
                autoComplete="off"
              >
                <input type="hidden" name="applicationId" value={appId} />
                <div className="space-y-4">
                  <Field label="Name">
                    <Input
                      name="name"
                      required
                      maxLength={120}
                      placeholder="Subscription lifecycle"
                    />
                  </Field>
                  <Field label="Description" hint="Optional. What this suite covers.">
                    <Input
                      name="description"
                      maxLength={200}
                      placeholder="Subscribe, renew, cancel"
                    />
                  </Field>
                </div>
              </ActionForm>
            </FormDialog>
          }
        />

        {suites.length === 0 ? (
          <EmptyState
            title="No test suites yet"
            description="Create one to assert that a plan grants what it should, that a gated topup stays locked, or that a usage limit blocks — or ask the assistant to write one for you."
          />
        ) : (
          <Table className="table-fixed">
            <thead>
              <tr>
                <Th className="w-[38%]">Suite</Th>
                <Th className="w-[15%]">Tests</Th>
                <Th className="w-[15%]">Last run</Th>
                <Th className="w-[22%]">Updated</Th>
                <Th className="w-[10%]">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {suites.map((suite) => {
                const href = `/apps/${appId}/test/cases/${suite.id}`;
                // The count comes from scanning the source, so a suite that has
                // never run still says how much is in it.
                const tests = countTests(parseOutline(suite.code));

                return (
                  <tr key={suite.id}>
                    <Td>
                      <Link
                        href={href}
                        className="group flex items-center gap-1.5 font-medium text-neutral-900 hover:text-blue-700"
                      >
                        {suite.name}
                        <ChevronRight
                          className="size-3.5 text-slate-300 transition group-hover:text-blue-500"
                          aria-hidden="true"
                        />
                      </Link>
                      {suite.description ? (
                        // One line only — a long description shouldn't grow the row.
                        <p
                          className="truncate text-xs text-neutral-500"
                          title={suite.description}
                        >
                          {suite.description}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="text-xs tabular-nums text-neutral-600">
                        {tests}
                      </span>
                    </Td>
                    <Td>{lastRunBadge(suite.lastRun)}</Td>
                    <Td>
                      <span className="text-xs text-neutral-500">
                        {formatDate(suite.updatedAt)}
                      </span>
                      {suite.updatedBy === "ai" ? (
                        <span className="ml-1.5 text-xs text-blue-600">assistant</span>
                      ) : null}
                    </Td>
                    <Td>
                      <ActionMenu label={`Actions for ${suite.name}`}>
                        <Link
                          href={href}
                          className="flex w-full items-center justify-start rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                        >
                          Open
                        </Link>

                        <ActionMenuDivider />

                        <InlineActionButton
                          action={deleteTestSuiteAction}
                          label="Delete suite"
                          variant="menuDanger"
                          confirmMessage="Delete this suite and its run history?"
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input type="hidden" name="suiteId" value={suite.id} />
                        </InlineActionButton>
                      </ActionMenu>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
