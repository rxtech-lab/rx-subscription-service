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

/**
 * An application-defined balance unit — "points", "credits", "tokens", or
 * anything else the app meters. Amounts are always stored as integers scaled by
 * `precision` decimal places, so no balance ever touches a float.
 */
export const balanceUnits = sqliteTable(
  "balance_units",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol"),
    precision: integer("precision").notNull().default(0),
    kind: text("kind", { enum: ["points", "currency", "custom"] })
      .notNull()
      .default("points"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("balance_units_app_key_idx").on(table.applicationId, table.key),
    check(
      "balance_units_precision_range",
      sql`${table.precision} >= 0 AND ${table.precision} <= 9`,
    ),
  ],
);

/**
 * Conversion between a balance unit and real money, per application and
 * currency. `nanoMinorPerUnit` is how many billionths of a minor currency unit
 * one balance unit is worth — 1000 points for $1.50 is
 * (150 cents * 1e9) / 1000 = 150,000,000. Integer math end to end.
 */
export const pointRates = sqliteTable(
  "point_rates",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    unitId: text("unit_id")
      .notNull()
      .references(() => balanceUnits.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    nanoMinorPerUnit: integer("nano_minor_per_unit").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("point_rates_unit_currency_idx").on(table.unitId, table.currency),
    index("point_rates_app_idx").on(table.applicationId),
    check("point_rates_positive", sql`${table.nanoMinorPerUnit} > 0`),
  ],
);

export type BalanceUnit = typeof balanceUnits.$inferSelect;
export type PointRate = typeof pointRates.$inferSelect;
