import { z } from "zod";

/**
 * Schemas shared by the tool definitions the model sees and the server-side
 * executor that applies an approved call. Defining them once means the model
 * cannot be handed a looser contract than the code that runs.
 */

export const billingIntervalSchema = z.enum(["month", "quarter", "year", "one_time"]);
export const resetPolicySchema = z.enum([
  "never",
  "rolling_window",
  "calendar_period",
  "billing_period",
]);
export const resetUnitSchema = z.enum(["hour", "day", "week", "month"]);
export const statusSchema = z.enum(["draft", "active", "archived"]);
export const couponDurationSchema = z.enum(["once", "repeating", "forever"]);

export const balanceExpiryPolicySchema = z
  .enum(["never", "period_end", "duration", "after_plan_end"])
  .optional()
  .describe(
    "balance_grant only. When granted units stop being spendable: " +
      "never (default, they accumulate); period_end (they lapse with the " +
      "billing period that granted them, so nothing rolls over); duration " +
      "(balanceExpiryMonths after the grant); after_plan_end " +
      "(balanceExpiryMonths after the subscription ends)",
  );

export const balanceExpiryMonthsSchema = z
  .number()
  .int()
  .positive()
  .nullable()
  .optional()
  .describe(
    "Months. Required when balanceExpiryPolicy is duration or after_plan_end, ignored otherwise",
  );

const couponRestrictionSchemas = {
  maxDiscountCents: z.number().int().positive().nullable().optional(),
  duration: couponDurationSchema.default("once"),
  durationInMonths: z.number().int().positive().nullable().optional(),
  appliesTo: z.enum(["all", "selected"]).default("all"),
  planIds: z.array(z.string()).default([]),
  topupProductIds: z.array(z.string()).default([]),
  restrictToUsers: z.boolean().default(false),
  appUserIds: z.array(z.string()).default([]),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  maxRedemptionsPerUser: z.number().int().positive().nullable().optional(),
  minimumAmountCents: z.number().int().nonnegative().nullable().optional(),
  firstTimeOnly: z.boolean().default(false),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  redeemBy: z.string().datetime({ offset: true }).nullable().optional(),
};

const suiteLineSchema = z.number().int().positive().describe("1-based line number");
const suiteSourceEditSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("replace"),
    oldCode: z.string().min(1).describe("Exact current source fragment"),
    newCode: z.string().describe("Replacement source; empty deletes the fragment"),
    all: z.boolean().optional().default(false),
  }),
  z.object({
    type: z.literal("replace_lines"),
    startLine: suiteLineSchema,
    endLine: suiteLineSchema,
    code: z.string().describe("Replacement source for the inclusive line range"),
  }),
  z.object({
    type: z.literal("insert_after"),
    line: suiteLineSchema,
    code: z.string().min(1),
  }),
  z.object({
    type: z.literal("insert_before"),
    line: suiteLineSchema,
    code: z.string().min(1),
  }),
  z.object({
    type: z.literal("delete_lines"),
    startLine: suiteLineSchema,
    endLine: suiteLineSchema,
  }),
  z.object({
    type: z.literal("append"),
    code: z.string().min(1).describe("Source to append at the end of the file"),
  }),
]);

