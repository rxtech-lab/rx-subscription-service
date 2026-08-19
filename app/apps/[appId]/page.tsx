import Link from "next/link";
import { AnalyticsOverview } from "@/components/console/analytics-overview";
import { Card, CardHeader } from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import {
  clampAnalyticsDays,
  getApplicationAnalytics,
} from "@/lib/subscription/analytics";
import { listPlans } from "@/lib/subscription/plans";
import { listRoles } from "@/lib/subscription/roles";
import { listTopupProducts } from "@/lib/subscription/topups";
import { listUsageItems } from "@/lib/subscription/usage-items";
import { listBalanceUnits } from "@/lib/subscription/units";
import { listAppUsers } from "@/lib/subscription/users";
import { listSubscriptions } from "@/lib/subscription/subscriptions";

export default async function OverviewPage({
  params,
  searchParams,
}: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const { days } = await searchParams;
  const range = clampAnalyticsDays(Number(Array.isArray(days) ? days[0] : days));

  const [plans, topups, roles, usageItems, units, users, subscriptions, analytics] =
    await Promise.all([
      listPlans(appId),
      listTopupProducts(appId),
      listRoles(appId),
      listUsageItems(appId),
      listBalanceUnits(appId),
      listAppUsers(appId),
      listSubscriptions(appId),
      getApplicationAnalytics(appId, { days: range }),
    ]);

  // Test users are excluded from the Users count by `listAppUsers`, so their
  // subscriptions are excluded here too — otherwise the dashboard would report
  // more subscriptions than it has users to explain them.
  const activeSubscriptions = subscriptions.filter(
    (subscription) =>
      !subscription.isTest &&
      ["active", "trialing", "past_due"].includes(subscription.status),
  );

  const stats = [
    { label: "Plans", value: plans.length, href: "plans" },
    { label: "Topups", value: topups.length, href: "topups" },
    { label: "Roles", value: roles.length, href: "roles" },
    { label: "Usage items", value: usageItems.length, href: "usage-items" },
    { label: "Balance units", value: units.length, href: "units" },
    { label: "Users", value: users.pagination.totalCount, href: "users" },
    {
      label: "Active subscriptions",
      value: activeSubscriptions.length,
      href: "subscriptions",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={`/apps/${appId}/${stat.href}`}
            prefetch={false}
          >
            <Card className="p-4 transition hover:border-neutral-400">
              <p className="text-xs text-neutral-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-neutral-900">
                {stat.value}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <AnalyticsOverview appId={appId} analytics={analytics} />

      <Card>
        <CardHeader
          title="Getting started"
          description="A workable setup needs these pieces, roughly in this order."
        />
        <ol className="space-y-3 px-5 py-4 text-sm text-neutral-600">
          <li>
            <span className="font-medium text-neutral-900">1. Balance units</span> —
            define what you meter, such as points or credits, and set what they are
            worth in each currency.
          </li>
          <li>
            <span className="font-medium text-neutral-900">2. Roles and permissions</span>{" "}
            — describe what a subscriber may do, using the{" "}
            <code className="rounded bg-neutral-100 px-1">read:a:all</code> /{" "}
            <code className="rounded bg-neutral-100 px-1">read:a:id1,id2</code> syntax.
          </li>
          <li>
            <span className="font-medium text-neutral-900">3. Usage items</span> — the
            things you count per user, and how often they reset.
          </li>
          <li>
            <span className="font-medium text-neutral-900">4. Plans</span> — monthly,
            quarterly, yearly, or one-time, each granting roles, allowances, and
            balances.
          </li>
          <li>
            <span className="font-medium text-neutral-900">5. Topups</span> — extra
            balance to buy, optionally gated behind a plan.
          </li>
          <li>
            <span className="font-medium text-neutral-900">6. An API key</span> — under
            Settings, so your app can read entitlements and report usage.
          </li>
        </ol>
      </Card>

      <Card>
        <CardHeader
          title="Assistant"
          description="The button in the bottom-right corner opens a chat that can make these changes for you. It asks before applying anything."
        />
      </Card>
    </div>
  );
}
