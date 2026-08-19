import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { adjustBalanceAction, setUserLevelAction } from "@/app/actions/users";
import { ActionForm } from "@/components/forms/action-form";
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
import { TestBadge } from "@/components/ui/test-badge";
import { requireApplicationAccess } from "@/lib/console/session";
import { stripeConfigured, type StripeMode } from "@/lib/stripe/client";
import { listPaymentHistory } from "@/lib/stripe/invoices";
import { resolveEntitlements } from "@/lib/subscription/entitlements";
import { listSubscriptions } from "@/lib/subscription/subscriptions";
import { listBalanceUnits } from "@/lib/subscription/units";
import { getUsageStatus } from "@/lib/subscription/usage";
import {
  getAppUserByRxlabId,
  getBalances,
  getLedger,
  requireAppUser,
} from "@/lib/subscription/users";
import { formatDate, formatMoney } from "@/lib/utils";

type DataEnvironment = "production" | "sandbox";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requestedEnvironment(
  value: string | string[] | undefined,
  fallback: DataEnvironment,
): DataEnvironment {
  return firstValue(value) === "sandbox"
    ? "sandbox"
    : firstValue(value) === "production"
      ? "production"
      : fallback;
}

function cursor(value: string | string[] | undefined) {
  const candidate = firstValue(value)?.trim();
  return candidate && candidate.length <= 255 ? candidate : undefined;
}

function pageNumber(value: string | string[] | undefined, hasCursor: boolean) {
  if (!hasCursor) return 1;
  const candidate = Number(firstValue(value));
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : 1;
}

function userDetailHref(
  appId: string,
  userId: string,
  environment: DataEnvironment,
  input: { paymentPage?: number; paymentAfter?: string; paymentBefore?: string } = {},
) {
  const query = new URLSearchParams({ environment });
  if (input.paymentPage) query.set("paymentPage", String(input.paymentPage));
  if (input.paymentAfter) query.set("paymentAfter", input.paymentAfter);
  if (input.paymentBefore) query.set("paymentBefore", input.paymentBefore);
  return `/apps/${encodeURIComponent(appId)}/users/${encodeURIComponent(userId)}?${query}`;
}

function invoiceStatusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "draft" || status === "open") return "amber" as const;
  if (status === "uncollectible") return "red" as const;
  return "neutral" as const;
}

