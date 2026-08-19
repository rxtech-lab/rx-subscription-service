import { describe, expect, it } from "vitest";
import {
  couponDisplayName,
  deriveStripeCouponId,
  percentFromBasisPoints,
  scopeFingerprint,
  toStripeTimestamp,
  type StripeCouponShape,
} from "./coupon-scope";

const shape: StripeCouponShape = {
  percentOff: 25.5,
  amountOffCents: null,
  currency: "usd",
  duration: "repeating",
  durationInMonths: 3,
  maxRedemptions: 100,
  redeemBySeconds: 1_800_000_000,
};

function id(overrides: Partial<Parameters<typeof deriveStripeCouponId>[0]> = {}) {
  return deriveStripeCouponId({
    applicationId: "app-a",
    couponId: "coupon-a",
    mode: "live",
    shape,
    productIds: ["prod-b", "prod-a"],
    ...overrides,
  });
}

describe("Stripe coupon scoping", () => {
  it("is stable across product order and duplicate ids", () => {
    expect(scopeFingerprint(["prod-b", "prod-a", "prod-a"])).toBe(
      "prod-a,prod-b",
    );
    expect(id()).toBe(id({ productIds: ["prod-a", "prod-b", "prod-a"] }));
  });

  it("changes for another app, account mode, terms, or product scope", () => {
    const base = id();
    expect(id({ applicationId: "app-b" })).not.toBe(base);
    expect(id({ mode: "sandbox" })).not.toBe(base);
    expect(id({ shape: { ...shape, percentOff: 20 } })).not.toBe(base);
    expect(id({ productIds: ["prod-a"] })).not.toBe(base);
    expect(base).toMatch(/^rxc_[a-f0-9]{32}$/);
  });

  it("converts Stripe-facing values without losing precision", () => {
    expect(percentFromBasisPoints(2_550)).toBe(25.5);
    expect(toStripeTimestamp(new Date("2026-08-19T12:34:56.999Z"))).toBe(
      1_787_142_896,
    );
    expect(toStripeTimestamp(null)).toBeNull();
  });

  it("keeps dashboard names within Stripe's forty-character limit", () => {
    expect(couponDisplayName("Launch week", "SAVE25")).toBe(
      "SAVE25 — Launch week",
    );
    expect(couponDisplayName("x".repeat(80), "SAVE25")).toHaveLength(40);
  });
});
