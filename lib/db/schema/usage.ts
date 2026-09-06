import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";
import { applications } from "./applications";
import { balanceUnits } from "./units";
import { appUsers } from "./users";

export const RESET_POLICIES = [
  "never",
  "rolling_window",
  "calendar_period",
  "billing_period",
] as const;
export type ResetPolicy = (typeof RESET_POLICIES)[number];

export const RESET_UNITS = ["hour", "day", "week", "month"] as const;
export type ResetUnit = (typeof RESET_UNITS)[number];

/**
 * A meterable thing an application tracks per user — "api_calls",
 * "video_minutes", "seats". Applications may define as many as they like.
 *
 * Reset behaviour is data, not code: `rolling_window` counts from first use,
 * `calendar_period` snaps to clock boundaries, `billing_period` follows the
 * user's subscription period, and `never` accumulates forever. New policies are
 * additive enum values.
 */
export const usageItems = pgTable(
  "usage_items",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    valueType: text("value_type", { enum: ["counter", "gauge"] })
      .notNull()
      .default("counter"),
    resetPolicy: text("reset_policy", { enum: RESET_POLICIES })
      .notNull()
      .default("never"),
    resetIntervalCount: bigint("reset_interval_count", { mode: "number" }),
    resetIntervalUnit: text("reset_interval_unit", { enum: RESET_UNITS }),
    defaultLimit: bigint("default_limit", { mode: "number" }),
    overagePolicy: text("overage_policy", {
      enum: ["block", "allow", "charge_balance"],
    })
      .notNull()
      .default("block"),
    overageUnitId: text("overage_unit_id").references(() => balanceUnits.id, {
      onDelete: "set null",
    }),
    overageCostPerUnit: bigint("overage_cost_per_unit", { mode: "number" }),
    sortOrder: bigint("sort_order", { mode: "number" }).notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("usage_items_app_key_idx").on(table.applicationId, table.key),
    check(
      "usage_items_interval_positive",
      sql`${table.resetIntervalCount} IS NULL OR ${table.resetIntervalCount} >= 1`,
    ),
    check(
      "usage_items_limit_nonnegative",
      sql`${table.defaultLimit} IS NULL OR ${table.defaultLimit} >= 0`,
    ),
  ],
);

/**
 * One row per (user, item, period). Periods roll lazily: a read or increment
 * past `periodEnd` opens the next row, so no cron is needed to reset counters.
 * `limitValue` is resolved from the subscription when the period opens, which
 * keeps a mid-period plan edit from retroactively changing an allowance.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    usageItemId: text("usage_item_id")
      .notNull()
      .references(() => usageItems.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "date", precision: 3 }),
    used: bigint("used", { mode: "number" }).notNull().default(0),
    limitValue: bigint("limit_value", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("usage_counters_user_item_period_idx").on(
      table.appUserId,
      table.usageItemId,
      table.periodStart,
    ),
    index("usage_counters_user_item_idx").on(table.appUserId, table.usageItemId),
    check("usage_counters_used_nonnegative", sql`${table.used} >= 0`),
  ],
);

/** Append-only audit trail behind every counter movement. */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    usageItemId: text("usage_item_id")
      .notNull()
      .references(() => usageItems.id, { onDelete: "cascade" }),
    counterId: text("counter_id").references(() => usageCounters.id, {
      onDelete: "set null",
    }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    usedAfter: bigint("used_after", { mode: "number" }).notNull(),
    chargedUnits: bigint("charged_units", { mode: "number" }).notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    index("usage_records_user_created_idx").on(table.appUserId, table.createdAt),
    index("usage_records_item_created_idx").on(table.usageItemId, table.createdAt),
  ],
);

/**
 * A per-user allowance override for one usage item.
 *
 * Highest precedence: it wins over every plan allowance and over the item's own
 * default, in both directions. That is what makes a limit testable — the Test
 * tab can park a user one call away from their cap, and the test app's "raise
 * the limit" button can lift it again without touching the plan.
 *
 * A null `limitValue` means unlimited, matching the plan entitlement encoding.
 * Deleting the row falls back to the plan.
 */
export const appUserUsageLimits = pgTable(
  "app_user_usage_limits",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    usageItemId: text("usage_item_id")
      .notNull()
      .references(() => usageItems.id, { onDelete: "cascade" }),
    limitValue: bigint("limit_value", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("app_user_usage_limits_user_item_idx").on(
      table.appUserId,
      table.usageItemId,
    ),
    check(
      "app_user_usage_limits_nonnegative",
      sql`${table.limitValue} IS NULL OR ${table.limitValue} >= 0`,
    ),
  ],
);

export type UsageItem = typeof usageItems.$inferSelect;
export type NewUsageItem = typeof usageItems.$inferInsert;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type AppUserUsageLimit = typeof appUserUsageLimits.$inferSelect;
