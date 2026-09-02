import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  plans,
  purchases,
  storeProductMappings,
  storeProductPrices,
  subscriptions,
  topupProducts,
} from "@/lib/db/schema";
import {
  activeByDay,
  countByDay,
  dateKeys,
  monthlyRecurringCents,
  percentChange,
  sumByDay,
  topWithOther,
  type Interval,
} from "./analytics-series";

export const DEFAULT_ANALYTICS_DAYS = 30;
const MAX_ANALYTICS_DAYS = 365;

/** Statuses that mean "this subscription is currently worth money". */
const LIVE_STATUSES = ["active", "trialing", "past_due"] as const;

export interface AnalyticsSeries {
  label: string;
  points: { x: string; y: number }[];
}

export interface ApplicationAnalytics {
  days: number;
  dates: string[];
  currency: string;
  /** Totals for currencies other than the primary one, which is charted. */
  otherCurrencies: { currency: string; netCents: number }[];
  totals: {
    activeSubscriptions: number;
    newSubscriptions: number;
    canceledSubscriptions: number;
    mrrCents: number;
    grossCents: number;
    refundedCents: number;
    netCents: number;
    payingUsers: number;
    newUsers: number;
    totalUsers: number;
    newSubscriptionsChangePercent: number | null;
    netRevenueChangePercent: number | null;
  };
  series: {
    activeSubscriptions: AnalyticsSeries;
    newSubscriptions: AnalyticsSeries;
    canceledSubscriptions: AnalyticsSeries;
    netRevenue: AnalyticsSeries;
    newUsers: AnalyticsSeries;
  };
  breakdowns: {
    revenueByProduct: { label: string; value: number }[];
    subscribersByPlan: { label: string; value: number }[];
  };
}

export function clampAnalyticsDays(days: number | undefined): number {
  if (!Number.isFinite(days ?? NaN)) return DEFAULT_ANALYTICS_DAYS;
  return Math.min(MAX_ANALYTICS_DAYS, Math.max(7, Math.round(days as number)));
}

/**
 * Everything the overview dashboard and the assistant's data tools chart.
 *
 * Test users are excluded throughout, matching the Users count and the
 * subscription count on the same page — a dashboard that counted disposable
 * test rows as customers would be worse than no dashboard.
 */
