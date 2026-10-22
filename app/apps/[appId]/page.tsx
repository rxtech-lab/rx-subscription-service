import Link from "next/link";
import { AnalyticsOverview } from "@/components/console/analytics-overview";
import { Card } from "@/components/ui/primitives";
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
import { getApplicationPaywall } from "@/lib/paywall/paywalls";

export default async function OverviewPage({
  params,
  searchParams,
}: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const { days } = await searchParams;
  const range = clampAnalyticsDays(Number(Array.isArray(days) ? days[0] : days));

  const [plans, topups, roles, usageItems, units, users, subscriptions, analytics, paywall] =
    await Promise.all([
      listPlans(appId),
      listTopupProducts(appId),
      listRoles(appId),
      listUsageItems(appId),
      listBalanceUnits(appId),
      listAppUsers(appId),
      listSubscriptions(appId),
      getApplicationAnalytics(appId, { days: range }),
      getApplicationPaywall(appId),
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
    { label: "Paywall", value: paywall?.name ?? "None", href: "paywall" },
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

    </div>
  );
}
