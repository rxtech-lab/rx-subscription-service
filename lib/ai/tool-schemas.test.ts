import { describe, expect, it } from "vitest";
import { writeToolSchemas } from "./tool-schemas";

const topup = {
  key: "points_1000",
  name: "1,000 points",
  unitId: "unit-points",
  amount: 1_000,
  priceAmountCents: 500,
};

describe("plan tool schemas", () => {
  it("defaults new plans to the default group", () => {
    expect(
      writeToolSchemas.createPlan.parse({
        key: "pro",
        name: "Pro",
        billingInterval: "month",
        priceAmountCents: 1_900,
      }).planGroup,
    ).toBe("default");
  });

  it("lets the agent move a plan to another group", () => {
    expect(
      writeToolSchemas.updatePlan.parse({
        planId: "plan-pro",
        planGroup: "addons",
      }).planGroup,
    ).toBe("addons");
  });
});

describe("createTopup tool schema", () => {
  it("defaults to a standalone topup", () => {
    expect(writeToolSchemas.createTopup.parse(topup).eligibility).toEqual({
      type: "standalone",
    });
  });

  it("accepts plan- and role-linked topups", () => {
    expect(
      writeToolSchemas.createTopup.parse({
        ...topup,
        eligibility: { type: "plan", planId: "plan-pro" },
      }).eligibility,
    ).toEqual({ type: "plan", planId: "plan-pro" });
    expect(
      writeToolSchemas.createTopup.parse({
        ...topup,
        eligibility: { type: "role", roleId: "role-pro" },
      }).eligibility,
    ).toEqual({ type: "role", roleId: "role-pro" });
  });

  it("requires the selected plan or role id", () => {
    expect(
      writeToolSchemas.createTopup.safeParse({
        ...topup,
        eligibility: { type: "plan" },
      }).success,
    ).toBe(false);
    expect(
      writeToolSchemas.createTopup.safeParse({
        ...topup,
        eligibility: { type: "role" },
      }).success,
    ).toBe(false);
  });
});

describe("plan entitlement tool schema", () => {
  it("accepts separate trial and non-trial usage limits", () => {
    expect(
      writeToolSchemas.addPlanEntitlement.parse({
        planId: "plan-pro",
        kind: "usage_limit",
        usageItemId: "item-api-calls",
        limitValue: 1_000,
        trialLimitValue: 100,
      }),
    ).toMatchObject({ limitValue: 1_000, trialLimitValue: 100 });
  });

  it("rejects a negative trial limit", () => {
    expect(
      writeToolSchemas.addPlanEntitlement.safeParse({
        planId: "plan-pro",
        kind: "usage_limit",
        usageItemId: "item-api-calls",
        limitValue: 1_000,
        trialLimitValue: -1,
      }).success,
    ).toBe(false);
  });

  it("accepts separate trial and non-trial balance grants", () => {
    expect(
      writeToolSchemas.addPlanEntitlement.parse({
        planId: "plan-pro",
        kind: "balance_grant",
        unitId: "unit-points",
        amount: 10_000,
        trialAmount: 1_000,
      }),
    ).toMatchObject({ amount: 10_000, trialAmount: 1_000 });
  });

  it("allows zero but rejects negative trial balance grants", () => {
    const grant = {
      planId: "plan-pro",
      kind: "balance_grant" as const,
      unitId: "unit-points",
      amount: 10_000,
    };
    expect(
      writeToolSchemas.addPlanEntitlement.safeParse({ ...grant, trialAmount: 0 })
        .success,
    ).toBe(true);
    expect(
      writeToolSchemas.addPlanEntitlement.safeParse({ ...grant, trialAmount: -1 })
        .success,
    ).toBe(false);
  });

  it("requires the exact plan and entitlement ids when removing a grant", () => {
    expect(
      writeToolSchemas.removePlanEntitlement.parse({
        planId: "plan-pro",
        entitlementId: "entitlement-old-limit",
      }),
    ).toEqual({
      planId: "plan-pro",
      entitlementId: "entitlement-old-limit",
    });
    expect(
      writeToolSchemas.removePlanEntitlement.safeParse({
        planId: "plan-pro",
      }).success,
    ).toBe(false);
  });
});

