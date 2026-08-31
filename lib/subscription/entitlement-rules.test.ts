import { describe, expect, it } from "vitest";
import {
  balanceAmountForSubscriptionStatus,
  usageLimitForSubscriptionStatus,
} from "./entitlement-rules";

describe("usageLimitForSubscriptionStatus", () => {
  const grant = { limitValue: 1_000, trialLimitValue: 100 };

  it("uses the trial allowance only while the subscription is trialing", () => {
    expect(usageLimitForSubscriptionStatus(grant, "trialing")).toBe(100);
    expect(usageLimitForSubscriptionStatus(grant, "active")).toBe(1_000);
    expect(usageLimitForSubscriptionStatus(grant, "past_due")).toBe(1_000);
  });

  it("preserves an explicit unlimited trial allowance", () => {
    expect(
      usageLimitForSubscriptionStatus(
        { limitValue: 1_000, trialLimitValue: null },
        "trialing",
      ),
    ).toBeNull();
  });

  it("falls back for entitlement snapshots captured before trial limits existed", () => {
    expect(
      usageLimitForSubscriptionStatus({ limitValue: 1_000 }, "trialing"),
    ).toBe(1_000);
  });
});

describe("balanceAmountForSubscriptionStatus", () => {
  const grant = { amount: 10_000, trialAmount: 1_000 };

  it("uses the trial grant only while the subscription is trialing", () => {
    expect(balanceAmountForSubscriptionStatus(grant, "trialing")).toBe(1_000);
    expect(balanceAmountForSubscriptionStatus(grant, "active")).toBe(10_000);
    expect(balanceAmountForSubscriptionStatus(grant, "past_due")).toBe(10_000);
  });

  it("allows a trial to grant no stored balance", () => {
    expect(
      balanceAmountForSubscriptionStatus(
        { amount: 10_000, trialAmount: 0 },
        "trialing",
      ),
    ).toBe(0);
  });

  it("falls back for database rows and snapshots without a trial amount", () => {
    expect(
      balanceAmountForSubscriptionStatus(
        { amount: 10_000, trialAmount: null },
        "trialing",
      ),
    ).toBe(10_000);
    expect(
      balanceAmountForSubscriptionStatus({ amount: 10_000 }, "trialing"),
    ).toBe(10_000);
  });
});
