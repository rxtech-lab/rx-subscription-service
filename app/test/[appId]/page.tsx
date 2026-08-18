import { notFound } from "next/navigation";
import {
  advanceTestClockAction,
  increaseTestUsageLimitAction,
  resetTestClockAction,
  resetTestUsageAction,
} from "@/app/actions/test-usage";
import { InlineActionButton } from "@/components/forms/action-form";
import {
  NoticeToast,
  type NoticeTone,
} from "@/components/test-app/notice-toast";
import { SetClockForm } from "@/components/test-app/set-clock-form";
import { UsageAmountActions } from "@/components/test-app/usage-amount";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui/primitives";
import { resolveEntitlements } from "@/lib/subscription/entitlements";
import {
  DAY_MS,
  HOUR_MS,
  describeClockOffset,
  simulatedNow,
} from "@/lib/subscription/test-clock";
import { getUsageStatus } from "@/lib/subscription/usage";
import { getBalances } from "@/lib/subscription/users";
import { readTestSessionFor } from "@/lib/test-session";
import { formatDate } from "@/lib/utils";

type Notice = { tone: NoticeTone; message: string };

function checkoutNotice(value: string | string[] | undefined): Notice | null {
  const status = Array.isArray(value) ? value[0] : value;
  if (status === "success") {
    return {
      tone: "ok",
      message: "Purchase complete. Your entitlements below are up to date.",
    };
  }
  if (status === "cancelled") {
    return { tone: "warn", message: "Checkout was cancelled. Nothing was charged." };
  }
  if (status === "pending") {
    return {
      tone: "warn",
      message:
        "Payment is still processing. Refresh in a moment — the webhook will finish it.",
    };
  }
  if (status === "failed") {
    return {
      tone: "bad",
      message: "Checkout returned, but the purchase could not be verified.",
    };
  }
  return null;
}

/** How much one click of "Raise the limit" adds. */
const LIMIT_STEP = 10;

function usageNotice(
  value: string | string[] | undefined,
  amountValue: string | string[] | undefined,
): Notice | null {
  const outcome = Array.isArray(value) ? value[0] : value;
  const raw = Array.isArray(amountValue) ? amountValue[0] : amountValue;
  const amount = Number(raw);
  const spent = Number.isFinite(amount) && amount >= 1 ? Math.trunc(amount) : 1;
  switch (outcome) {
    case "recorded":
      return {
        tone: "ok",
        message: `Recorded ${spent.toLocaleString()} ${
          spent === 1 ? "unit" : "units"
        } of usage.`,
      };
    case "limit_exceeded":
      return {
        tone: "warn",
        message:
          "Blocked — that would take you past your limit for this item. Raise the limit and try again.",
      };
    case "insufficient_balance":
      return {
        tone: "warn",
        message:
          "Blocked — the overage needed more balance than you have. Buy a topup and try again.",
      };
    case "blocked":
      return { tone: "warn", message: "That usage was not allowed." };
    case "limit_raised":
      return {
        tone: "ok",
        message: `Limit raised by ${LIMIT_STEP}. This overrides the plan allowance for you only.`,
      };
    case "reset":
      return {
        tone: "ok",
        message: "Usage reset to zero for this period. The limit is unchanged.",
      };
    case "clock_moved":
      return {
        tone: "ok",
        message:
          "Clock moved. Any allowance whose period lapsed has rolled over below.",
      };
    case "clock_real":
      return { tone: "ok", message: "Back on real time." };
    case "already_unlimited":
      return { tone: "warn", message: "That item is already unlimited." };
    case "failed":
      return { tone: "bad", message: "That did not work. Please try again." };
    default:
      return null;
  }
}

