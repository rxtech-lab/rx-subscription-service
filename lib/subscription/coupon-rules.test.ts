import { describe, expect, it } from "vitest";
import {
  couponBlockers,
  describeCoupon,
  normalizeCouponCode,
  quoteDiscount,
  type CouponTerms,
  type RedemptionContext,
} from "./coupon-rules";

const percent: CouponTerms = {
  discountType: "percent",
  percentBasisPoints: 2_550,
  amountOffCents: null,
  maxDiscountCents: null,
  currency: "usd",
  duration: "once",
  durationInMonths: null,
};

const context: RedemptionContext = {
  status: "active",
  startsAt: null,
  redeemBy: null,
  maxRedemptions: null,
  maxRedemptionsPerUser: null,
  minimumAmountCents: null,
  firstTimeOnly: false,
  redemptionsUsed: 0,
  redemptionsUsedByUser: 0,
  userAllowed: true,
  appliesToTarget: true,
  hasPriorPurchase: false,
  priceAmountCents: 1_999,
  targetCurrency: "usd",
  now: new Date("2026-08-19T00:00:00Z"),
};

describe("coupon code normalization", () => {
  it("trims and upper-cases an app-local code", () => {
    expect(normalizeCouponCode(" launch_25 ")).toBe("LAUNCH_25");
  });

  it("rejects ambiguous or undersized codes", () => {
    expect(() => normalizeCouponCode("a b")).toThrow(/3-64 characters/);
    expect(() => normalizeCouponCode("ab")).toThrow(/3-64 characters/);
  });
});

describe("coupon discount quoting", () => {
  it("rounds percentages to cents and honours a maximum", () => {
    expect(quoteDiscount(percent, 1_999)).toEqual({
      discountCents: 510,
      capped: false,
      requiresFixedAmount: false,
    });
    expect(
      quoteDiscount({ ...percent, maxDiscountCents: 400 }, 1_999),
    ).toEqual({
      discountCents: 400,
      capped: true,
      requiresFixedAmount: true,
    });
  });

  it("floors fixed discounts at zero and applies their cap", () => {
    const amount: CouponTerms = {
      ...percent,
      discountType: "amount",
      percentBasisPoints: null,
      amountOffCents: 1_000,
      maxDiscountCents: 600,
    };
    expect(quoteDiscount(amount, 500)).toEqual({
      discountCents: 500,
      capped: true,
      requiresFixedAmount: false,
    });
  });

  it("describes repeating terms and their ceiling", () => {
    expect(
      describeCoupon({
        ...percent,
        duration: "repeating",
        durationInMonths: 3,
        maxDiscountCents: 1_000,
      }),
    ).toBe("25.5% off on the first 3 months, up to 10.00 USD");
  });
});

describe("coupon blockers", () => {
  it("returns no blockers when every restriction is satisfied", () => {
    expect(couponBlockers(percent, context)).toEqual([]);
  });

  it("reports lifecycle, usage, audience, target, and order restrictions", () => {
    expect(
      couponBlockers(
        { ...percent, discountType: "amount", percentBasisPoints: null, amountOffCents: 500 },
        {
          ...context,
          status: "draft",
          startsAt: new Date("2026-08-20T00:00:00Z"),
          redeemBy: new Date("2026-08-18T00:00:00Z"),
          maxRedemptions: 2,
          maxRedemptionsPerUser: 1,
          redemptionsUsed: 2,
          redemptionsUsedByUser: 1,
          userAllowed: false,
          appliesToTarget: false,
          minimumAmountCents: 2_000,
          firstTimeOnly: true,
          hasPriorPurchase: true,
          targetCurrency: "eur",
        },
      ),
    ).toEqual([
      "not_active",
      "not_started",
      "expired",
      "fully_redeemed",
      "user_limit_reached",
      "user_not_allowed",
      "not_applicable",
      "below_minimum",
      "not_first_purchase",
      "currency_mismatch",
    ]);
  });
});
