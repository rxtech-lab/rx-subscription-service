import { describe, expect, it } from "vitest";
import {
  addMonthsUtc,
  orderLotsForDraw,
  planLotDraw,
  planLotExpiry,
  policyRequiresMonths,
  resolveExpiresAfterPlanEnd,
  resolveExpiresAt,
} from "./balance-expiry-rules";

const at = (iso: string) => new Date(iso);

describe("addMonthsUtc", () => {
  it("adds whole months", () => {
    expect(addMonthsUtc(at("2026-03-10T08:30:00Z"), 2).toISOString()).toBe(
      "2026-05-10T08:30:00.000Z",
    );
  });

  it("keeps the time of day", () => {
    expect(addMonthsUtc(at("2026-01-15T23:59:59.123Z"), 1).toISOString()).toBe(
      "2026-02-15T23:59:59.123Z",
    );
  });

  it("clamps a day that the target month does not have", () => {
    // Naive month arithmetic rolls this into 3 March; the user was told the
    // units last until the end of February.
    expect(addMonthsUtc(at("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("clamps to 29 February in a leap year", () => {
    expect(addMonthsUtc(at("2028-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("rolls across a year boundary", () => {
    expect(addMonthsUtc(at("2026-11-30T00:00:00Z"), 3).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });
});

describe("resolveExpiresAt — never", () => {
  it("does not expire", () => {
    expect(
      resolveExpiresAt({
        policy: "never",
        months: null,
        grantedAt: at("2026-03-01T00:00:00Z"),
        periodEnd: at("2026-04-01T00:00:00Z"),
      }),
    ).toBeNull();
  });
});

describe("resolveExpiresAt — period_end", () => {
  it("expires when the granting period ends", () => {
    expect(
      resolveExpiresAt({
        policy: "period_end",
        months: null,
        grantedAt: at("2026-03-01T00:00:00Z"),
        periodEnd: at("2026-04-01T00:00:00Z"),
      })?.toISOString(),
    ).toBe("2026-04-01T00:00:00.000Z");
  });

  it("does not expire when there is no billing period to follow", () => {
    // A one-time plan has no period; expiring immediately would delete units
    // the buyer just paid for.
    expect(
      resolveExpiresAt({
        policy: "period_end",
        months: null,
        grantedAt: at("2026-03-01T00:00:00Z"),
        periodEnd: null,
      }),
    ).toBeNull();
  });
});

describe("resolveExpiresAt — duration", () => {
  it("expires the configured number of months after the grant", () => {
    expect(
      resolveExpiresAt({
        policy: "duration",
        months: 2,
        grantedAt: at("2026-03-15T10:00:00Z"),
        periodEnd: at("2026-04-01T00:00:00Z"),
      })?.toISOString(),
    ).toBe("2026-05-15T10:00:00.000Z");
  });

  it("ignores the billing period", () => {
    const withPeriod = resolveExpiresAt({
      policy: "duration",
      months: 6,
      grantedAt: at("2026-03-15T10:00:00Z"),
      periodEnd: at("2026-04-01T00:00:00Z"),
    });
    const withoutPeriod = resolveExpiresAt({
      policy: "duration",
      months: 6,
      grantedAt: at("2026-03-15T10:00:00Z"),
      periodEnd: null,
    });
    expect(withPeriod?.toISOString()).toBe(withoutPeriod?.toISOString());
  });

  it("does not expire when no duration was configured", () => {
    expect(
      resolveExpiresAt({
        policy: "duration",
        months: null,
        grantedAt: at("2026-03-15T10:00:00Z"),
      }),
    ).toBeNull();
  });
});

describe("resolveExpiresAt — after_plan_end", () => {
  it("stays open-ended at grant time", () => {
    // The subscription has not ended, so there is nothing to count from yet.
    expect(
      resolveExpiresAt({
        policy: "after_plan_end",
        months: 3,
        grantedAt: at("2026-03-15T10:00:00Z"),
        periodEnd: at("2026-04-01T00:00:00Z"),
      }),
    ).toBeNull();
  });
});

describe("resolveExpiresAfterPlanEnd", () => {
  it("counts from when the plan ended", () => {
    expect(
      resolveExpiresAfterPlanEnd(at("2026-06-30T12:00:00Z"), 3)?.toISOString(),
    ).toBe("2026-09-30T12:00:00.000Z");
  });

  it("clamps a short target month", () => {
    expect(
      resolveExpiresAfterPlanEnd(at("2026-08-31T00:00:00Z"), 1)?.toISOString(),
    ).toBe("2026-09-30T00:00:00.000Z");
  });

  it("does not expire without a duration", () => {
    expect(resolveExpiresAfterPlanEnd(at("2026-06-30T12:00:00Z"), null)).toBeNull();
  });
});

describe("policyRequiresMonths", () => {
  it("is true only for the month-based policies", () => {
    expect(policyRequiresMonths("duration")).toBe(true);
    expect(policyRequiresMonths("after_plan_end")).toBe(true);
    expect(policyRequiresMonths("never")).toBe(false);
    expect(policyRequiresMonths("period_end")).toBe(false);
  });
});

const lot = (
  id: string,
  remaining: number,
  expiresAt: string | null,
  createdAt = "2026-01-01T00:00:00Z",
) => ({
  id,
  remaining,
  expiresAt: expiresAt ? at(expiresAt) : null,
  createdAt: at(createdAt),
});

describe("orderLotsForDraw", () => {
  it("puts the soonest expiry first", () => {
    const ordered = orderLotsForDraw([
      lot("late", 10, "2026-06-01T00:00:00Z"),
      lot("soon", 10, "2026-03-01T00:00:00Z"),
    ]);
    expect(ordered.map((l) => l.id)).toEqual(["soon", "late"]);
  });

  it("puts non-expiring lots last so they act as the reserve", () => {
    const ordered = orderLotsForDraw([
      lot("forever", 10, null),
      lot("expiring", 10, "2030-01-01T00:00:00Z"),
    ]);
    expect(ordered.map((l) => l.id)).toEqual(["expiring", "forever"]);
  });

  it("breaks ties on grant order", () => {
    const ordered = orderLotsForDraw([
      lot("second", 10, "2026-03-01T00:00:00Z", "2026-02-02T00:00:00Z"),
      lot("first", 10, "2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z"),
    ]);
    expect(ordered.map((l) => l.id)).toEqual(["first", "second"]);
  });

  it("orders non-expiring lots among themselves by grant order", () => {
    const ordered = orderLotsForDraw([
      lot("newer", 10, null, "2026-05-01T00:00:00Z"),
      lot("older", 10, null, "2026-01-01T00:00:00Z"),
    ]);
    expect(ordered.map((l) => l.id)).toEqual(["older", "newer"]);
  });

  it("does not mutate the input", () => {
    const lots = [lot("b", 10, "2026-06-01T00:00:00Z"), lot("a", 10, null)];
    orderLotsForDraw(lots);
    expect(lots.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("planLotDraw", () => {
  it("spends the soonest-expiring lot first", () => {
    const draws = planLotDraw(
      [lot("forever", 100, null), lot("soon", 30, "2026-03-01T00:00:00Z")],
      20,
    );
    expect(draws).toEqual([{ lotId: "soon", take: 20 }]);
  });

  it("spills into the next lot once the first is exhausted", () => {
    const draws = planLotDraw(
      [lot("forever", 100, null), lot("soon", 30, "2026-03-01T00:00:00Z")],
      50,
    );
    expect(draws).toEqual([
      { lotId: "soon", take: 30 },
      { lotId: "forever", take: 20 },
    ]);
  });

  it("takes everything it can when the lots do not cover the debit", () => {
    // The shortfall is the debt a reversal leaves on a negative balance.
    const draws = planLotDraw([lot("only", 10, null)], 25);
    expect(draws).toEqual([{ lotId: "only", take: 10 }]);
    expect(draws.reduce((sum, d) => sum + d.take, 0)).toBe(10);
  });

  it("skips exhausted lots", () => {
    const draws = planLotDraw(
      [lot("empty", 0, "2026-01-01T00:00:00Z"), lot("open", 10, null)],
      5,
    );
    expect(draws).toEqual([{ lotId: "open", take: 5 }]);
  });

  it("returns nothing for a zero draw", () => {
    expect(planLotDraw([lot("open", 10, null)], 0)).toEqual([]);
  });
});

describe("planLotExpiry", () => {
  it("expires a whole lapsed lot when there is headroom", () => {
    const draws = planLotExpiry([lot("lapsed", 40, "2026-01-01T00:00:00Z")], 100);
    expect(draws).toEqual([{ lotId: "lapsed", take: 40 }]);
  });

  it("stops at the reserved floor and leaves the rest for the next pass", () => {
    // 40 lapsed but only 15 spendable: an open hold owns the other 25.
    const draws = planLotExpiry([lot("lapsed", 40, "2026-01-01T00:00:00Z")], 15);
    expect(draws).toEqual([{ lotId: "lapsed", take: 15 }]);
  });

  it("expires nothing when every unit is reserved", () => {
    expect(planLotExpiry([lot("lapsed", 40, "2026-01-01T00:00:00Z")], 0)).toEqual([]);
  });

  it("treats negative headroom as none", () => {
    expect(planLotExpiry([lot("lapsed", 40, "2026-01-01T00:00:00Z")], -10)).toEqual(
      [],
    );
  });

  it("expires the soonest-lapsed lots first when headroom is short", () => {
    const draws = planLotExpiry(
      [
        lot("later", 10, "2026-02-01T00:00:00Z"),
        lot("earlier", 10, "2026-01-01T00:00:00Z"),
      ],
      12,
    );
    expect(draws).toEqual([
      { lotId: "earlier", take: 10 },
      { lotId: "later", take: 2 },
    ]);
  });
});
