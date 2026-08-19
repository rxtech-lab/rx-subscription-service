import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/primitives";
import { BarChart } from "@/components/charts/bar-chart";
import { formatCents, formatCompact } from "@/components/charts/chart-format";
import { LineChart } from "@/components/charts/line-chart";
import { StatTile } from "@/components/charts/stat-tile";
import type { ApplicationAnalytics } from "@/lib/subscription/analytics";
import { cn } from "@/lib/utils";

const RANGES = [7, 30, 90] as const;

/**
 * The charted half of the application overview.
 *
 * Rendered on the server from one analytics query; only the marks themselves
 * are client components, because they need hover.
 */
export function AnalyticsOverview({
  appId,
  analytics,
}: {
  appId: string;
  analytics: ApplicationAnalytics;
}) {
  const { totals, series, breakdowns, currency, days } = analytics;
  const revenueDelta =
    totals.netRevenueChangePercent === null
      ? undefined
      : `${Math.abs(totals.netRevenueChangePercent)}% vs previous ${days} days`;
  const subscriptionDelta =
    totals.newSubscriptionsChangePercent === null
      ? undefined
      : `${Math.abs(totals.newSubscriptionsChangePercent)}% vs previous ${days} days`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">
          Last {days} days
        </h2>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
          {RANGES.map((range) => (
            <Link
              key={range}
              href={`/apps/${appId}?days=${range}`}
              prefetch={false}
              scroll={false}
              aria-current={range === days ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                range === days
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {range}d
            </Link>
          ))}
        </div>
      </div>

      <Card className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Monthly recurring revenue"
          value={formatCents(totals.mrrCents, currency)}
          hint={`${totals.activeSubscriptions} active subscriptions`}
        />
        <StatTile
          label={`Net revenue (${days}d)`}
          value={formatCents(totals.netCents, currency)}
          delta={revenueDelta}
          deltaDirection={directionOf(totals.netRevenueChangePercent)}
          hint={
            totals.refundedCents > 0
              ? `${formatCents(totals.refundedCents, currency)} refunded`
              : undefined
          }
          trend={series.netRevenue.points.map((point) => point.y)}
        />
        <StatTile
          label={`New subscriptions (${days}d)`}
          value={formatCompact(totals.newSubscriptions)}
          delta={subscriptionDelta}
          deltaDirection={directionOf(totals.newSubscriptionsChangePercent)}
          hint={`${totals.canceledSubscriptions} canceled`}
          trend={series.newSubscriptions.points.map((point) => point.y)}
        />
        <StatTile
          label={`Paying users (${days}d)`}
          value={formatCompact(totals.payingUsers)}
          hint={`${formatCompact(totals.newUsers)} new of ${formatCompact(
            totals.totalUsers,
          )} total`}
        />
      </Card>

      {analytics.otherCurrencies.length > 0 ? (
        <p className="text-xs text-slate-500">
          Charted in {currency.toUpperCase()}. Also collected:{" "}
          {analytics.otherCurrencies
            .map((entry) => formatCents(entry.netCents, entry.currency))
            .join(", ")}
          .
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <LineChart
            title="Active subscriptions"
            description="Subscriptions live at the end of each day, excluding test users."
            series={[series.activeSubscriptions]}
          />
        </Card>

        <Card className="p-5">
          <BarChart
            title="Net revenue per day"
            description="Paid one-time purchases and topups, less refunds."
            series={[series.netRevenue]}
            format="currency"
            currency={currency}
          />
        </Card>

        <Card className="p-5">
          <BarChart
            title="Subscription changes per day"
            description="Started against ended, on the same scale."
            series={[series.newSubscriptions, series.canceledSubscriptions]}
          />
        </Card>

        <Card className="p-5">
          <BarChart
            title="Revenue by product"
            description={`Net cents per plan or topup over the last ${days} days.`}
            orientation="horizontal"
            format="currency"
            currency={currency}
            series={[
              {
                label: "Net revenue",
                points: breakdowns.revenueByProduct.map((entry) => ({
                  x: entry.label,
                  y: entry.value,
                })),
              },
            ]}
          />
        </Card>
      </div>

      {breakdowns.subscribersByPlan.length > 0 ? (
        <Card>
          <CardHeader
            title="Subscribers by plan"
            description="Active, trialing, and past-due subscriptions."
          />
          <div className="px-5 py-4">
            <BarChart
              orientation="horizontal"
              series={[
                {
                  label: "Subscribers",
                  points: breakdowns.subscribersByPlan.map((entry) => ({
                    x: entry.label,
                    y: entry.value,
                  })),
                },
              ]}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function directionOf(change: number | null): "up" | "down" | "flat" {
  if (change === null || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}
