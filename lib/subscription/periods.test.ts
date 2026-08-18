import { describe, expect, it } from "vitest";
import { isPeriodExpired, resolvePeriod } from "./periods";

const at = (iso: string) => new Date(iso);

describe("resolvePeriod — never", () => {
  it("returns an open-ended period", () => {
    const period = resolvePeriod(at("2026-08-18T12:00:00Z"), {
      resetPolicy: "never",
    });
    expect(period.start).toEqual(new Date(0));
    expect(period.end).toBeNull();
  });
});

describe("resolvePeriod — calendar_period", () => {
  it("snaps hourly periods to the hour", () => {
    const period = resolvePeriod(at("2026-08-18T12:34:56Z"), {
      resetPolicy: "calendar_period",
      resetIntervalCount: 1,
      resetIntervalUnit: "hour",
    });
    expect(period.start.toISOString()).toBe("2026-08-18T12:00:00.000Z");
    expect(period.end?.toISOString()).toBe("2026-08-18T13:00:00.000Z");
  });

  it("groups multi-hour periods consistently", () => {
    const input = {
      resetPolicy: "calendar_period" as const,
      resetIntervalCount: 6,
      resetIntervalUnit: "hour" as const,
    };
    const early = resolvePeriod(at("2026-08-18T13:00:00Z"), input);
    const late = resolvePeriod(at("2026-08-18T17:59:59Z"), input);
    expect(early.start.toISOString()).toBe("2026-08-18T12:00:00.000Z");
    expect(late.start.toISOString()).toBe(early.start.toISOString());
    expect(early.end?.toISOString()).toBe("2026-08-18T18:00:00.000Z");
  });

  it("snaps daily periods to UTC midnight", () => {
    const period = resolvePeriod(at("2026-08-18T23:59:59Z"), {
      resetPolicy: "calendar_period",
      resetIntervalCount: 1,
      resetIntervalUnit: "day",
    });
    expect(period.start.toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(period.end?.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("starts weekly periods on Monday", () => {
    // 2026-08-18 is a Tuesday.
    const period = resolvePeriod(at("2026-08-18T09:00:00Z"), {
      resetPolicy: "calendar_period",
      resetIntervalCount: 1,
      resetIntervalUnit: "week",
    });
    expect(period.start.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(period.start.getUTCDay()).toBe(1);
    expect(period.end?.toISOString()).toBe("2026-08-24T00:00:00.000Z");
  });

  it("snaps monthly periods to the first of the month", () => {
    const period = resolvePeriod(at("2026-08-18T12:00:00Z"), {
      resetPolicy: "calendar_period",
      resetIntervalCount: 1,
      resetIntervalUnit: "month",
    });
    expect(period.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(period.end?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("aligns quarterly periods to the calendar quarter", () => {
    const period = resolvePeriod(at("2026-08-18T12:00:00Z"), {
      resetPolicy: "calendar_period",
      resetIntervalCount: 3,
      resetIntervalUnit: "month",
    });
    expect(period.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(period.end?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rolls a monthly period across a year boundary", () => {
    const period = resolvePeriod(at("2026-12-31T23:00:00Z"), {
      resetPolicy: "calendar_period",
      resetIntervalCount: 1,
      resetIntervalUnit: "month",
    });
    expect(period.end?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("resolvePeriod — rolling_window", () => {
  it("opens a window at first use", () => {
    const now = at("2026-08-18T12:34:56Z");
    const period = resolvePeriod(now, {
      resetPolicy: "rolling_window",
      resetIntervalCount: 24,
      resetIntervalUnit: "hour",
    });
    expect(period.start.toISOString()).toBe(now.toISOString());
    expect(period.end?.toISOString()).toBe("2026-08-19T12:34:56.000Z");
  });

  it("keeps the existing window while it is open", () => {
    const period = resolvePeriod(at("2026-08-18T20:00:00Z"), {
      resetPolicy: "rolling_window",
      resetIntervalCount: 1,
      resetIntervalUnit: "day",
      currentStart: at("2026-08-18T09:00:00Z"),
      currentEnd: at("2026-08-19T09:00:00Z"),
    });
    expect(period.start.toISOString()).toBe("2026-08-18T09:00:00.000Z");
  });

  it("starts a fresh window at now once the old one lapses", () => {
    const now = at("2026-08-20T15:00:00Z");
    const period = resolvePeriod(now, {
      resetPolicy: "rolling_window",
      resetIntervalCount: 1,
      resetIntervalUnit: "day",
      currentStart: at("2026-08-18T09:00:00Z"),
      currentEnd: at("2026-08-19T09:00:00Z"),
    });
    expect(period.start.toISOString()).toBe(now.toISOString());
    expect(period.end?.toISOString()).toBe("2026-08-21T15:00:00.000Z");
  });

  it("handles month-length rolling windows", () => {
    const period = resolvePeriod(at("2026-01-31T00:00:00Z"), {
      resetPolicy: "rolling_window",
      resetIntervalCount: 1,
      resetIntervalUnit: "month",
    });
    // JS normalizes Feb 31 to Mar 3 — the window stays strictly in the future.
    expect(period.end!.getTime()).toBeGreaterThan(period.start.getTime());
  });
});

describe("resolvePeriod — billing_period", () => {
  it("follows the subscription window", () => {
    const period = resolvePeriod(at("2026-08-18T12:00:00Z"), {
      resetPolicy: "billing_period",
      billingPeriodStart: at("2026-08-05T00:00:00Z"),
      billingPeriodEnd: at("2026-09-05T00:00:00Z"),
    });
    expect(period.start.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(period.end?.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  it("falls back to calendar months without a subscription", () => {
    const period = resolvePeriod(at("2026-08-18T12:00:00Z"), {
      resetPolicy: "billing_period",
    });
    expect(period.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("falls back when the subscription window is stale", () => {
    const period = resolvePeriod(at("2026-08-18T12:00:00Z"), {
      resetPolicy: "billing_period",
      billingPeriodStart: at("2026-06-05T00:00:00Z"),
      billingPeriodEnd: at("2026-07-05T00:00:00Z"),
    });
    expect(period.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("isPeriodExpired", () => {
  it("treats an open-ended period as never expiring", () => {
    expect(isPeriodExpired(at("2099-01-01T00:00:00Z"), null)).toBe(false);
  });

  it("expires exactly at the boundary", () => {
    const end = at("2026-08-19T00:00:00Z");
    expect(isPeriodExpired(at("2026-08-18T23:59:59Z"), end)).toBe(false);
    expect(isPeriodExpired(end, end)).toBe(true);
  });
});
