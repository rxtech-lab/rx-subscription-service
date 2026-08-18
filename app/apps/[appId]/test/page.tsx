import { ExternalLink } from "lucide-react";
import {
  adjustTestBalanceAction,
  cancelTestSubscriptionAction,
  createTestUserAction,
  deleteTestUserAction,
  grantTestSubscriptionAction,
  updateTestUserAction,
} from "@/app/actions/test-users";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { sandboxConfigured, stripeMode } from "@/lib/stripe/client";
import { listPurchasablePlans } from "@/lib/subscription/subscriptions";
import { listTestUsers, type TestUserSummary } from "@/lib/subscription/test-users";
import { listBalanceUnits } from "@/lib/subscription/units";
import { formatDate, formatInterval, formatMoney } from "@/lib/utils";

type Plan = Awaited<ReturnType<typeof listPurchasablePlans>>[number];
type Unit = Awaited<ReturnType<typeof listBalanceUnits>>[number];

function planOption(plan: Plan) {
  return `${plan.name} · ${formatMoney(plan.priceAmountCents, plan.currency)} ${formatInterval(
    plan.billingInterval,
    plan.intervalCount,
  )}`;
}

function TestUserFields({
  plans,
  units,
  user,
}: {
  plans: Plan[];
  units: Unit[];
  user?: TestUserSummary["user"];
}) {
  return (
    <div className="space-y-4">
      <Field label="Display name">
        <Input
          name="displayName"
          required
          maxLength={120}
          defaultValue={user?.displayName ?? ""}
          placeholder="Pro subscriber"
        />
      </Field>
      <Field label="Email" hint="Optional. Used for the Stripe customer record.">
        <Input name="email" type="email" defaultValue={user?.email ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Level">
          <Input name="level" type="number" step="1" defaultValue={user?.level ?? 0} />
        </Field>
        <Field label="Level key" hint="Optional.">
          <Input name="levelKey" defaultValue={user?.levelKey ?? ""} />
        </Field>
      </div>
      <Field label="Note" hint="What this user is set up to exercise.">
        <Input
          name="note"
          maxLength={200}
          defaultValue={user?.testNote ?? ""}
          placeholder="Pro annual, low balance"
        />
      </Field>

      {user ? null : (
        <>
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-700">Starting state</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Optional. A granted plan skips checkout — it creates the subscription
              directly, with the same entitlement snapshot and balance grants a real
              purchase would produce.
            </p>
          </div>
          <Field label="Subscribe to plan">
            <Select name="planId" defaultValue="">
              <option value="">No subscription</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {planOption(plan)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starting balance unit">
              <Select name="unitId" defaultValue="">
                <option value="">None</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount">
              <Input name="amount" type="number" min="0" step="1" defaultValue={0} />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

export default async function TestPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [testUsers, plans, units] = await Promise.all([
    listTestUsers(appId),
    listPurchasablePlans(appId),
    listBalanceUnits(appId),
  ]);
  const sandboxReady = sandboxConfigured();
  const sandboxMode = stripeMode("sandbox");

  return (
    <div className="space-y-4">
      {sandboxReady ? null : (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Set <code className="font-mono">STRIPE_SANDBOX_SECRET_KEY</code> to run
          checkout in the test app. Test users, plan grants and balances work without
          it.
        </div>
      )}
      {sandboxReady && sandboxMode === "live" ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <code className="font-mono">STRIPE_SANDBOX_SECRET_KEY</code> is a live key.
          Test checkouts would create real charges — replace it with a sandbox key.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Test users"
          description="Disposable users for exercising the subscriber experience. They are hidden from the Users tab and bill against the Stripe sandbox, never the live account."
          action={
            <FormDialog
              triggerLabel="Create"
              title="Create a test user"
              description="No RxLab identity is required — a synthetic one is generated."
              size="md"
              triggerSize="sm"
            >
              <ActionForm
                action={createTestUserAction}
                submitLabel="Create test user"
                pendingLabel="Creating…"
                autoComplete="off"
              >
                <input type="hidden" name="applicationId" value={appId} />
                <TestUserFields plans={plans} units={units} />
              </ActionForm>
            </FormDialog>
          }
        />

        {testUsers.length === 0 ? (
          <EmptyState
            title="No test users yet"
            description="Create one to open the test app and walk through subscribing, buying a topup, and spending a balance as a subscriber would."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Subscriptions</Th>
                <Th>Balances</Th>
                <Th>Level</Th>
                <Th>Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {testUsers.map(({ user, subscriptions, balances }) => {
                const active = subscriptions.filter((subscription) =>
                  ["active", "trialing", "past_due"].includes(subscription.status),
                );
                return (
                  <tr key={user.id}>
                    <Td>
                      <p className="font-medium text-neutral-900">
                        {user.displayName || "Unnamed"}
                      </p>
                      {user.testNote ? (
                        <p className="text-xs text-neutral-500">{user.testNote}</p>
                      ) : null}
                      <p className="font-mono text-xs text-neutral-400">
                        {user.rxlabUserId}
                      </p>
                    </Td>
                    <Td>
                      {subscriptions.length === 0 ? (
                        <span className="text-xs text-neutral-400">None</span>
                      ) : (
                        <div className="space-y-1">
                          {subscriptions.map((subscription) => (
                            <div
                              key={subscription.id}
                              className="flex items-center gap-2"
                            >
                              <Badge tone={statusTone(subscription.status)}>
                                {subscription.status}
                              </Badge>
                              <span className="text-xs text-neutral-600">
                                {subscription.planName}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {balances.length === 0 ? (
                        <span className="text-xs text-neutral-400">None</span>
                      ) : (
                        <div className="space-y-0.5">
                          {balances.map((balance) => (
                            <p key={balance.unitKey} className="text-xs text-neutral-600">
                              {balance.amount.toLocaleString()} {balance.unitName}
                            </p>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {user.level}
                      {user.levelKey ? (
                        <span className="ml-1 text-xs text-neutral-500">
                          ({user.levelKey})
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="text-xs text-neutral-500">
                        {formatDate(user.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      <ActionMenu
                        label={`Actions for ${user.displayName || "test user"}`}
                      >
                        <a
                          href={`/apps/${appId}/users/${user.id}/test-session`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex w-full items-center justify-start gap-2 rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                          Test user
                        </a>

                        <FormDialog
                          triggerLabel="Edit"
                          title={`Edit ${user.displayName || "test user"}`}
                          icon="edit"
                          triggerVariant="menu"
                          triggerSize="sm"
                        >
                          <ActionForm
                            action={updateTestUserAction}
                            submitLabel="Save"
                            autoComplete="off"
                          >
                            <input
                              type="hidden"
                              name="applicationId"
                              value={appId}
                            />
                            <input type="hidden" name="appUserId" value={user.id} />
                            <TestUserFields
                              plans={plans}
                              units={units}
                              user={user}
                            />
                          </ActionForm>
                        </FormDialog>

                        {plans.length > 0 ? (
                          <FormDialog
                            triggerLabel="Grant subscription"
                            title="Grant a subscription"
                            description="Creates the subscription directly, with no payment."
                            icon="plus"
                            triggerVariant="menu"
                            triggerSize="sm"
                            size="sm"
                          >
                            <ActionForm
                              action={grantTestSubscriptionAction}
                              submitLabel="Grant"
                            >
                              <input
                                type="hidden"
                                name="applicationId"
                                value={appId}
                              />
                              <input
                                type="hidden"
                                name="appUserId"
                                value={user.id}
                              />
                              <Field label="Plan">
                                <Select name="planId" required>
                                  {plans.map((plan) => (
                                    <option key={plan.id} value={plan.id}>
                                      {planOption(plan)}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            </ActionForm>
                          </FormDialog>
                        ) : null}

                        {units.length > 0 ? (
                          <FormDialog
                            triggerLabel="Adjust balance"
                            title="Adjust balance"
                            icon="edit"
                            triggerVariant="menu"
                            triggerSize="sm"
                            size="sm"
                          >
                            <ActionForm
                              action={adjustTestBalanceAction}
                              submitLabel="Apply"
                            >
                              <input
                                type="hidden"
                                name="applicationId"
                                value={appId}
                              />
                              <input
                                type="hidden"
                                name="appUserId"
                                value={user.id}
                              />
                              <div className="space-y-4">
                                <Field label="Unit">
                                  <Select name="unitId" required>
                                    {units.map((unit) => (
                                      <option key={unit.id} value={unit.id}>
                                        {unit.name}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                <Field
                                  label="Delta"
                                  hint="Negative to debit. Must be non-zero."
                                >
                                  <Input
                                    name="delta"
                                    type="number"
                                    step="1"
                                    required
                                  />
                                </Field>
                                <Field label="Reason">
                                  <Input
                                    name="reason"
                                    defaultValue="Test adjustment"
                                  />
                                </Field>
                              </div>
                            </ActionForm>
                          </FormDialog>
                        ) : null}

                        {active.map((subscription) => (
                          <InlineActionButton
                            key={subscription.id}
                            action={cancelTestSubscriptionAction}
                            label={`Cancel ${subscription.planName}`}
                            variant="menu"
                          >
                            <input
                              type="hidden"
                              name="applicationId"
                              value={appId}
                            />
                            <input type="hidden" name="appUserId" value={user.id} />
                            <input
                              type="hidden"
                              name="subscriptionId"
                              value={subscription.id}
                            />
                            <input type="hidden" name="immediately" value="true" />
                          </InlineActionButton>
                        ))}

                        <InlineActionButton
                          action={deleteTestUserAction}
                          label="Delete test user"
                          variant="menuDanger"
                          confirmMessage="Delete this test user? Its subscriptions, balances and ledger history are removed."
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input type="hidden" name="appUserId" value={user.id} />
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
