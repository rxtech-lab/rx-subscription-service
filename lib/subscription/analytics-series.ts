/**
 * Bucketing helpers behind the dashboard charts.
 *
 * Everything here is pure and UTC-based: a day is a calendar day in UTC, so the
 * same range produces the same buckets wherever the console is rendered — the
 * server and the browser must not disagree about which day a subscription
 * started on.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 2026-08-18, the key every series is indexed by. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The last `days` calendar days, ending on the day containing `end`. */
export function dateKeys(end: Date, days: number): string[] {
  const last = startOfUtcDay(end).getTime();
  return Array.from({ length: Math.max(1, days) }, (_, index) =>
    toDateKey(new Date(last - (Math.max(1, days) - 1 - index) * DAY_MS)),
  );
}

/** Count timestamps into the given day buckets; anything outside is dropped. */
export function countByDay(
  keys: string[],
  timestamps: (Date | null | undefined)[],
): number[] {
  const counts = new Map(keys.map((key) => [key, 0]));
  for (const timestamp of timestamps) {
    if (!timestamp) continue;
    const key = toDateKey(timestamp);
    const current = counts.get(key);
    if (current !== undefined) counts.set(key, current + 1);
  }
  return keys.map((key) => counts.get(key) ?? 0);
}

/** Sum amounts into day buckets. Used for revenue, which is integer cents. */
export function sumByDay(
  keys: string[],
  entries: { at: Date | null | undefined; amount: number }[],
): number[] {
  const totals = new Map(keys.map((key) => [key, 0]));
  for (const entry of entries) {
    if (!entry.at) continue;
    const key = toDateKey(entry.at);
    const current = totals.get(key);
    if (current !== undefined) totals.set(key, current + entry.amount);
  }
  return keys.map((key) => totals.get(key) ?? 0);
}

export interface Interval {
  start: Date;
  /** `null` means still running. */
  end: Date | null;
}

/**
 * How many intervals cover the end of each day.
 *
 * A subscription counts on the day it started and stops counting on the day it
 * ended, which is what "active subscriptions on that date" means to someone
 * reading the chart.
 */
export function activeByDay(keys: string[], intervals: Interval[]): number[] {
  return keys.map((key) => {
    const dayEnd = new Date(`${key}T23:59:59.999Z`).getTime();
    const dayStart = new Date(`${key}T00:00:00.000Z`).getTime();
    return intervals.filter((interval) => {
      if (interval.start.getTime() > dayEnd) return false;
      return interval.end === null || interval.end.getTime() >= dayStart;
    }).length;
  });
}

const MONTHS_PER_INTERVAL: Record<string, number | null> = {
  month: 1,
  quarter: 3,
  year: 12,
  // A one-time purchase has no recurring value, so it never enters MRR.
  one_time: null,
};

/**
 * A plan's monthly recurring value in cents.
 *
 * A yearly plan at $120 contributes $10 a month, and `intervalCount` stretches
 * the period further (every 2 months, every 2 years). Returns 0 for anything
 * that does not recur.
 */
export function monthlyRecurringCents(plan: {
  priceAmountCents: number;
  billingInterval: string;
  intervalCount: number;
}): number {
  const months = MONTHS_PER_INTERVAL[plan.billingInterval];
  if (!months) return 0;
  const period = months * Math.max(1, plan.intervalCount);
  return Math.round(plan.priceAmountCents / period);
}

/** Percentage change against the previous window, or null when it was empty. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Keep the largest `limit` slices and fold the tail into "Other" — more than a
 * handful of categories should not become more colours.
 */
export function topWithOther<T extends { label: string; value: number }>(
  items: T[],
  limit: number,
): { label: string; value: number }[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) {
    return sorted.map(({ label, value }) => ({ label, value }));
  }
  const head = sorted.slice(0, limit).map(({ label, value }) => ({ label, value }));
  const rest = sorted.slice(limit).reduce((total, item) => total + item.value, 0);
  return rest > 0 ? [...head, { label: "Other", value: rest }] : head;
}