export default async function TestOverviewPage({
  params,
  searchParams,
}: PageProps<"/test/[appId]">) {
  const { appId } = await params;
  const {
    checkout,
    usage: usageOutcome,
    amount: usageAmount,
    n: noticeNonce,
  } = await searchParams;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  const now = simulatedNow(session.user.testClockOffsetMs);
  const [entitlements, balances, usage] = await Promise.all([
    resolveEntitlements({ applicationId: appId, appUserId: session.user.id }),
    getBalances(session.user.id),
    getUsageStatus({ applicationId: appId, appUserId: session.user.id }),
  ]);
  const notice =
    checkoutNotice(checkout) ?? usageNotice(usageOutcome, usageAmount);
  // Each usage action carries a fresh nonce, so repeating the same action
  // remounts the toast instead of leaving the dismissed one hidden.
  const renderKey = `${Array.isArray(noticeNonce) ? noticeNonce[0] : noticeNonce}`;

  return (
    <>
      {notice ? (
        <NoticeToast key={renderKey} tone={notice.tone} message={notice.message} />
      ) : null}

      <Card>
        <CardHeader title="Your subscriptions" />
        {entitlements.plans.length === 0 ? (
          <EmptyState
            title="No active subscription"
            description="Pick a plan to see roles, permissions and allowances appear here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Status</Th>
                <Th>Renews</Th>
              </tr>
            </thead>
            <tbody>
              {entitlements.plans.map((plan) => (
                <tr key={plan.subscriptionId}>
                  <Td>
                    <p className="font-medium text-slate-900">{plan.planName}</p>
                    <p className="font-mono text-xs text-slate-500">{plan.planKey}</p>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(plan.status)}>{plan.status}</Badge>
                    {plan.cancelAtPeriodEnd ? (
                      <span className="ml-2 text-xs text-slate-500">ending</span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-500">
                      {formatDate(plan.currentPeriodEnd)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Balances" />
        {balances.length === 0 ? (
          <EmptyState title="No balances" description="Buy a topup to add units." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Unit</Th>
                <Th>Available</Th>
              </tr>
            </thead>
            <tbody>
              {balances.map((balance) => (
                <tr key={balance.unitId}>
                  <Td>{balance.unitName}</Td>
                  <Td>
                    <span className="font-medium text-slate-900">
                      {(balance.amount - balance.reserved).toLocaleString()}
                    </span>
                    {balance.reserved > 0 ? (
                      <span className="ml-2 text-xs text-slate-500">
                        {balance.reserved.toLocaleString()} reserved
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card id="clock">
        <CardHeader
          title="Simulated clock"
          description="Only this user's clock. Nothing else moves — but usage periods are worked out from the time, so a daily or monthly allowance rolls over as soon as you pass its reset."
        />
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-700">
            {formatDate(now)}
            <span className="ml-2 text-xs text-slate-500">
              {describeClockOffset(session.user.testClockOffsetMs)}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "+1 hour", byMs: HOUR_MS },
              { label: "+1 day", byMs: DAY_MS },
              { label: "+7 days", byMs: 7 * DAY_MS },
              { label: "+1 month", byMs: 31 * DAY_MS },
            ].map((step) => (
              <InlineActionButton
                key={step.label}
                action={advanceTestClockAction}
                label={step.label}
                variant="secondary"
              >
                <input type="hidden" name="byMs" value={step.byMs} />
              </InlineActionButton>
            ))}
            {session.user.testClockOffsetMs === 0 ? null : (
              <InlineActionButton
                action={resetTestClockAction}
                label="Back to real time"
                variant="secondary"
              />
            )}
          </div>
          <SetClockForm />
        </div>
      </Card>

      <Card id="usage">
        <CardHeader
          title="Usage this period"
          description="Spend against an allowance to see the limit bite, then raise it and carry on. A raised limit applies to you alone — the plan is untouched."
        />
        {usage.length === 0 ? (
          <EmptyState
            title="No metered usage"
            description="Define a usage item in the console to meter something here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Used</Th>
                <Th>Resets</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {usage.map((item) => {
                const atLimit = item.remaining !== null && item.remaining <= 0;
                return (
                  <tr key={item.itemId}>
                    <Td>
                      {item.name}
                      {atLimit ? (
                        <Badge tone="amber" className="ml-2">
                          at limit
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>
                      {item.used.toLocaleString()}
                      <span className="text-slate-400">
                        {" / "}
                        {item.limit === null
                          ? "unlimited"
                          : item.limit.toLocaleString()}
                      </span>
                      {item.itemId in entitlements.usageLimitOverrides ? (
                        <span className="ml-2 text-xs text-slate-500">
                          overridden
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-500">
                        {formatDate(item.resetsAt)}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <UsageAmountActions
                          appId={appId}
                          itemId={item.itemId}
                          itemName={item.name}
                        />
                        {item.limit === null ? null : (
                          <InlineActionButton
                            action={increaseTestUsageLimitAction}
                            label={`Raise limit +${LIMIT_STEP}`}
                            variant="secondary"
                          >
                            <input
                              type="hidden"
                              name="usageItemId"
                              value={item.itemId}
                            />
                            <input type="hidden" name="by" value={LIMIT_STEP} />
                          </InlineActionButton>
                        )}
                        <InlineActionButton
                          action={resetTestUsageAction}
                          label="Reset"
                          variant="secondary"
                        >
                          <input
                            type="hidden"
                            name="usageItemId"
                            value={item.itemId}
                          />
                        </InlineActionButton>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Access"
          description="What the platform reports to this application for you."
        />
        <div className="space-y-3 px-5 py-4">
          <div>
            <p className="text-xs font-semibold text-slate-700">Roles</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {entitlements.roleKeys.length === 0 ? (
                <span className="text-xs text-slate-400">None</span>
              ) : (
                entitlements.roleKeys.map((key) => (
                  <Badge key={key} tone="blue">
                    {key}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-700">Permissions</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {entitlements.permissions.length === 0 ? (
                <span className="text-xs text-slate-400">None</span>
              ) : (
                entitlements.permissions.map((expression) => (
                  <code
                    key={expression}
                    className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-slate-100"
                  >
                    {expression}
                  </code>
                ))
              )}
            </div>
          </div>
          {Object.keys(entitlements.features).length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-slate-700">Features</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {Object.entries(entitlements.features).map(([key, value]) => (
                  <Badge key={key}>
                    {key}
                    {value ? `: ${value}` : ""}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </>
  );
}
