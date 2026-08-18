import { notFound } from "next/navigation";
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
import { getUsageStatus } from "@/lib/subscription/usage";
import { getBalances } from "@/lib/subscription/users";
import { readTestSessionFor } from "@/lib/test-session";
import { formatDate } from "@/lib/utils";

function checkoutNotice(value: string | string[] | undefined) {
  const status = Array.isArray(value) ? value[0] : value;
  if (status === "success") {
    return {
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      message: "Purchase complete. Your entitlements below are up to date.",
    };
  }
  if (status === "cancelled") {
    return {
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      message: "Checkout was cancelled. Nothing was charged.",
    };
  }
  if (status === "pending") {
    return {
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      message:
        "Payment is still processing. Refresh in a moment — the webhook will finish it.",
    };
  }
  if (status === "failed") {
    return {
      tone: "border-rose-200 bg-rose-50 text-rose-800",
      message: "Checkout returned, but the purchase could not be verified.",
    };
  }
  return null;
}

export default async function TestOverviewPage({
  params,
  searchParams,
}: PageProps<"/test/[appId]">) {
  const { appId } = await params;
  const { checkout } = await searchParams;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  const [entitlements, balances, usage] = await Promise.all([
    resolveEntitlements({ applicationId: appId, appUserId: session.user.id }),
    getBalances(session.user.id),
    getUsageStatus({ applicationId: appId, appUserId: session.user.id }),
  ]);
  const notice = checkoutNotice(checkout);

  return (
    <>
      {notice ? (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${notice.tone}`}
        >
          {notice.message}
        </div>
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

      <Card>
        <CardHeader title="Usage this period" />
        {usage.length === 0 ? (
          <EmptyState title="No metered usage" />
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
                    {item.used.toLocaleString()}
                    <span className="text-slate-400">
                      {" / "}
                      {item.limit === null ? "unlimited" : item.limit.toLocaleString()}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-500">
                      {formatDate(item.resetsAt)}
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
