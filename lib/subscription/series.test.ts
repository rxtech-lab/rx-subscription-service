import { describe, expect, it } from "vitest";
import {
  addConsumptionDelta,
  bucketKey,
  bucketKeys,
  bucketStart,
  type ConsumptionAccumulator,
  foldIntoBuckets,
  isGranularity,
  MAX_BUCKETS,
  nextBucket,
} from "./series";

const at = (iso: string) => new Date(iso);
const iso = (date: Date) => date.toISOString();

describe("bucketStart", () => {
  it("floors to the minute, hour and day in UTC", () => {
    const instant = at("2026-08-18T13:47:31.482Z");
    expect(iso(bucketStart(instant, "minute"))).toBe("2026-08-18T13:47:00.000Z");
    expect(iso(bucketStart(instant, "hour"))).toBe("2026-08-18T13:00:00.000Z");
    expect(iso(bucketStart(instant, "day"))).toBe("2026-08-18T00:00:00.000Z");
  });

  it("floors a month to its first day", () => {
    expect(iso(bucketStart(at("2026-08-31T23:59:59.999Z"), "month"))).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  // A Sunday belongs to the week that opened the previous Monday. Getting this
  // backwards silently shifts every weekly column by six days.
  it("floors a week to Monday, including on Sunday itself", () => {
    // 2026-08-18 is a Tuesday.
    expect(iso(bucketStart(at("2026-08-18T13:00:00Z"), "week"))).toBe(
      "2026-08-17T00:00:00.000Z",
    );
    // 2026-08-23 is the Sunday that closes that same week.
    expect(iso(bucketStart(at("2026-08-23T23:00:00Z"), "week"))).toBe(
      "2026-08-17T00:00:00.000Z",
    );
    // 2026-08-24 is the next Monday, which opens its own bucket.
    expect(iso(bucketStart(at("2026-08-24T00:00:00Z"), "week"))).toBe(
      "2026-08-24T00:00:00.000Z",
    );
  });
});

describe("nextBucket", () => {
  it("steps months by calendar rather than a fixed span", () => {
    // February is short and 2028 is a leap year; a fixed 30-day step drifts.
    expect(iso(nextBucket(at("2028-01-01T00:00:00Z"), "month"))).toBe(
      "2028-02-01T00:00:00.000Z",
    );
    expect(iso(nextBucket(at("2028-02-01T00:00:00Z"), "month"))).toBe(
      "2028-03-01T00:00:00.000Z",
    );
  });

  it("rolls a month step across a year boundary", () => {
    expect(iso(nextBucket(at("2026-12-01T00:00:00Z"), "month"))).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("bucketKeys", () => {
  it("uses UTC boundaries regardless of the offset the caller passed", () => {
    expect(
      bucketKeys(at("2026-08-29T23:30:00-04:00"), at("2026-08-31T00:30:00Z"), "day"),
    ).toEqual(["2026-08-30T00:00:00.000Z", "2026-08-31T00:00:00.000Z"]);
  });

  it("covers both ends inclusively", () => {
    expect(
      bucketKeys(at("2026-08-18T10:30:00Z"), at("2026-08-18T12:05:00Z"), "hour"),
    ).toEqual([
      "2026-08-18T10:00:00.000Z",
      "2026-08-18T11:00:00.000Z",
      "2026-08-18T12:00:00.000Z",
    ]);
  });

  it("returns a single bucket when both ends fall inside one", () => {
    expect(
      bucketKeys(at("2026-08-18T10:01:00Z"), at("2026-08-18T10:59:00Z"), "hour"),
    ).toEqual(["2026-08-18T10:00:00.000Z"]);
  });

  it("rejects a reversed range", () => {
    expect(() =>
      bucketKeys(at("2026-08-19T00:00:00Z"), at("2026-08-18T00:00:00Z"), "day"),
    ).toThrow(/from must not be after to/);
  });

  it("refuses a range past the bucket ceiling", () => {
    const from = at("2026-01-01T00:00:00Z");
    const to = new Date(from.getTime() + MAX_BUCKETS * 60_000);
    expect(() => bucketKeys(from, to, "minute")).toThrow(
      `range produces more than ${MAX_BUCKETS} minute buckets`,
    );
  });

  it("allows a range that lands exactly on the ceiling", () => {
    const from = at("2026-01-01T00:00:00Z");
    const to = new Date(from.getTime() + (MAX_BUCKETS - 1) * 60_000);
    expect(bucketKeys(from, to, "minute")).toHaveLength(MAX_BUCKETS);
  });
});

describe("foldIntoBuckets", () => {
  const keys = bucketKeys(at("2026-08-18T00:00:00Z"), at("2026-08-20T00:00:00Z"), "day");
  const seed = (start: string) => ({ start, total: 0 });
  const fold = (
    bucket: { start: string; total: number },
    row: { at: Date; value: number },
  ) => ({ start: bucket.start, total: bucket.total + row.value });

  it("zero-fills days where nothing happened", () => {
    const folded = foldIntoBuckets(
      keys,
      [{ at: at("2026-08-20T09:00:00Z"), value: 5 }],
      "day",
      (row) => row.at,
      seed,
      fold,
    );
    // A gap must read as zero, not as a missing column — otherwise a quiet day
    // looks like an outage in the chart.
    expect(folded.map((bucket) => bucket.total)).toEqual([0, 0, 5]);
  });

  it("sums several rows into the same bucket", () => {
    const folded = foldIntoBuckets(
      keys,
      [
        { at: at("2026-08-18T01:00:00Z"), value: 2 },
        { at: at("2026-08-18T23:59:59Z"), value: 3 },
      ],
      "day",
      (row) => row.at,
      seed,
      fold,
    );
    expect(folded[0].total).toBe(5);
  });

  it("drops rows outside the window instead of clamping them to an edge", () => {
    const folded = foldIntoBuckets(
      keys,
      [
        { at: at("2026-08-17T23:00:00Z"), value: 99 },
        { at: at("2026-08-21T00:00:00Z"), value: 77 },
      ],
      "day",
      (row) => row.at,
      seed,
      fold,
    );
    // Clamping would overstate the first and last columns, which is a worse lie
    // than omitting data the caller did not ask for.
    expect(folded.map((bucket) => bucket.total)).toEqual([0, 0, 0]);
  });
});

describe("bucketKey", () => {
  it("agrees with the keys bucketKeys generates", () => {
    const keys = bucketKeys(at("2026-08-18T00:00:00Z"), at("2026-08-18T05:00:00Z"), "hour");
    expect(keys).toContain(bucketKey(at("2026-08-18T03:29:00Z"), "hour"));
  });
});

describe("addConsumptionDelta", () => {
  const empty: ConsumptionAccumulator = {
    start: "2026-08-30T00:00:00.000Z",
    spent: 0,
    granted: 0,
    net: 0,
    entryCount: 0,
  };

  it("reports debits as positive spent while preserving signed net", () => {
    expect(addConsumptionDelta(addConsumptionDelta(empty, -12), 5)).toEqual({
      start: empty.start,
      spent: 12,
      granted: 5,
      net: -7,
      entryCount: 2,
    });
  });

  // A zero-cost turn is still a turn: it counts as an entry even though it moves
  // neither side of the balance.
  it("counts a zero delta as an entry", () => {
    expect(addConsumptionDelta(empty, 0)).toEqual({ ...empty, entryCount: 1 });
  });
});

describe("isGranularity", () => {
  it("accepts the supported values and rejects anything else", () => {
    expect(isGranularity("minute")).toBe(true);
    expect(isGranularity("month")).toBe(true);
    expect(isGranularity("year")).toBe(false);
    expect(isGranularity("")).toBe(false);
  });
});
