import { expect, it } from "vitest";
import { dueGrantInstants, grantIntervalDays } from "./grant-schedule";

const periodStart = new Date("2026-01-01T09:00:00Z");
const periodEnd = new Date("2026-02-01T09:00:00Z");
const instants = (days: number, now = periodEnd, configuredAt?: Date) => dueGrantInstants({ periodStart, periodEnd, now, days, configuredAt });

it("preserves period defaults and resolves all fixed schedules", () => {
  expect(grantIntervalDays()).toBeNull();
  expect(grantIntervalDays("period")).toBeNull();
  expect(grantIntervalDays("day")).toBe(1);
  expect(grantIntervalDays("week")).toBe(7);
  expect(grantIntervalDays("custom_days", 3)).toBe(3);
  expect(grantIntervalDays("custom_days", 0)).toBeNull();
  expect(grantIntervalDays("custom_days", 1.5)).toBeNull();
});
it("grants daily through the last day and never on period end", () => {
  expect(instants(1)).toHaveLength(31);
  expect(instants(1).at(-1)).toEqual(new Date("2026-01-31T09:00:00Z"));
  expect(instants(1, periodStart)).toEqual([periodStart]);
  expect(instants(1, new Date("2026-01-02T08:59:59Z"))).toEqual([periodStart]);
});
it("catches up weekly and custom intervals anchored at the subscription time", () => {
  expect(instants(7).map(x => x.getUTCDate())).toEqual([1, 8, 15, 22, 29]);
  expect(instants(10).map(x => x.getUTCDate())).toEqual([1, 11, 21, 31]);
});
it("does not backfill intervals before configuration or before a period starts", () => {
  expect(instants(7, periodEnd, new Date("2026-01-09T09:00:00Z")).map(x => x.getUTCDate())).toEqual([15, 22, 29]);
  expect(instants(1, new Date("2025-12-31T09:00:00Z"))).toEqual([]);
});
it("clips short periods and ignores invalid windows", () => {
  expect(dueGrantInstants({ periodStart, periodEnd: new Date("2026-01-03T00:00:00Z"), now: periodEnd, days: 7 })).toEqual([periodStart]);
  expect(dueGrantInstants({ periodStart, periodEnd: periodStart, now: periodEnd, days: 1 })).toEqual([]);
});