export default async function UserDetailPage({
  params,
  searchParams,
}: PageProps<"/apps/[appId]/users/[userId]">) {
  const { appId, userId } = await params;
  const query = await searchParams;
  await requireApplicationAccess(appId);

  let routeUser;
  try {
    routeUser = await requireAppUser(appId, userId);
  } catch {
    notFound();
  }

  const fallbackEnvironment = routeUser.isTest ? "sandbox" : "production";
  const environment = requestedEnvironment(query.environment, fallbackEnvironment);
  const [productionUser, sandboxUser] = await Promise.all([
    getAppUserByRxlabId(appId, routeUser.rxlabUserId, { isTest: false }),
    getAppUserByRxlabId(appId, routeUser.rxlabUserId, { isTest: true }),
  ]);
  const user = environment === "sandbox" ? sandboxUser : productionUser;
  if (!user) notFound();

  const paymentAfter = cursor(query.paymentAfter);
  const paymentBefore = paymentAfter ? undefined : cursor(query.paymentBefore);
  const currentPaymentPage = pageNumber(
    query.paymentPage,
    Boolean(paymentAfter || paymentBefore),
  );
  const stripeMode: StripeMode = environment === "sandbox" ? "sandbox" : "live";

  const [balances, units, entitlements, usage, subscriptions, ledger, paymentHistory] =
    await Promise.all([
      getBalances(user.id),
      listBalanceUnits(appId),
      resolveEntitlements({ applicationId: appId, appUserId: user.id }),
      getUsageStatus({ applicationId: appId, appUserId: user.id }),
      listSubscriptions(appId, { appUserId: user.id }),
      getLedger(user.id),
      stripeConfigured(stripeMode)
        ? listPaymentHistory({
            appUserId: user.id,
            mode: stripeMode,
            after: paymentAfter,
            before: paymentBefore,
          })
        : Promise.resolve({ payments: [], hasMore: false }),
    ]);

  const firstPayment = paymentHistory.payments[0];
  const lastPayment = paymentHistory.payments.at(-1);
  const hasNextPayments = Boolean(paymentBefore) || paymentHistory.hasMore;
  const hasPreviousPayments = currentPaymentPage > 1;
  const hasPaidStripeInvoice = paymentHistory.payments.some(
    (payment) => payment.status === "paid",
  );
  const fulfillmentMissing =
    environment === "sandbox" &&
    hasPaidStripeInvoice &&
    subscriptions.length === 0 &&
    ledger.entries.length === 0;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              {user.displayName || user.email || "Unnamed user"}
              {user.isTest ? <TestBadge /> : null}
            </h1>
            <p className="mt-1 font-mono text-xs text-neutral-500">
              {user.rxlabUserId}
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Data environment
            </p>
            <div
              role="group"
              aria-label="Data environment"
              className="inline-flex rounded-lg bg-slate-100 p-1"
            >
              {productionUser ? (
                <Link
                  href={userDetailHref(appId, userId, "production")}
                  aria-current={environment === "production" ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    environment === "production"
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Production
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-300"
                >
                  Production
                </span>
              )}
              {sandboxUser ? (
                <Link
                  href={userDetailHref(appId, userId, "sandbox")}
                  aria-current={environment === "sandbox" ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    environment === "sandbox"
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Sandbox
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-300"
                >
                  Sandbox
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {entitlements.roleKeys.map((key) => (
            <Badge key={key} tone="blue">
              {key}
            </Badge>
          ))}
          {entitlements.permissions.map((expression) => (
            <code
              key={expression}
              className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-100"
            >
              {expression}
            </code>
          ))}
        </div>
      </Card>

      {fulfillmentMissing ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800"
        >
          Stripe has paid sandbox invoices for this user, but no local subscription
          or balance fulfillment has arrived. Check the sandbox webhook destination
          and replay the completed checkout event.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Balances" />
          {balances.length === 0 ? (
            <EmptyState title="No balances" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Unit</Th>
                  <Th>Amount</Th>
                  <Th>Available</Th>
                </tr>
              </thead>
              <tbody>
                {balances.map((balance) => (
                  <tr key={balance.balanceId}>
                    <Td>{balance.unitName}</Td>
                    <Td>{balance.amount.toLocaleString("en-US")}</Td>
                    <Td>
                      {(balance.amount - balance.reserved).toLocaleString("en-US")}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Usage" />
          {usage.length === 0 ? (
            <EmptyState title="No usage items" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Used</Th>
                  <Th>Resets</Th>
                </tr>
              </thead>
              <tbody>
                {usage.map((item) => (
                  <tr key={item.itemId}>
                    <Td>{item.name}</Td>
                    <Td>
                      {item.used}
                      {item.limit === null ? "" : ` / ${item.limit}`}
                    </Td>
                    <Td>
                      <span className="text-xs text-neutral-500">
                        {item.resetsAt ? formatDate(item.resetsAt) : "never"}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Subscriptions" />
        {subscriptions.length === 0 ? (
          <EmptyState title="No subscriptions" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Status</Th>
                <Th>Period ends</Th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <tr key={subscription.id}>
                  <Td>{subscription.planName}</Td>
                  <Td>
                    <Badge tone={statusTone(subscription.status)}>
                      {subscription.status}
                    </Badge>
                    {subscription.cancelAtPeriodEnd ? (
                      <span className="ml-2 text-xs text-neutral-500">
                        cancels at period end
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-xs text-neutral-500">
                      {formatDate(subscription.currentPeriodEnd)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Payments"
          description={`Invoices from the Stripe ${environment} account, including renewals and one-time purchases.`}
        />
        {!stripeConfigured(stripeMode) ? (
          <EmptyState
            title={`${environment === "sandbox" ? "Sandbox" : "Production"} Stripe is not configured`}
          />
        ) : paymentHistory.payments.length === 0 ? (
          <EmptyState title="No payments" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Description</Th>
                  <Th>Status</Th>
                  <Th>Amount</Th>
                  <Th>Date</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {paymentHistory.payments.map((payment) => (
                  <tr key={payment.id}>
                    <Td>
                      <span className="font-mono text-xs text-slate-600">
                        {payment.number ?? payment.id}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-medium text-slate-900">
                        {payment.description}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={invoiceStatusTone(payment.status)}>
                        {payment.status}
                      </Badge>
                    </Td>
                    <Td>{formatMoney(payment.amountCents, payment.currency)}</Td>
                    <Td>
                      <span className="text-xs text-slate-500">
                        {formatDate(payment.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      {payment.invoiceUrl ? (
                        <a
                          href={payment.invoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                        >
                          View invoice
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">Unavailable</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {hasPreviousPayments || hasNextPayments ? (
              <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-500">
                <span>Page {currentPaymentPage}</span>
                <div className="flex gap-3">
                  {hasPreviousPayments && firstPayment ? (
                    <Link
                      href={userDetailHref(appId, userId, environment, {
                        paymentPage: currentPaymentPage - 1,
                        paymentBefore: firstPayment.id,
                      })}
                      className="underline hover:text-slate-900"
                    >
                      Previous
                    </Link>
                  ) : null}
                  {hasNextPayments && lastPayment ? (
                    <Link
                      href={userDetailHref(appId, userId, environment, {
                        paymentPage: currentPaymentPage + 1,
                        paymentAfter: lastPayment.id,
                      })}
                      className="underline hover:text-slate-900"
                    >
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <FormDialog
          triggerLabel="Adjust balance"
          title="Adjust user balance"
          description="Add or deduct balance and record the reason in the ledger."
        >
          <ActionForm action={adjustBalanceAction} submitLabel="Apply adjustment">
            <input type="hidden" name="applicationId" value={appId} />
            <input type="hidden" name="appUserId" value={user.id} />
            <div className="mt-4 space-y-3">
              <Field label="Unit">
                <Select name="unitId" required>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Delta" hint="Negative to deduct">
                <Input name="delta" type="number" required placeholder="1000" />
              </Field>
              <Field label="Reason">
                <Input name="reason" required placeholder="Support credit" />
              </Field>
            </div>
          </ActionForm>
        </FormDialog>

        <FormDialog
          triggerLabel="Edit user level"
          title="Edit user level"
          description="Set this application's custom tier and optional level key."
          icon="edit"
          triggerVariant="secondary"
        >
          <ActionForm action={setUserLevelAction} submitLabel="Save level">
            <input type="hidden" name="applicationId" value={appId} />
            <input type="hidden" name="appUserId" value={user.id} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Level">
                <Input name="level" type="number" defaultValue={user.level} />
              </Field>
              <Field label="Level key">
                <Input name="levelKey" defaultValue={user.levelKey ?? ""} />
              </Field>
            </div>
          </ActionForm>
        </FormDialog>
      </div>

      <Card>
        <CardHeader title="Ledger" description="Every balance movement, newest first." />
        {ledger.entries.length === 0 ? (
          <EmptyState title="No entries" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Kind</Th>
                <Th>Change</Th>
                <Th>Balance</Th>
                <Th>Description</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.map((entry) => (
                <tr key={entry.id}>
                  <Td>
                    <span className="text-xs text-neutral-500">
                      {formatDate(entry.createdAt)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs">{entry.kind}</span>
                  </Td>
                  <Td>
                    <span
                      className={entry.delta < 0 ? "text-red-600" : "text-green-700"}
                    >
                      {entry.delta > 0 ? "+" : ""}
                      {entry.delta.toLocaleString("en-US")} {entry.unitKey}
                    </span>
                  </Td>
                  <Td>{entry.balanceAfter.toLocaleString("en-US")}</Td>
                  <Td>
                    <span className="text-xs text-neutral-600">
                      {entry.description}
                    </span>
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
