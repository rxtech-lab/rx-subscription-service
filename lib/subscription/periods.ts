import type { ResetPolicy, ResetUnit } from "@/lib/db/schema";

/**
 * Usage periods.
 *
 * Counters are never reset by a background job — a read or increment computes
 * which period `now` falls in, and the caller opens that row if it does not
 * exist yet. That makes resets exact at any granularity without a cron, and it
 * means a user who is idle for a month does not accumulate empty rows.
 */

export interface Period {
  start: Date;
  /** Null means the period never ends (`never` policy). */
  end: Date | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * The Monday on or before the epoch. 1970-01-01 was a Thursday, so weekly
 * periods anchor three days earlier to line up with an ISO week start.
 */
const WEEK_ANCHOR_MS = -3 * DAY_MS;

export interface PeriodInput {
  resetPolicy: ResetPolicy;
  resetIntervalCount?: number | null;
  resetIntervalUnit?: ResetUnit | null;
  /** Start of the current period of an existing counter, when there is one. */
  currentStart?: Date | null;
  currentEnd?: Date | null;
  /** Subscription window, used by the `billing_period` policy. */
  billingPeriodStart?: Date | null;
  billingPeriodEnd?: Date | null;
}

function intervalCount(input: PeriodInput): number {
  const count = input.resetIntervalCount ?? 1;
  return Number.isSafeInteger(count) && count >= 1 ? count : 1;
}

function addMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function rollingEnd(start: Date, count: number, unit: ResetUnit): Date {
  switch (unit) {
    case "hour":
      return new Date(start.getTime() + count * HOUR_MS);
    case "day":
      return new Date(start.getTime() + count * DAY_MS);
    case "week":
      return new Date(start.getTime() + count * 7 * DAY_MS);
    case "month":
      return addMonths(start, count);
  }
}

function calendarPeriod(now: Date, count: number, unit: ResetUnit): Period {
  const ms = now.getTime();

  if (unit === "month") {
    const monthIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
    const alignedIndex = Math.floor(monthIndex / count) * count;
    const start = new Date(
      Date.UTC(Math.floor(alignedIndex / 12), alignedIndex % 12, 1),
    );
    return { start, end: addMonths(start, count) };
  }

  const span =
    unit === "hour"
      ? count * HOUR_MS
      : unit === "day"
        ? count * DAY_MS
        : count * 7 * DAY_MS;
  const anchor = unit === "week" ? WEEK_ANCHOR_MS : 0;
  const start = Math.floor((ms - anchor) / span) * span + anchor;
  return { start: new Date(start), end: new Date(start + span) };
}

/**
 * The period `now` belongs to.
 *
 * `rolling_window` is anchored on the existing counter: while the current window
 * is still open it is returned unchanged, and once it lapses a fresh window
 * starts at `now` rather than back-filling the gap.
 */
export function resolvePeriod(now: Date, input: PeriodInput): Period {
  if (input.resetPolicy === "never") {
    return { start: new Date(0), end: null };
  }

  if (input.resetPolicy === "billing_period") {
    const start = input.billingPeriodStart;
    const end = input.billingPeriodEnd;
    if (start && end && now >= start && now < end) return { start, end };
    // No subscription window to follow — fall back to calendar months so usage
    // still resets predictably instead of accumulating forever.
    return calendarPeriod(now, 1, "month");
  }

  const unit = input.resetIntervalUnit ?? "month";
  const count = intervalCount(input);

  if (input.resetPolicy === "calendar_period") {
    return calendarPeriod(now, count, unit);
  }

  // rolling_window
  const currentStart = input.currentStart;
  const currentEnd = input.currentEnd;
  if (currentStart && currentEnd && now >= currentStart && now < currentEnd) {
    return { start: currentStart, end: currentEnd };
  }
  return { start: now, end: rollingEnd(now, count, unit) };
}

/** Has this counter's window lapsed as of `now`? */
export function isPeriodExpired(now: Date, end: Date | null): boolean {
  return end !== null && now >= end;
}
