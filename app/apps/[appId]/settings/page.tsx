import { KeyRound, Settings2, Workflow } from "lucide-react";
import Link from "next/link";
import { updateTestAutomationSettingsAction } from "@/app/actions/settings";
import { createApiKeyAction, deleteApiKeyAction } from "@/app/actions/users";
import {
  ActionForm,
  ApiKeyForm,
  InlineActionButton,
} from "@/components/forms/action-form";
import { SearchField } from "@/components/forms/search-field";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { listApiKeys } from "@/lib/api/keys";
import { requireApplicationAccess } from "@/lib/console/session";
import { getTestAutomationSettings } from "@/lib/testing/automation";
import { cn, formatDate } from "@/lib/utils";

const SETTINGS_TABS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "api-keys", label: "API keys", icon: KeyRound },
  { id: "automation", label: "Automation", icon: Workflow },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function settingsTab(value: string | string[] | undefined): SettingsTab {
  const tab = first(value);
  return tab === "api-keys" || tab === "automation" ? tab : "general";
}

function SettingsTabs({
  appId,
  activeTab,
}: {
  appId: string;
  activeTab: SettingsTab;
}) {
  const baseHref = `/apps/${appId}/settings`;

  return (
    <nav aria-label="Settings sections" className="overflow-x-auto">
      <ul className="inline-flex min-w-max items-center gap-1 rounded-xl border border-slate-200/80 bg-white p-1">
        {SETTINGS_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          const Icon = tab.icon;
          const href =
            tab.id === "general" ? baseHref : `${baseHref}?tab=${tab.id}`;

          return (
            <li key={tab.id}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default async function SettingsPage({
  params,
  searchParams,
}: PageProps<"/apps/[appId]/settings">) {
  const { appId } = await params;
  const { page, q, tab } = await searchParams;
  const application = await requireApplicationAccess(appId);

  const activeTab = settingsTab(tab);
  const query = first(q)?.trim() ?? "";
  const [apiKeyData, testAutomation] = await Promise.all([
    activeTab === "api-keys"
      ? listApiKeys(appId, {
          page: Number(first(page)) || 1,
          query,
        })
      : null,
    activeTab === "automation" ? getTestAutomationSettings(appId) : null,
  ]);

  function pageHref(target: number) {
    const search = new URLSearchParams();
    search.set("tab", "api-keys");
    if (query) search.set("q", query);
    if (target > 1) search.set("page", String(target));
    const suffix = search.toString();
    return `/apps/${appId}/settings${suffix ? `?${suffix}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <SettingsTabs appId={appId} activeTab={activeTab} />

      {activeTab === "general" ? (
        <Card>
        <CardHeader
          title="Application"
          description="Mirrored from rxlab-auth. Edit the name and icon there."
        />
        <dl className="space-y-2 px-5 py-4 text-sm">
          <div className="flex gap-3">
            <dt className="w-32 text-neutral-500">Name</dt>
            <dd className="text-neutral-900">{application.name}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-32 text-neutral-500">OAuth client id</dt>
            <dd className="font-mono text-xs text-neutral-900">{application.id}</dd>
          </div>
        </dl>
        </Card>
      ) : null}

      {activeTab === "automation" && testAutomation ? (
        <Card>
          <CardHeader
            title="Test automation"
            description="Run regression suites after subscription configuration changes from the console or assistant."
          />
          <ActionForm
            action={updateTestAutomationSettingsAction}
            submitLabel="Save automation"
            pendingLabel="Saving test automation…"
            className="px-5 py-4"
          >
            <input type="hidden" name="applicationId" value={appId} />
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <input
                type="checkbox"
                name="runTestsOnChange"
                defaultChecked={testAutomation.runTestsOnChange}
                className="mt-0.5 size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  Run all test suites after configuration changes
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  Applies to plans, top-ups, access, units, usage items, and coupons.
                  Runs use disposable test users and continue in the background.
                </span>
              </span>
            </label>
            <p className="mt-3 text-xs text-slate-500">
              {testAutomation.suiteCount === 0 ? (
                <>
                  No suites are configured. Add one in{" "}
                  <Link
                    href={`/apps/${appId}/test/cases`}
                    className="font-semibold text-blue-700 hover:underline"
                  >
                    Test cases
                  </Link>
                  .
                </>
              ) : (
                <>
                  {testAutomation.suiteCount.toLocaleString("en-US")} test{" "}
                  {testAutomation.suiteCount === 1 ? "suite" : "suites"} will run
                  after each change. Manage them in{" "}
                  <Link
                    href={`/apps/${appId}/test/cases`}
                    className="font-semibold text-blue-700 hover:underline"
                  >
                    Test cases
                  </Link>
                  .
                </>
              )}
            </p>
          </ActionForm>
        </Card>
      ) : null}

      {activeTab === "api-keys" && apiKeyData ? (
        <>
          <Card>
        <CardHeader
          title="API keys"
          description="Environment-scoped credentials for /api/v1. Sandbox keys keep users, usage, balances, purchases, and Stripe activity isolated from production."
          action={
            <SearchField
              label="Search API keys"
              placeholder="Search name, environment, or prefix"
              className="w-56"
            />
          }
        />
        {apiKeyData.keys.length === 0 ? (
          <EmptyState
            title={query ? "No matching API keys" : "No API keys"}
            description={
              query
                ? `Nothing matches “${query}”. Try a different name or prefix.`
                : "Create one below."
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Environment</Th>
                  <Th>Key</Th>
                  <Th>Last used</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {apiKeyData.keys.map((key) => (
                  <tr key={key.id}>
                    <Td>{key.name}</Td>
                    <Td>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${
                          key.environment === "sandbox"
                            ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                            : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        }`}
                      >
                        {key.environment}
                      </span>
                    </Td>
                    <Td>
                      <code className="text-xs">{key.keyPrefix}…</code>
                    </Td>
                    <Td>
                      <span className="text-xs text-neutral-500">
                        {key.lastUsedAt ? formatDate(key.lastUsedAt) : "never"}
                      </span>
                    </Td>
                    <Td>
                      <InlineActionButton
                        action={deleteApiKeyAction}
                        label="Delete"
                        variant="danger"
                        confirmMessage="Delete this key? Any app using it stops working immediately."
                      >
                        <input type="hidden" name="applicationId" value={appId} />
                        <input type="hidden" name="keyId" value={key.id} />
                      </InlineActionButton>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {apiKeyData.pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between px-5 py-3 text-xs text-neutral-500">
                <span>
                  Page {apiKeyData.pagination.page} of{" "}
                  {apiKeyData.pagination.totalPages} ·{" "}
                  {apiKeyData.pagination.totalCount.toLocaleString("en-US")} keys
                </span>
                <div className="flex gap-3">
                  {apiKeyData.pagination.page > 1 ? (
                    <Link
                      href={pageHref(apiKeyData.pagination.page - 1)}
                      className="underline hover:text-neutral-900"
                    >
                      Previous
                    </Link>
                  ) : null}
                  {apiKeyData.pagination.page <
                  apiKeyData.pagination.totalPages ? (
                    <Link
                      href={pageHref(apiKeyData.pagination.page + 1)}
                      className="underline hover:text-neutral-900"
                    >
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}

        <div className="flex justify-end border-t border-slate-100 px-5 py-4">
          <FormDialog
            triggerLabel="Create API key"
            title="Create an API key"
            description="Choose the environment this key is allowed to access. This cannot be changed after creation."
            icon="key"
            size="sm"
          >
            <ApiKeyForm action={createApiKeyAction}>
              <input type="hidden" name="applicationId" value={appId} />
              <Field
                label="Environment"
                hint="Sandbox data is isolated and uses the Stripe sandbox account"
              >
                <Select name="environment" defaultValue="sandbox" required>
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </Select>
              </Field>
              <Field label="Key name" hint="Something that identifies where it is used">
                <Input name="name" required placeholder="integration test server" />
              </Field>
            </ApiKeyForm>
          </FormDialog>
        </div>
          </Card>

          <Card>
            <CardHeader
              title="Using the API"
              description="Send the key as X-Api-Key. The key selects sandbox or production; users are addressed by their rxlab id."
            />
            <pre className="overflow-x-auto px-5 py-4 text-xs text-neutral-700">
              {`# What is this user entitled to?
curl "$BASE/api/v1/entitlements?rxlabUserId=$USER" \\
  -H "X-Api-Key: $KEY"

# Meter one unit of usage
curl -X POST "$BASE/api/v1/usage" \\
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"rxlabUserId":"'$USER'","item":"api_calls","amount":1}'

# Start a checkout
curl -X POST "$BASE/api/v1/checkout" \\
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"rxlabUserId":"'$USER'","kind":"plan","planId":"..."}'`}
            </pre>
          </Card>
        </>
      ) : null}
    </div>
  );
}
