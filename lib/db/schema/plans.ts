import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, timestamp, boolean, jsonb, bigint } from "drizzle-orm/pg-core";
import { applications } from "./applications";
import { balanceUnits } from "./units";
import { subscriptionRoles } from "./roles";
import { usageItems } from "./usage";

export const BILLING_INTERVALS = ["month", "quarter", "year", "one_time"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const DEFAULT_PLAN_GROUP = "default";

export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** A user may own at most one active or one-time plan in each group. */
    planGroup: text("plan_group").notNull().default(DEFAULT_PLAN_GROUP),
    billingInterval: text("billing_interval", { enum: BILLING_INTERVALS }).notNull(),
    intervalCount: bigint("interval_count", { mode: "number" }).notNull().default(1),
    priceAmountCents: bigint("price_amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    trialDays: bigint("trial_days", { mode: "number" }).notNull().default(0),
    /** Enroll users into this free recurring plan when they have no plan in its group. */
    autoSubscribe: boolean("auto_subscribe")
      .notNull()
      .default(false),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    sortOrder: bigint("sort_order", { mode: "number" }).notNull().default(0),
    stripeProductId: text("stripe_product_id"),
    stripePriceId: text("stripe_price_id"),
    /** Stripe ids are per-account, so the sandbox account needs its own pair. */
    stripeSandboxProductId: text("stripe_sandbox_product_id"),
    stripeSandboxPriceId: text("stripe_sandbox_price_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("plans_app_key_idx").on(table.applicationId, table.key),
    index("plans_app_status_idx").on(table.applicationId, table.status),
    index("plans_app_group_idx").on(table.applicationId, table.planGroup),
    uniqueIndex("plans_app_group_auto_subscribe_idx")
      .on(table.applicationId, table.planGroup)
      .where(sql`${table.autoSubscribe} = true`),
    check("plans_price_nonnegative", sql`${table.priceAmountCents} >= 0`),
    check("plans_interval_count_positive", sql`${table.intervalCount} >= 1`),
    check("plans_trial_nonnegative", sql`${table.trialDays} >= 0`),
  ],
);

export const ENTITLEMENT_KINDS = [
  "role",
  "permission",
  "usage_limit",
  "balance_grant",
  "feature",
] as const;
export type EntitlementKind = (typeof ENTITLEMENT_KINDS)[number];

/**
 * When units granted by a `balance_grant` stop being spendable.
 *
 * `never` is the default and the behaviour every existing grant had: units
 * accumulate for good. The other three each resolve to a concrete instant on
 * the lot the grant creates, so expiry is decided once at grant time rather
 * than re-derived on every read:
 *
 * - `period_end` — the end of the billing period that granted them, so an
 *   allowance that is not spent within its own period does not roll over.
 * - `duration` — `balanceExpiryMonths` after the grant, independent of the
 *   billing period.
 * - `after_plan_end` — `balanceExpiryMonths` after the subscription itself
 *   ends. The instant is unknowable at grant time, so these lots are created
 *   open-ended and stamped when the subscription actually ends.
 */
export const BALANCE_EXPIRY_POLICIES = [
  "never",
  "period_end",
  "duration",
  "after_plan_end",
] as const;
export type BalanceExpiryPolicy = (typeof BALANCE_EXPIRY_POLICIES)[number];

/**
 * What a plan grants. One row per grant so the console (and the AI) can add or
 * remove a single entitlement without rewriting the plan.
 *
 * `balance_grant` credits `amount` units every non-trial billing period and
 * optionally `trialAmount` during a trial; `usage_limit` sets the per-period
 * allowance for a usage item.
 */
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ENTITLEMENT_KINDS }).notNull(),
    roleId: text("role_id").references(() => subscriptionRoles.id, {
      onDelete: "cascade",
    }),
    permissionKey: text("permission_key"),
    permissionScope: text("permission_scope", { enum: ["all", "selected"] }),
    permissionTargetIds: jsonb("permission_target_ids").$type<
      string[]
    >(),
    usageItemId: text("usage_item_id").references(() => usageItems.id, {
      onDelete: "cascade",
    }),
    /** Allowance after the trial ends (and for plans without a trial). */
    limitValue: bigint("limit_value", { mode: "number" }),
    /** Allowance while Stripe reports the subscription as trialing. */
    trialLimitValue: bigint("trial_limit_value", { mode: "number" }),
    unitId: text("unit_id").references(() => balanceUnits.id, {
      onDelete: "cascade",
    }),
    /** Units granted after the trial ends (and for plans without a trial). */
    amount: bigint("amount", { mode: "number" }),
    /** Units granted while the subscription is trialing. Null inherits `amount`. */
    trialAmount: bigint("trial_amount", { mode: "number" }),
    /** `balance_grant` only. See `BALANCE_EXPIRY_POLICIES`. */
    balanceExpiryPolicy: text("balance_expiry_policy", {
      enum: BALANCE_EXPIRY_POLICIES,
    })
      .notNull()
      .default("never"),
    /** Months, required by the `duration` and `after_plan_end` policies. */
    balanceExpiryMonths: bigint("balance_expiry_months", { mode: "number" }),
    featureKey: text("feature_key"),
    featureValue: text("feature_value"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    index("plan_entitlements_plan_idx").on(table.planId),
    check(
      "plan_entitlements_expiry_months_positive",
      sql`${table.balanceExpiryMonths} IS NULL OR ${table.balanceExpiryMonths} >= 1`,
    ),
    // The two duration-bearing policies are meaningless without a duration.
    check(
      "plan_entitlements_expiry_months_required",
      sql`${table.balanceExpiryPolicy} NOT IN ('duration', 'after_plan_end') OR ${table.balanceExpiryMonths} IS NOT NULL`,
    ),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanEntitlement = typeof planEntitlements.$inferSelect;
