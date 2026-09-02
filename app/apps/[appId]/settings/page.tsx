import { KeyRound, Settings2, Smartphone, Workflow } from "lucide-react";
import Link from "next/link";
import {
  updateAppleIntegrationAction,
  updateTestAutomationSettingsAction,
} from "@/app/actions/settings";
import { createApiKeyAction, deleteApiKeyAction } from "@/app/actions/users";
import {
  ActionForm,
  ApiKeyForm,
  InlineActionButton,
} from "@/components/forms/action-form";
import { ApiKeyKindFields } from "@/components/forms/api-key-fields";
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
import { listApiKeys, parseAllowedClientIds } from "@/lib/api/keys";
import {
  getSelectableOAuthClients,
  requireApplicationAccess,
} from "@/lib/console/session";
import {
  appleCredentialsConfigured,
  getAppleIntegration,
  listStoreProductMappings,
} from "@/lib/iap/configuration";
import { getTestAutomationSettings } from "@/lib/testing/automation";
import { cn, formatDate } from "@/lib/utils";

const SETTINGS_TABS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "api-keys", label: "API keys", icon: KeyRound },
  { id: "app-store", label: "App Store", icon: Smartphone },
  { id: "automation", label: "Automation", icon: Workflow },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function settingsTab(value: string | string[] | undefined): SettingsTab {
  const tab = first(value);
  return tab === "api-keys" || tab === "app-store" || tab === "automation"
    ? tab
    : "general";
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
  const [apiKeyData, oauthClients, testAutomation, appleIntegration, storeMappings] =
    await Promise.all([
      activeTab === "api-keys"
        ? listApiKeys(appId, {
            page: Number(first(page)) || 1,
            query,
          })
        : null,
      // Already in this request's cache — `requireApplicationAccess` above read
      // the same rxlab-auth client list — so this costs nothing extra.
      activeTab === "api-keys" ? getSelectableOAuthClients() : [],
      activeTab === "automation" ? getTestAutomationSettings(appId) : null,
      activeTab === "app-store" ? getAppleIntegration(appId) : null,
      activeTab === "app-store" ? listStoreProductMappings(appId) : [],
    ]);
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  const notificationUrl = site
    ? `${site}/api/apple/notifications/${appId}`
    : `/api/apple/notifications/${appId}`;

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

      {activeTab === "app-store" ? (
        <Card>
          <CardHeader
            title="App Store"
            description="Connect StoreKit 2 purchases and App Store Server Notifications V2 to this application."
          />
          <ActionForm
            action={updateAppleIntegrationAction}
            submitLabel="Save App Store settings"
            pendingLabel="Saving App Store settings…"
            className="space-y-4 px-5 py-4"
          >
            <input type="hidden" name="applicationId" value={appId} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Bundle ID">
                <Input
                  name="bundleId"
                  defaultValue={appleIntegration?.bundleId ?? ""}
                  placeholder="com.rxlab.rxargo"
                  required
                />
              </Field>
              <Field label="Apple app ID" hint="The numeric ID from App Store Connect.">
                <Input
                  name="appAppleId"
                  type="number"
                  min="1"
                  defaultValue={appleIntegration?.appAppleId ?? undefined}
                  required
                />
              </Field>
            </div>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={appleIntegration?.enabled ?? false}
                className="mt-0.5 size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  Enable App Store purchases
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Enable only after credentials, products, and notifications are ready.
                </span>
              </span>
            </label>
            <dl className="space-y-3 rounded-xl border border-slate-200 p-4 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-slate-500">Shared credentials</dt>
                <dd className="font-semibold text-slate-900">
                  {appleCredentialsConfigured() ? "Ready" : "Missing deployment secrets"}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-slate-500">Mapped products</dt>
                <dd className="font-semibold text-slate-900">
                  {storeMappings.filter((mapping) => mapping.provider === "apple_app_store").length}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-slate-500">Notifications V2 URL</dt>
                <dd className="break-all font-mono text-slate-900">{notificationUrl}</dd>
              </div>
            </dl>
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
                  <Th>Kind</Th>
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
                          key.kind === "publishable"
                            ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
                            : "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"
                        }`}
                        title={
                          key.kind === "publishable"
                            ? `Embeddable in a client. Only works alongside a user token from: ${
                                parseAllowedClientIds(key.allowedClientIds).join(", ") ||
                                "no client — this key is unusable"
                              }`
                            : "Server-to-server. Full access; never ship it in a client."
                        }
                      >
                        {key.kind}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${
                          key.environment === "xcode"
                            ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
                            : key.environment === "sandbox"
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
            description="Choose the kind and environment. Neither can be changed after creation."
            icon="key"
            size="sm"
          >
            <ApiKeyForm action={createApiKeyAction}>
              <input type="hidden" name="applicationId" value={appId} />
              <ApiKeyKindFields clients={oauthClients} />
              <Field
                label="Environment"
                hint="Xcode is the default for local StoreKit testing; Xcode and sandbox data are isolated and both use Stripe test mode"
              >
                <Select name="environment" defaultValue="xcode" required>
                  <option value="xcode">Xcode</option>
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
              description="Send the key as X-Api-Key. The key selects Xcode, sandbox, or production, and its kind decides what it may do."
            />
            <pre className="overflow-x-auto px-5 py-4 text-xs text-neutral-700">
              {`# --- Secret key, from your backend -----------------------------
# It names the user it acts for, and reaches every endpoint.

# What is this user entitled to?
curl "$BASE/api/v1/entitlements?rxlabUserId=$USER" \\
  -H "X-Api-Key: $SECRET_KEY"

# Meter one unit of usage
curl -X POST "$BASE/api/v1/usage" \\
  -H "X-Api-Key: $SECRET_KEY" -H "Content-Type: application/json" \\
  -d '{"rxlabUserId":"'$USER'","item":"api_calls","amount":1}'

# --- Publishable key, from your app ----------------------------
# It must carry the signed-in user's rxlab access token, and acts
# only for that user — whatever rxlabUserId the request says.

curl "$BASE/api/v1/entitlements" \\
  -H "X-Api-Key: $PUBLISHABLE_KEY" \\
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"

# Reads and purchases only. This one is refused:
curl -X POST "$BASE/api/v1/balances" \\
  -H "X-Api-Key: $PUBLISHABLE_KEY" \\
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \\
  -d '{"unit":"credits","amount":1000,"operation":"credit","idempotencyKey":"x"}'
# => 403 insufficient_key_scope`}
            </pre>
          </Card>
        </>
      ) : null}
    </div>
  );
}
