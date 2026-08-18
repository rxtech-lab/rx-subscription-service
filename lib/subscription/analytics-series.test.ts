import { describe, expect, it } from "vitest";
import {
  activeByDay,
  countByDay,
  dateKeys,
  monthlyRecurringCents,
  percentChange,
  sumByDay,
  topWithOther,
} from "./analytics-series";

const at = (iso: string) => new Date(iso);

describe("dateKeys", () => {
  it("ends on the day containing the given instant", () => {
    expect(dateKeys(at("2026-08-18T13:00:00Z"), 3)).toEqual([
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
    ]);
  });

  it("stays on UTC boundaries across a month edge", () => {
    expect(dateKeys(at("2026-09-01T00:30:00Z"), 2)).toEqual(["2026-08-31", "2026-09-01"]);
  });
});

describe("countByDay", () => {
  const keys = dateKeys(at("2026-08-18T00:00:00Z"), 3);

  it("buckets timestamps and ignores what falls outside the range", () => {
    expect(
      countByDay(keys, [
        at("2026-08-16T01:00:00Z"),
        at("2026-08-18T23:59:00Z"),
        at("2026-08-18T00:00:00Z"),
        at("2026-07-01T00:00:00Z"),
        null,
      ]),
    ).toEqual([1, 0, 2]);
  });
});

describe("sumByDay", () => {
  it("adds amounts into their day", () => {
    const keys = dateKeys(at("2026-08-18T00:00:00Z"), 2);
    expect(
      sumByDay(keys, [
        { at: at("2026-08-17T10:00:00Z"), amount: 500 },
        { at: at("2026-08-18T10:00:00Z"), amount: 250 },
        { at: at("2026-08-18T11:00:00Z"), amount: -100 },
        { at: null, amount: 999 },
      ]),
    ).toEqual([500, 150]);
  });
});

describe("activeByDay", () => {
  const keys = dateKeys(at("2026-08-18T00:00:00Z"), 4);

  // keys are 2026-08-15 … 2026-08-18.
  it("counts a subscription from the day it started", () => {
    expect(
      activeByDay(keys, [{ start: at("2026-08-16T12:00:00Z"), end: null }]),
    ).toEqual([0, 1, 1, 1]);
  });

  it("keeps counting it on the day it ended, then stops", () => {
    expect(
      activeByDay(keys, [
        { start: at("2026-08-01T00:00:00Z"), end: at("2026-08-17T09:00:00Z") },
      ]),
    ).toEqual([1, 1, 1, 0]);
  });

  it("adds up overlapping subscriptions", () => {
    expect(
      activeByDay(keys, [
        { start: at("2026-08-01T00:00:00Z"), end: null },
        { start: at("2026-08-18T00:00:00Z"), end: null },
      ]),
    ).toEqual([1, 1, 1, 2]);
  });
});

describe("monthlyRecurringCents", () => {
  it("normalizes every recurring interval to a month", () => {
    expect(
      monthlyRecurringCents({
        priceAmountCents: 1_200,
        billingInterval: "month",
        intervalCount: 1,
      }),
    ).toBe(1_200);
    expect(
      monthlyRecurringCents({
        priceAmountCents: 1_200,
        billingInterval: "quarter",
        intervalCount: 1,
      }),
    ).toBe(400);
    expect(
      monthlyRecurringCents({
        priceAmountCents: 12_000,
        billingInterval: "year",
        intervalCount: 1,
      }),
    ).toBe(1_000);
    expect(
      monthlyRecurringCents({
        priceAmountCents: 1_200,
        billingInterval: "month",
        intervalCount: 2,
      }),
    ).toBe(600);
  });

  it("leaves one-time plans out of recurring revenue", () => {
    expect(
      monthlyRecurringCents({
        priceAmountCents: 9_900,
        billingInterval: "one_time",
        intervalCount: 1,
      }),
    ).toBe(0);
  });
});

describe("percentChange", () => {
  it("reports the change against the previous window", () => {
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(5, 10)).toBe(-50);
  });

  it("is null when there is nothing to compare against", () => {
    expect(percentChange(15, 0)).toBeNull();
  });
});

describe("topWithOther", () => {
  const items = [
    { label: "a", value: 5 },
    { label: "b", value: 3 },
    { label: "c", value: 2 },
    { label: "d", value: 1 },
  ];

  it("keeps everything when it already fits", () => {
    expect(topWithOther(items, 4)).toEqual(items);
  });

  it("folds the tail into Other rather than adding categories", () => {
    expect(topWithOther(items, 2)).toEqual([
      { label: "a", value: 5 },
      { label: "b", value: 3 },
      { label: "Other", value: 3 },
    ]);
  });

  it("omits an empty Other row", () => {
    expect(
      topWithOther([...items.slice(0, 2), { label: "z", value: 0 }], 2),
    ).toEqual([
      { label: "a", value: 5 },
      { label: "b", value: 3 },
    ]);
  });
});