describe("test subscription tool schema", () => {
  it("defaults to active and accepts a trialing subscription", () => {
    expect(
      writeToolSchemas.grantTestSubscription.parse({
        appUserId: "user-test",
        planId: "plan-pro",
      }).status,
    ).toBe("active");
    expect(
      writeToolSchemas.grantTestSubscription.parse({
        appUserId: "user-test",
        planId: "plan-pro",
        status: "trialing",
      }).status,
    ).toBe("trialing");
  });
});

describe("test suite editing tool schema", () => {
  it("accepts ordered exact, line-based, and append edits", () => {
    const parsed = writeToolSchemas.editTestSuite.parse({
      suiteId: "Usage limits",
      edits: [
        {
          type: "replace",
          oldCode: "expect(item.limit).toBe(300);",
          newCode: "expect(item.limit).toBe(1_000);",
        },
        { type: "insert_after", line: 12, code: "expect(item.used).toBe(0);" },
        { type: "append", code: "// Added incrementally" },
      ],
    });

    expect(parsed.edits).toHaveLength(3);
    expect(parsed.edits[0]).toMatchObject({ type: "replace", all: false });
  });

  it("rejects an empty edit list and invalid line numbers", () => {
    expect(
      writeToolSchemas.editTestSuite.safeParse({
        suiteId: "suite-a",
        edits: [],
      }).success,
    ).toBe(false);
    expect(
      writeToolSchemas.editTestSuite.safeParse({
        suiteId: "suite-a",
        edits: [{ type: "insert_before", line: 0, code: "test();" }],
      }).success,
    ).toBe(false);
  });
});

describe("coupon tool schemas", () => {
  it("keeps every coupon restriction available to the agent", () => {
    const parsed = writeToolSchemas.createCoupon.parse({
      code: "LAUNCH25",
      name: "Launch",
      discountType: "percent",
      percentBasisPoints: 2_500,
      maxDiscountCents: 1_000,
      duration: "repeating",
      durationInMonths: 3,
      appliesTo: "selected",
      planIds: ["plan-pro"],
      restrictToUsers: true,
      appUserIds: ["user-a"],
      maxRedemptions: 100,
      maxRedemptionsPerUser: 1,
      minimumAmountCents: 500,
      firstTimeOnly: true,
      startsAt: "2026-08-20T00:00:00Z",
      redeemBy: "2026-09-20T00:00:00Z",
    });

    expect(parsed).toMatchObject({
      currency: "usd",
      duration: "repeating",
      appliesTo: "selected",
      restrictToUsers: true,
      appUserIds: ["user-a"],
    });
    expect(parsed.topupProductIds).toEqual([]);
  });

  it("rejects invalid percentages and timezone-free dates", () => {
    expect(
      writeToolSchemas.createCoupon.safeParse({
        code: "TOO-MUCH",
        name: "Too much",
        discountType: "percent",
        percentBasisPoints: 10_001,
      }).success,
    ).toBe(false);
    expect(
      writeToolSchemas.updateCoupon.safeParse({
        couponId: "coupon-a",
        redeemBy: "2026-09-20T00:00:00",
      }).success,
    ).toBe(false);
  });

  it("rejects incomplete discount and restriction shapes", () => {
    expect(
      writeToolSchemas.createCoupon.safeParse({
        code: "FIXED",
        name: "Fixed",
        discountType: "amount",
      }).success,
    ).toBe(false);
    expect(
      writeToolSchemas.createCoupon.safeParse({
        code: "SELECTED",
        name: "Selected",
        discountType: "percent",
        percentBasisPoints: 1_000,
        appliesTo: "selected",
        restrictToUsers: true,
      }).success,
    ).toBe(false);
  });
});
