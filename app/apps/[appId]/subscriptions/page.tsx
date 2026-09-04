import Link from "next/link";
import {
  deleteXcodeSubscriptionAction,
  startTestSubscriptionAction,
} from "@/app/actions/subscriptions";
import { cancelSubscriptionAction } from "@/app/actions/users";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import { TestBadge } from "@/components/ui/test-badge";
import {
  Badge,
  Button,
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
import {
  requireApplicationAccess,
  requireConsoleUser,
} from "@/lib/console/session";
import {
  indexRxLabUsers,
  listAllRxLabUsersForDisplay,
  resolveUserDisplayIdentity,
} from "@/lib/rxlab/users";
import { stripeConfigured, stripeMode } from "@/lib/stripe/client";
import {
  listPurchasablePlans,
  listSubscriptions,
} from "@/lib/subscription/subscriptions";
import { listAppUserOptions } from "@/lib/subscription/users";
import { formatDate, formatInterval, formatMoney } from "@/lib/utils";

function checkoutNotice(value: string | string[] | undefined) {
  const status = Array.isArray(value) ? value[0] : value;
  if (status === "success") {
    return {
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      message: "Stripe checkout completed and the subscription was synced.",
    };
  }
  if (status === "cancelled") {
    return {
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      message: "Stripe checkout was cancelled. No subscription was changed.",
    };
  }
  if (status === "failed") {
    return {
      tone: "border-rose-200 bg-rose-50 text-rose-800",
      message:
        "Checkout returned, but the subscription could not be verified. Check Stripe webhooks and try refreshing.",
    };
  }
  return null;
}

function userLabel(
  user: {
    displayName: string | null;
    email: string | null;
    rxlabUserId: string;
  },
  directory: ReturnType<typeof indexRxLabUsers>,
) {
  const identity = resolveUserDisplayIdentity(user, directory);
  return identity.name || identity.email || user.rxlabUserId;
}

export default async function SubscriptionsPage({
  params,
  searchParams,
}: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  const { checkout } = await searchParams;
  await requireApplicationAccess(appId);
  const consoleUser = await requireConsoleUser();

  const [subscriptions, users, purchasablePlans, rxLabUsers] = await Promise.all([
    listSubscriptions(appId),
    listAppUserOptions(appId),
    listPurchasablePlans(appId),
    listAllRxLabUsersForDisplay(consoleUser.accessToken),
  ]);
  const rxLabUsersById = indexRxLabUsers(rxLabUsers);
  const plans = purchasablePlans.filter(
    (plan) => plan.billingInterval !== "one_time",
  );
  const notice = checkoutNotice(checkout);
  const configured = stripeConfigured();
  const mode = stripeMode();
  const canTest = configured && users.length > 0 && plans.length > 0;
  const testUnavailableReason = !configured
    ? "Configure STRIPE_SECRET_KEY before testing Checkout."
    : users.length === 0
      ? "Create an app user before testing Checkout."
      : "Activate a recurring plan before testing Checkout.";

  return (
    <div className="space-y-4">
      {notice ? (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${notice.tone}`}
        >
          {notice.message}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Subscriptions"
          description="Paid subscriptions follow Stripe or the App Store. Automatic free plans are managed internally."
          action={
            canTest ? (
              <FormDialog
                triggerLabel="Test subscription"
                title="Test a subscription checkout"
                description={
                  mode === "live"
                    ? "This uses the configured live Stripe account and may create a real charge."
                    : "Create a Stripe Checkout session and sync the subscription after it succeeds."
                }
                size="sm"
              >
                <ActionForm
                  action={startTestSubscriptionAction}
                  submitLabel="Continue to Stripe"
                  pendingLabel="Opening Stripe…"
                >
                  <input type="hidden" name="applicationId" value={appId} />
                  <div className="space-y-4">
                    <Field label="User">
                      <Select name="appUserId" required>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {userLabel(user, rxLabUsersById)} · {user.rxlabUserId}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Plan">
                      <Select name="planId" required>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name} · {plan.planGroup} ·{" "}
                            {formatMoney(plan.priceAmountCents, plan.currency)}{" "}
                            {formatInterval(
                              plan.billingInterval,
                              plan.intervalCount,
                            )}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Coupon code" hint="Optional; belongs to this app.">
                      <Input
                        name="couponCode"
                        placeholder="LAUNCH25"
                        className="uppercase"
                      />
                    </Field>
                    <p className="text-xs leading-5 text-slate-500">
                      {mode === "test"
                        ? "Stripe test mode is active. Complete Checkout with a Stripe test payment method."
                        : mode === "live"
                          ? "Live mode is active. Completing Checkout creates a real Stripe subscription."
                          : "The configured Stripe key mode could not be identified."}
                    </p>
                  </div>
                </ActionForm>
              </FormDialog>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled
                title={testUnavailableReason}
              >
                Test subscription
              </Button>
            )
          }
        />
        {subscriptions.length === 0 ? (
          <EmptyState
            title="No subscriptions"
            description={
              canTest
                ? "Use Test subscription to run the Stripe Checkout flow from this admin page."
                : testUnavailableReason
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>User</Th>
                <Th>Status</Th>
                <Th>Provider</Th>
                <Th>Period</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <tr key={subscription.id}>
                  <Td>
                    <p className="font-medium text-neutral-900">
                      {subscription.planName}
                    </p>
                    <p className="font-mono text-xs text-neutral-500">
                      {subscription.planKey} · {subscription.planGroup}
                    </p>
                  </Td>
                  <Td>
                    <Link
                      href={`/apps/${appId}/users/${subscription.appUserId}`}
                      className="text-xs text-neutral-600 underline hover:text-neutral-900"
                    >
                      {userLabel(
                        {
                          displayName: subscription.userLabel,
                          email: subscription.userEmail,
                          rxlabUserId: subscription.rxlabUserId,
                        },
                        rxLabUsersById,
                      )}
                    </Link>
                    {subscription.isTest ? <TestBadge className="ml-2" /> : null}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(subscription.status)}>
                      {subscription.status}
                    </Badge>
                    {subscription.cancelAtPeriodEnd ? (
                      <span className="ml-2 text-xs text-neutral-500">ending</span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-xs font-medium text-neutral-600">
                      {subscription.billingProvider === "apple_app_store"
                        ? "App Store"
                        : subscription.billingProvider === "internal"
                          ? "Automatic"
                          : "Stripe"}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs text-neutral-500">
                      {formatDate(subscription.currentPeriodStart)} →{" "}
                      {formatDate(subscription.currentPeriodEnd)}
                    </span>
                  </Td>
                  <Td>
                    {subscription.billingProvider === "internal" &&
                    subscription.planAutoSubscribe ? (
                      <span className="text-xs text-neutral-500">
                        Managed by plan setting
                      </span>
                    ) : subscription.billingProvider === "apple_app_store" &&
                    subscription.userEnvironment === "xcode" ? (
                      <ActionMenu label={`Actions for ${subscription.planName}`}>
                        <InlineActionButton
                          action={deleteXcodeSubscriptionAction}
                          label="Delete Xcode subscription"
                          variant="menuDanger"
                          confirmMessage="Delete this local Xcode subscription? Access from this subscription is removed, but its signed transaction and granted balances remain. Submitting the transaction again can recreate it."
                        >
                          <input
                            type="hidden"
                            name="applicationId"
                            value={appId}
                          />
                          <input
                            type="hidden"
                            name="subscriptionId"
                            value={subscription.id}
                          />
                        </InlineActionButton>
                      </ActionMenu>
                    ) : subscription.billingProvider === "apple_app_store" ? (
                      <span className="text-xs text-neutral-500">
                        Managed in the App Store
                      </span>
                    ) : ["active", "trialing", "past_due"].includes(
                        subscription.status,
                      ) ? (
                      <ActionMenu label={`Actions for ${subscription.planName}`}>
                        <InlineActionButton
                          action={cancelSubscriptionAction}
                          label="Cancel at period end"
                          variant="menu"
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input
                            type="hidden"
                            name="subscriptionId"
                            value={subscription.id}
                          />
                        </InlineActionButton>
                        <InlineActionButton
                          action={cancelSubscriptionAction}
                          label="Cancel now"
                          variant="menuDanger"
                          confirmMessage="Cancel immediately? The subscriber loses access right away."
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input
                            type="hidden"
                            name="subscriptionId"
                            value={subscription.id}
                          />
                          <input type="hidden" name="immediately" value="true" />
                        </InlineActionButton>
                      </ActionMenu>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
