import { describe, expect, it } from "vitest";
import { cancellationSubscriptions, type AnalyticsSubscription } from "./analytics-cancellations";

const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T00:00:00Z`);
const subscription = (patch: Partial<AnalyticsSubscription> = {}): AnalyticsSubscription => ({
  id: "pro", appUserId: "user", planGroup: "default", autoSubscribe: false,
  planPriceAmountCents: 2000, status: "canceled", startedAt: at(1), endedAt: at(10), ...patch,
});
const successor = (patch: Partial<AnalyticsSubscription> = {}) => subscription({
  id: "next", status: "active", startedAt: at(10), endedAt: null, ...patch,
});

describe("cancellation classification", () => {
  it.each([1000, 3000, 0])("excludes a continuing plan change to price %s", (price) => {
    expect(cancellationSubscriptions([subscription(), successor({ planPriceAmountCents: price })])).toEqual([]);
  });
  it.each(["canceled", "expired"])("excludes historical %s automatic free rows replaced by a paid plan", (status) => {
    expect(cancellationSubscriptions([
      subscription({ autoSubscribe: true, planPriceAmountCents: 0, status }), successor(),
    ])).toEqual([]);
  });
  it("counts a paid cancellation returning to the automatic free tier", () => {
    const pro = subscription();
    expect(cancellationSubscriptions([pro, successor({ autoSubscribe: true, planPriceAmountCents: 0 })])).toEqual([pro]);
  });
  it("counts cancellation of all access", () => {
    const pro = subscription();
    expect(cancellationSubscriptions([pro])).toEqual([pro]);
  });
  it("uses historical coverage when the replacement was later canceled", () => {
    const later = successor({ status: "canceled", endedAt: at(12) });
    expect(cancellationSubscriptions([subscription(), later])).toEqual([later]);
  });
  it.each([
    { appUserId: "other" }, { planGroup: "other" }, { startedAt: at(11) },
    { startedAt: at(2), endedAt: at(9), status: "expired" }, { status: "incomplete" },
  ])("does not hide churn for an unrelated or non-continuing subscription: %j", (patch) => {
    const pro = subscription();
    expect(cancellationSubscriptions([pro, successor(patch)])).toContain(pro);
  });
  it("does not count scheduled cancellation or abandoned checkout", () => {
    expect(cancellationSubscriptions([
      subscription({ status: "active", endedAt: null }),
      subscription({ id: "checkout", status: "incomplete" }),
    ])).toEqual([]);
  });
});
