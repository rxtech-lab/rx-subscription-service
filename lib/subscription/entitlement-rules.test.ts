import { describe, expect, it } from "vitest";
import { usageLimitForSubscriptionStatus } from "./entitlement-rules";

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
