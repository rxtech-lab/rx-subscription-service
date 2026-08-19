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
      .describe("Null means unlimited"),
    unitId: z.string().optional(),
    amount: z.number().int().positive().optional(),
    featureKey: z.string().optional(),
    featureValue: z.string().optional(),
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
    periodDays: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("How long the period runs. Defaults to 30 days."),
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

  runTestSuite: z.object({
    suiteId: z.string().describe("The suite to run. Its name also resolves."),
  }),
} as const;

export type WriteToolName = keyof typeof writeToolSchemas;