export async function getApplicationAnalytics(
  applicationId: string,
  options: { days?: number } = {},
): Promise<ApplicationAnalytics> {
  const days = clampAnalyticsDays(options.days);
  const now = new Date();
  const dates = dateKeys(now, days);
  const rangeStart = new Date(`${dates[0]}T00:00:00.000Z`);
  // The previous window of the same length, for the "vs" deltas.
  const previousDates = dateKeys(new Date(rangeStart.getTime() - 1), days);
  const previousStart = new Date(`${previousDates[0]}T00:00:00.000Z`);

  const [subscriptionRows, purchaseRows, userRows] = await Promise.all([
    db
      .select({
        status: subscriptions.status,
        startedAt: subscriptions.startedAt,
        endedAt: subscriptions.endedAt,
        planName: plans.name,
        // A subscription sold through a store is worth the store's price, not
        // the local one, whenever the two differ.
        priceAmountCents: sql<number>`COALESCE(${storeProductPrices.priceAmountCents}, ${plans.priceAmountCents})`,
        billingInterval: plans.billingInterval,
        intervalCount: plans.intervalCount,
        currency: sql<string>`COALESCE(${storeProductPrices.currency}, ${plans.currency})`,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .innerJoin(appUsers, eq(subscriptions.appUserId, appUsers.id))
      // No mapping row carries the `stripe` provider, so a Stripe subscription
      // finds nothing here and keeps the plan price.
      .leftJoin(
        storeProductMappings,
        and(
          eq(storeProductMappings.planId, plans.id),
          eq(storeProductMappings.provider, subscriptions.billingProvider),
        ),
      )
      .leftJoin(
        storeProductPrices,
        eq(storeProductPrices.storeProductMappingId, storeProductMappings.id),
      )
      .where(
        and(
          eq(subscriptions.applicationId, applicationId),
          eq(appUsers.isTest, false),
        ),
      ),

    db
      .select({
        appUserId: purchases.appUserId,
        kind: purchases.kind,
        amountCents: purchases.amountCents,
        refundedAmountCents: purchases.refundedAmountCents,
        currency: purchases.currency,
        paidAt: purchases.paidAt,
        createdAt: purchases.createdAt,
        planName: plans.name,
        topupName: topupProducts.name,
      })
      .from(purchases)
      .innerJoin(appUsers, eq(purchases.appUserId, appUsers.id))
      .leftJoin(plans, eq(purchases.planId, plans.id))
      .leftJoin(topupProducts, eq(purchases.topupProductId, topupProducts.id))
      .where(
        and(
          eq(purchases.applicationId, applicationId),
          eq(appUsers.isTest, false),
          inArray(purchases.status, ["paid", "refunded", "disputed"]),
          gte(purchases.createdAt, previousStart),
        ),
      ),

    db
      .select({ createdAt: appUsers.createdAt })
      .from(appUsers)
      .where(
        and(eq(appUsers.applicationId, applicationId), eq(appUsers.isTest, false)),
      ),
  ]);

  // A subscription that never left `incomplete` was an abandoned checkout, not
  // a customer, so it is kept out of every count here.
  const realSubscriptions = subscriptionRows.filter(
    (row) => row.status !== "incomplete",
  );
  const liveSubscriptions = realSubscriptions.filter((row) =>
    (LIVE_STATUSES as readonly string[]).includes(row.status),
  );

  const intervals: Interval[] = realSubscriptions.map((row) => ({
    start: row.startedAt,
    end: row.endedAt,
  }));

  const currency = primaryCurrency(purchaseRows, liveSubscriptions);
  const chartedPurchases = purchaseRows.filter((row) => row.currency === currency);
  const paidAtOf = (row: (typeof purchaseRows)[number]) => row.paidAt ?? row.createdAt;

  const inRange = <T,>(rows: T[], at: (row: T) => Date | null) =>
    rows.filter((row) => {
      const value = at(row);
      return value !== null && value >= rangeStart;
    });

  const rangePurchases = inRange(chartedPurchases, paidAtOf);
  const previousPurchases = chartedPurchases.filter((row) => {
    const at = paidAtOf(row);
    return at >= previousStart && at < rangeStart;
  });

  const netOf = (row: (typeof purchaseRows)[number]) =>
    row.amountCents - row.refundedAmountCents;

  const grossCents = rangePurchases.reduce((total, row) => total + row.amountCents, 0);
  const refundedCents = rangePurchases.reduce(
    (total, row) => total + row.refundedAmountCents,
    0,
  );

  const newSubscriptionsInRange = realSubscriptions.filter(
    (row) => row.startedAt >= rangeStart,
  ).length;
  const previousNewSubscriptions = realSubscriptions.filter(
    (row) => row.startedAt >= previousStart && row.startedAt < rangeStart,
  ).length;

  const revenueByProduct = topWithOther(
    aggregate(
      rangePurchases.map((row) => ({
        label:
          row.kind === "topup"
            ? row.topupName ?? "Topup"
            : row.planName ?? "One-time plan",
        value: netOf(row),
      })),
    ),
    5,
  );

  const subscribersByPlan = topWithOther(
    aggregate(liveSubscriptions.map((row) => ({ label: row.planName, value: 1 }))),
    5,
  );

  return {
    days,
    dates,
    currency,
    otherCurrencies: otherCurrencyTotals(purchaseRows, currency, rangeStart, paidAtOf),
    totals: {
      activeSubscriptions: liveSubscriptions.length,
      newSubscriptions: newSubscriptionsInRange,
      canceledSubscriptions: realSubscriptions.filter(
        (row) => row.endedAt !== null && row.endedAt >= rangeStart,
      ).length,
      mrrCents: liveSubscriptions.reduce(
        (total, row) => total + monthlyRecurringCents(row),
        0,
      ),
      grossCents,
      refundedCents,
      netCents: grossCents - refundedCents,
      payingUsers: new Set(rangePurchases.map((row) => row.appUserId)).size,
      newUsers: userRows.filter((row) => row.createdAt >= rangeStart).length,
      totalUsers: userRows.length,
      newSubscriptionsChangePercent: percentChange(
        newSubscriptionsInRange,
        previousNewSubscriptions,
      ),
      netRevenueChangePercent: percentChange(
        grossCents - refundedCents,
        previousPurchases.reduce((total, row) => total + netOf(row), 0),
      ),
    },
    series: {
      activeSubscriptions: series("Active", dates, activeByDay(dates, intervals)),
      newSubscriptions: series(
        "New",
        dates,
        countByDay(
          dates,
          realSubscriptions.map((row) => row.startedAt),
        ),
      ),
      canceledSubscriptions: series(
        "Canceled",
        dates,
        countByDay(
          dates,
          realSubscriptions.map((row) => row.endedAt),
        ),
      ),
      netRevenue: series(
        "Net revenue",
        dates,
        sumByDay(
          dates,
          chartedPurchases.map((row) => ({ at: paidAtOf(row), amount: netOf(row) })),
        ),
      ),
      newUsers: series(
        "New users",
        dates,
        countByDay(
          dates,
          userRows.map((row) => row.createdAt),
        ),
      ),
    },
    breakdowns: { revenueByProduct, subscribersByPlan },
  };
}

/**
 * The most recent payments, newest first.
 *
 * The console lists subscriptions and users but never the money itself, and
 * "what did we take last week" is a question both the dashboard and the
 * assistant get asked.
 */
export async function listRecentPurchases(
  applicationId: string,
  options: { limit?: number; includeTest?: boolean } = {},
) {
  const limit = Math.min(200, Math.max(1, options.limit ?? 25));
  const where = options.includeTest
    ? eq(purchases.applicationId, applicationId)
    : and(eq(purchases.applicationId, applicationId), eq(appUsers.isTest, false));

  return db
    .select({
      id: purchases.id,
      kind: purchases.kind,
      status: purchases.status,
      amountCents: purchases.amountCents,
      refundedAmountCents: purchases.refundedAmountCents,
      currency: purchases.currency,
      unitsGranted: purchases.unitsGranted,
      createdAt: purchases.createdAt,
      paidAt: purchases.paidAt,
      planName: plans.name,
      topupName: topupProducts.name,
      userLabel: appUsers.displayName,
      userEmail: appUsers.email,
      isTest: appUsers.isTest,
    })
    .from(purchases)
    .innerJoin(appUsers, eq(purchases.appUserId, appUsers.id))
    .leftJoin(plans, eq(purchases.planId, plans.id))
    .leftJoin(topupProducts, eq(purchases.topupProductId, topupProducts.id))
    .where(where)
    .orderBy(desc(purchases.createdAt))
    .limit(limit);
}

function series(label: string, dates: string[], values: number[]): AnalyticsSeries {
  return { label, points: dates.map((date, index) => ({ x: date, y: values[index] })) };
}

function aggregate(items: { label: string; value: number }[]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.label, (totals.get(item.label) ?? 0) + item.value);
  }
  return [...totals].map(([label, value]) => ({ label, value }));
}

/**
 * Cents in different currencies must never be added together, so one currency
 * is charted — whichever earned the most — and the rest are reported beside it.
 */
function primaryCurrency(
  purchaseRows: { currency: string; amountCents: number }[],
  subscriptionRows: { currency: string }[],
): string {
  const totals = new Map<string, number>();
  for (const row of purchaseRows) {
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amountCents);
  }
  if (totals.size === 0) {
    return subscriptionRows[0]?.currency ?? "usd";
  }
  return [...totals].sort((a, b) => b[1] - a[1])[0][0];
}

function otherCurrencyTotals<
  T extends { currency: string; amountCents: number; refundedAmountCents: number },
>(rows: T[], primary: string, rangeStart: Date, at: (row: T) => Date) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.currency === primary || at(row) < rangeStart) continue;
    const net = row.amountCents - row.refundedAmountCents;
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + net);
  }
  return [...totals]
    .map(([currency, netCents]) => ({ currency, netCents }))
    .sort((a, b) => b.netCents - a.netCents);
}