export const writeToolSchemas = {
  createPlan: z.object({
    key: z.string().describe("URL-safe identifier, lowercase"),
    name: z.string(),
    description: z.string().optional(),
    billingInterval: billingIntervalSchema,
    intervalCount: z.number().int().positive().default(1),
    priceAmountCents: z.number().int().nonnegative().describe("Price in cents"),
    currency: z.string().length(3).default("usd"),
    trialDays: z.number().int().nonnegative().default(0),
  }),

  updatePlan: z.object({
    planId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    priceAmountCents: z.number().int().nonnegative().optional(),
    trialDays: z.number().int().nonnegative().optional(),
  }),

  setPlanStatus: z.object({ planId: z.string(), status: statusSchema }),

  createCoupon: z
    .object({
      code: z
        .string()
        .min(3)
        .max(64)
        .describe("Customer-facing app-local code, such as LAUNCH25"),
      name: z.string().min(1).max(120),
      description: z.string().optional(),
      discountType: z.enum(["percent", "amount"]),
      percentBasisPoints: z
        .number()
        .int()
        .min(1)
        .max(10_000)
        .nullable()
        .optional()
        .describe("Hundredths of one percent: 25.5% is 2550"),
      amountOffCents: z.number().int().positive().nullable().optional(),
      currency: z.string().length(3).default("usd"),
      ...couponRestrictionSchemas,
    })
    .superRefine((coupon, context) => {
      if (coupon.discountType === "percent" && coupon.percentBasisPoints == null) {
        context.addIssue({
          code: "custom",
          path: ["percentBasisPoints"],
          message: "percentBasisPoints is required for a percentage coupon",
        });
      }
      if (coupon.discountType === "amount" && coupon.amountOffCents == null) {
        context.addIssue({
          code: "custom",
          path: ["amountOffCents"],
          message: "amountOffCents is required for a fixed-amount coupon",
        });
      }
      if (coupon.duration === "repeating" && coupon.durationInMonths == null) {
        context.addIssue({
          code: "custom",
          path: ["durationInMonths"],
          message: "durationInMonths is required for a repeating coupon",
        });
      }
      if (
        coupon.appliesTo === "selected" &&
        coupon.planIds.length + coupon.topupProductIds.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["appliesTo"],
          message: "a selected coupon needs at least one plan or topup",
        });
      }
      if (coupon.restrictToUsers && coupon.appUserIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["appUserIds"],
          message: "a user-restricted coupon needs at least one user",
        });
      }
    }),

  updateCoupon: z.object({
    couponId: z.string(),
    name: z.string().min(1).max(120).optional(),
    description: z.string().nullable().optional(),
    percentBasisPoints: z.number().int().min(1).max(10_000).nullable().optional(),
    amountOffCents: z.number().int().positive().nullable().optional(),
    maxDiscountCents: couponRestrictionSchemas.maxDiscountCents,
    duration: couponDurationSchema.optional(),
    durationInMonths: couponRestrictionSchemas.durationInMonths,
    appliesTo: z.enum(["all", "selected"]).optional(),
    planIds: z.array(z.string()).optional(),
    topupProductIds: z.array(z.string()).optional(),
    restrictToUsers: z.boolean().optional(),
    appUserIds: z.array(z.string()).optional(),
    maxRedemptions: couponRestrictionSchemas.maxRedemptions,
    maxRedemptionsPerUser: couponRestrictionSchemas.maxRedemptionsPerUser,
    minimumAmountCents: couponRestrictionSchemas.minimumAmountCents,
    firstTimeOnly: z.boolean().optional(),
    startsAt: couponRestrictionSchemas.startsAt,
    redeemBy: couponRestrictionSchemas.redeemBy,
  }),

  setCouponStatus: z.object({ couponId: z.string(), status: statusSchema }),

  deleteCoupon: z.object({ couponId: z.string() }),

  addPlanEntitlement: z.object({
    planId: z.string(),
    kind: z.enum(["role", "permission", "usage_limit", "balance_grant", "feature"]),
    roleId: z.string().optional().describe("Required when kind is role"),
    permissionKey: z.string().optional(),
    permissionScope: z.enum(["all", "selected"]).optional(),
    permissionTargetIds: z.array(z.string()).optional(),
    usageItemId: z.string().optional(),
    limitValue: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe("Non-trial allowance. Null means unlimited"),
    trialLimitValue: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe(
        "Allowance while trialing. Omit to use limitValue; null means unlimited",
      ),
    unitId: z.string().optional(),
    amount: z.number().int().positive().optional(),
    balanceExpiryPolicy: balanceExpiryPolicySchema,
    balanceExpiryMonths: balanceExpiryMonthsSchema,
    featureKey: z.string().optional(),
    featureValue: z.string().optional(),
  }),

  removePlanEntitlement: z.object({
    planId: z.string().describe("Plan id returned by listPlans"),
    entitlementId: z
      .string()
      .describe("Exact entitlement id returned by getPlanEntitlements"),
  }),

  createRole: z.object({
    key: z.string(),
    title: z.string(),
    description: z.string().optional(),
    isDefault: z.boolean().default(false),
  }),

  createPermission: z.object({
    key: z.string().describe('Permission key such as "read:a" — no :all suffix'),
    title: z.string(),
    description: z.string().optional(),
    supportsAll: z.boolean().default(true),
    supportsIds: z.boolean().default(true),
  }),

  setRolePermissions: z.object({
    roleId: z.string(),
    grants: z.array(
      z.object({
        permissionId: z.string(),
        scope: z.enum(["all", "selected"]),
        targetIds: z.array(z.string()).default([]),
      }),
    ),
  }),

  createBalanceUnit: z.object({
    key: z.string(),
    name: z.string(),
    symbol: z.string().optional(),
    precision: z.number().int().min(0).max(9).default(0),
    kind: z.enum(["points", "currency", "custom"]).default("points"),
  }),

  setPointRate: z.object({
    unitId: z.string(),
    currency: z.string().length(3).default("usd"),
    units: z.number().int().positive().describe("How many units"),
    amountMinor: z.number().int().positive().describe("...cost this many cents"),
  }),

  createUsageItem: z.object({
    key: z.string(),
    name: z.string(),
    description: z.string().optional(),
    resetPolicy: resetPolicySchema.default("never"),
    resetIntervalCount: z.number().int().positive().nullable().optional(),
    resetIntervalUnit: resetUnitSchema.nullable().optional(),
    defaultLimit: z.number().int().nonnegative().nullable().optional(),
    overagePolicy: z.enum(["block", "allow", "charge_balance"]).default("block"),
    overageUnitId: z.string().nullable().optional(),
    overageCostPerUnit: z.number().int().positive().nullable().optional(),
  }),

  updateUsageItem: z.object({
    usageItemId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    resetPolicy: resetPolicySchema.optional(),
    resetIntervalCount: z.number().int().positive().nullable().optional(),
    resetIntervalUnit: resetUnitSchema.nullable().optional(),
    defaultLimit: z.number().int().nonnegative().nullable().optional(),
    overagePolicy: z.enum(["block", "allow", "charge_balance"]).optional(),
  }),

  createTopup: z.object({
    key: z.string(),
    name: z.string(),
    description: z.string().optional(),
    unitId: z.string(),
    amount: z.number().int().positive().describe("Units granted"),
    priceAmountCents: z.number().int().positive(),
    currency: z.string().length(3).default("usd"),
    maxPurchasesPerUser: z.number().int().positive().nullable().optional(),
    eligibility: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("standalone") }),
        z.object({ type: z.literal("plan"), planId: z.string() }),
        z.object({ type: z.literal("role"), roleId: z.string() }),
      ])
      .default({ type: "standalone" })
      .describe(
        "Who may buy this topup: anyone, subscribers to one plan, or users assigned a subscription role",
      ),
  }),

  updateTopup: z.object({
    topupId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    amount: z.number().int().positive().optional(),
    priceAmountCents: z.number().int().positive().optional(),
    status: statusSchema.optional(),
  }),

  addTopupEligibilityRule: z.object({
    topupId: z.string(),
    ruleType: z.enum([
      "requires_active_plan",
      "requires_any_plan",
      "requires_role",
    ]),
    planId: z.string().optional(),
    roleId: z.string().optional(),
  }),

  createTestUser: z.object({
    displayName: z.string().describe("Shown in the console and the test app"),
    email: z.string().optional(),
    level: z.number().int().default(0),
    levelKey: z.string().optional(),
    note: z
      .string()
      .optional()
      .describe("What this test user is set up to exercise"),
    planId: z
      .string()
      .optional()
      .describe("Subscribe to this plan immediately, without a payment"),
    unitId: z.string().optional().describe("Balance unit to seed, with amount"),
    amount: z.number().int().positive().optional().describe("Units to seed"),
  }),

  updateTestUser: z.object({
    appUserId: z.string(),
    displayName: z.string().optional(),
    email: z.string().nullable().optional(),
    level: z.number().int().optional(),
    levelKey: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  }),

  deleteTestUser: z.object({ appUserId: z.string() }),

  grantTestSubscription: z.object({
    appUserId: z.string(),
    planId: z.string(),
    status: z
      .enum(["active", "trialing"])
      .default("active")
      .describe("Use trialing to exercise the plan's configured trial period"),
    periodDays: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "How long the period runs. Defaults to the plan's trialDays for trialing, otherwise 30 days.",
      ),
  }),

  cancelTestSubscription: z.object({
    appUserId: z.string(),
    subscriptionId: z.string(),
    immediately: z
      .boolean()
      .default(true)
      .describe("False cancels at period end instead"),
  }),

  adjustTestUserBalance: z.object({
    appUserId: z.string(),
    unitId: z.string(),
    delta: z.number().int().describe("Units to add; negative to remove"),
    reason: z.string().default("Test adjustment"),
  }),

  saveTestSuite: z.object({
    suiteId: z
      .string()
      .optional()
      .describe("Omit to create a new suite; pass an id to replace an existing one"),
    name: z.string().describe("Shown in the Test cases tab, e.g. Topup eligibility"),
    description: z.string().optional().describe("One line on what the suite covers"),
    code: z
      .string()
      .describe(
        "The whole file. TypeScript using the ambient suite/test/step/expect/rx globals — no imports.",
      ),
  }),

  editTestSuite: z.object({
    suiteId: z
      .string()
      .describe("Suite id or exact name returned by listTestSuites/getTestSuite"),
    edits: z
      .array(suiteSourceEditSchema)
      .min(1)
      .max(20)
      .describe(
        "Ordered source edits. Line numbers are 1-based and each edit sees the result of earlier edits.",
      ),
  }),

  runTestSuite: z.object({
    suiteId: z.string().describe("The suite to run. Its name also resolves."),
  }),
} as const;

export type WriteToolName = keyof typeof writeToolSchemas;
