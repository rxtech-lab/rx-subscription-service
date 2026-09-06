import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";
import { applications } from "./applications";
import { balanceUnits } from "./units";
import { plans } from "./plans";
import { subscriptionRoles } from "./roles";

/** A purchasable bundle of balance units. */
export const topupProducts = pgTable(
  "topup_products",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    unitId: text("unit_id")
      .notNull()
      .references(() => balanceUnits.id, { onDelete: "restrict" }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    priceAmountCents: bigint("price_amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    maxPurchasesPerUser: bigint("max_purchases_per_user", { mode: "number" }),
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
    uniqueIndex("topup_products_app_key_idx").on(table.applicationId, table.key),
    index("topup_products_app_status_idx").on(table.applicationId, table.status),
    check("topup_products_amount_positive", sql`${table.amount} > 0`),
    check("topup_products_price_nonnegative", sql`${table.priceAmountCents} >= 0`),
  ],
);

export const TOPUP_RULE_TYPES = [
  "requires_active_plan",
  "requires_any_plan",
  "requires_role",
] as const;
export type TopupRuleType = (typeof TOPUP_RULE_TYPES)[number];

/**
 * Gates a topup behind subscription state — "only Pro subscribers may buy this
 * pack". Rules are ANDed. Evaluated when checkout is created *and* again at
 * fulfillment, so a plan cancelled mid-checkout cannot slip through.
 */
export const topupEligibilityRules = pgTable(
  "topup_eligibility_rules",
  {
    id: text("id").primaryKey(),
    topupProductId: text("topup_product_id")
      .notNull()
      .references(() => topupProducts.id, { onDelete: "cascade" }),
    ruleType: text("rule_type", { enum: TOPUP_RULE_TYPES }).notNull(),
    planId: text("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    roleId: text("role_id").references(() => subscriptionRoles.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    index("topup_eligibility_rules_product_idx").on(table.topupProductId),
  ],
);

export type TopupProduct = typeof topupProducts.$inferSelect;
export type TopupEligibilityRule = typeof topupEligibilityRules.$inferSelect;
