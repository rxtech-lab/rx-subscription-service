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
export const usageItems = sqliteTable(
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
    resetIntervalCount: integer("reset_interval_count"),
    resetIntervalUnit: text("reset_interval_unit", { enum: RESET_UNITS }),
    defaultLimit: integer("default_limit"),
    overagePolicy: text("overage_policy", {
      enum: ["block", "allow", "charge_balance"],
    })
      .notNull()
      .default("block"),
    overageUnitId: text("overage_unit_id").references(() => balanceUnits.id, {
      onDelete: "set null",
    }),
    overageCostPerUnit: integer("overage_cost_per_unit"),
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
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
export const usageCounters = sqliteTable(
  "usage_counters",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    usageItemId: text("usage_item_id")
      .notNull()
      .references(() => usageItems.id, { onDelete: "cascade" }),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }),
    used: integer("used").notNull().default(0),
    limitValue: integer("limit_value"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
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
export const usageRecords = sqliteTable(
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
    amount: integer("amount").notNull(),
    usedAfter: integer("used_after").notNull(),
    chargedUnits: integer("charged_units").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("usage_records_user_created_idx").on(table.appUserId, table.createdAt),
    index("usage_records_item_created_idx").on(table.usageItemId, table.createdAt),
  ],
);

export type UsageItem = typeof usageItems.$inferSelect;
export type NewUsageItem = typeof usageItems.$inferInsert;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
