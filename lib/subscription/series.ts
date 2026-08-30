/**
 * Time bucketing for the consumption and usage series.
 *
 * Everything here is pure and UTC, for the same reason `analytics-series.ts` is:
 * a bucket must not depend on where the console happens to be rendered, or the
 * server and the browser will disagree about which hour a debit landed in.
 *
 * The two series share this module rather than each carrying its own date
 * arithmetic. Duplicated bucketing is the failure that shows up as two charts on
 * one page whose columns do not line up, which is much harder to notice than an
 * outright error.
 */

/**
 * A bad range, reported without importing `shared.ts`.
 *
 * This module stays free of `server-only` and of any database import so the
 * bucket boundaries can be unit-tested on their own — the same discipline
 * `analytics-series.ts` follows. `apiError` dispatches on `name` rather than by
 * instance, so this still surfaces as a 400 like any other validation failure.
 */
export class SeriesRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export const GRANULARITIES = ["minute", "hour", "day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export function isGranularity(value: string): value is Granularity {
  return GRANULARITIES.some((granularity) => granularity === value);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * The ceiling on how many buckets one query may produce.
 *
 * Without it, `granularity: "minute"` over a year is 525,600 columns — a request
 * that cannot be charted and would only ever be a mistake or an attack. Refusing
 * with a clear message is friendlier than truncating, which would silently
 * answer a different question than the one asked.
 */
export const MAX_BUCKETS = 1_000;

/**
 * The ceiling on rows scanned to build a series.
 *
 * Bucketing happens in JS rather than SQL — the same choice
 * `getApplicationAnalytics` makes — so the bucket boundaries live in exactly one
 * place and stay unit-testable. The cost is that the rows have to be read, so an
 * unbounded range needs a stop.
 */
export const MAX_ROWS = 50_000;

/** The start of the bucket `date` falls in. */
export function bucketStart(date: Date, granularity: Granularity): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  switch (granularity) {
    case "minute":
      return new Date(
        Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes()),
      );
    case "hour":
      return new Date(Date.UTC(year, month, day, date.getUTCHours()));
    case "day":
      return new Date(Date.UTC(year, month, day));
    case "week": {
      // Weeks start Monday, so Sunday belongs to the week that began six days
      // earlier rather than opening a new one.
      const midnight = Date.UTC(year, month, day);
      const offset = (new Date(midnight).getUTCDay() + 6) % 7;
      return new Date(midnight - offset * DAY_MS);
    }
    case "month":
      return new Date(Date.UTC(year, month, 1));
  }
}

/** The bucket after this one. Months step by calendar, not by a fixed span. */
export function nextBucket(start: Date, granularity: Granularity): Date {
  if (granularity === "month") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
  const span =
    granularity === "minute"
      ? MINUTE_MS
      : granularity === "hour"
        ? HOUR_MS
        : granularity === "day"
          ? DAY_MS
          : WEEK_MS;
  return new Date(start.getTime() + span);
}

/** The key a bucket is indexed by, and the value the API returns. */
export function bucketKey(date: Date, granularity: Granularity): string {
  return bucketStart(date, granularity).toISOString();
}

/**
 * Every bucket in `[from, to]`, inclusive of the bucket containing each end.
 *
 * Returned in full rather than only where data exists: a chart with holes where
 * nothing happened reads as missing data, when the true answer is zero.
 */
export function bucketKeys(
  from: Date,
  to: Date,
  granularity: Granularity,
): string[] {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new SeriesRangeError("from and to must be valid dates");
  }
  if (from.getTime() > to.getTime()) {
    throw new SeriesRangeError("from must not be after to");
  }

  const last = bucketStart(to, granularity).getTime();
  const keys: string[] = [];
  let cursor = bucketStart(from, granularity);

  while (cursor.getTime() <= last) {
    if (keys.length >= MAX_BUCKETS) {
      throw new SeriesRangeError(
        `range produces more than ${MAX_BUCKETS} ${granularity} buckets — narrow the range or use a coarser granularity`,
      );
    }
    keys.push(cursor.toISOString());
    cursor = nextBucket(cursor, granularity);
  }
  return keys;
}

/**
 * Fold rows into zero-filled buckets.
 *
 * `seed` builds an empty bucket and `fold` accumulates one row into it, so the
 * two series can share the walk while keeping their own shapes — pts split into
 * spent/granted, usage into amount/events/charged.
 */
export function foldIntoBuckets<Row, Bucket>(
  keys: string[],
  rows: Row[],
  granularity: Granularity,
  at: (row: Row) => Date,
  seed: (start: string) => Bucket,
  fold: (bucket: Bucket, row: Row) => Bucket,
): Bucket[] {
  const buckets = new Map(keys.map((key) => [key, seed(key)]));
  for (const row of rows) {
    const key = bucketKey(at(row), granularity);
    const current = buckets.get(key);
    // Anything outside the requested window is dropped rather than clamped into
    // an edge bucket, which would overstate the first or last column.
    if (current !== undefined) buckets.set(key, fold(current, row));
  }
  return keys.map((key) => buckets.get(key)!);
}

export interface ConsumptionAccumulator {
  start: string;
  spent: number;
  granted: number;
  net: number;
  entryCount: number;
}

/** Apply one signed ledger delta using the public spent/granted convention. */
export function addConsumptionDelta<T extends ConsumptionAccumulator>(
  bucket: T,
  delta: number,
): T {
  return {
    ...bucket,
    spent: bucket.spent + (delta < 0 ? -delta : 0),
    granted: bucket.granted + (delta > 0 ? delta : 0),
    net: bucket.net + delta,
    entryCount: bucket.entryCount + 1,
  };
}

/** Guard a row set that came back at the scan ceiling. */
export function assertWithinRowLimit(count: number): void {
  if (count > MAX_ROWS) {
    throw new SeriesRangeError(
      `range covers more than ${MAX_ROWS} entries — narrow the range`,
    );
  }
}
