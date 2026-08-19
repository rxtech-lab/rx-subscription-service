import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { applications } from "./applications";
import { balanceUnits } from "./units";
import { subscriptionRoles } from "./roles";
import { usageItems } from "./usage";

export const BILLING_INTERVALS = ["month", "quarter", "year", "one_time"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    billingInterval: text("billing_interval", { enum: BILLING_INTERVALS }).notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    priceAmountCents: integer("price_amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    trialDays: integer("trial_days").notNull().default(0),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    stripeProductId: text("stripe_product_id"),
    stripePriceId: text("stripe_price_id"),
    /** Stripe ids are per-account, so the sandbox account needs its own pair. */
    stripeSandboxProductId: text("stripe_sandbox_product_id"),
    stripeSandboxPriceId: text("stripe_sandbox_price_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("plans_app_key_idx").on(table.applicationId, table.key),
    index("plans_app_status_idx").on(table.applicationId, table.status),
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
 * What a plan grants. One row per grant so the console (and the AI) can add or
 * remove a single entitlement without rewriting the plan.
 *
 * `balance_grant` credits `amount` units every billing period; `usage_limit`
 * sets the per-period allowance for a usage item.
 */
export const planEntitlements = sqliteTable(
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
    permissionTargetIds: text("permission_target_ids", { mode: "json" }).$type<
      string[]
    >(),
    usageItemId: text("usage_item_id").references(() => usageItems.id, {
      onDelete: "cascade",
    }),
    /** Allowance after the trial ends (and for plans without a trial). */
    limitValue: integer("limit_value"),
    /** Allowance while Stripe reports the subscription as trialing. */
    trialLimitValue: integer("trial_limit_value"),
    unitId: text("unit_id").references(() => balanceUnits.id, {
      onDelete: "cascade",
    }),
    amount: integer("amount"),
    featureKey: text("feature_key"),
    featureValue: text("feature_value"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("plan_entitlements_plan_idx").on(table.planId)],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanEntitlement = typeof planEntitlements.$inferSelect;
