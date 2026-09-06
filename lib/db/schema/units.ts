import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, timestamp, bigint } from "drizzle-orm/pg-core";
import { applications } from "./applications";

/**
 * An application-defined balance unit — "points", "credits", "tokens", or
 * anything else the app meters. Amounts are always stored as integers scaled by
 * `precision` decimal places, so no balance ever touches a float.
 */
export const balanceUnits = pgTable(
  "balance_units",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol"),
    precision: bigint("precision", { mode: "number" }).notNull().default(0),
    kind: text("kind", { enum: ["points", "currency", "custom"] })
      .notNull()
      .default("points"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
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
export const pointRates = pgTable(
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
    nanoMinorPerUnit: bigint("nano_minor_per_unit", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("point_rates_unit_currency_idx").on(table.unitId, table.currency),
    index("point_rates_app_idx").on(table.applicationId),
    check("point_rates_positive", sql`${table.nanoMinorPerUnit} > 0`),
  ],
);

export type BalanceUnit = typeof balanceUnits.$inferSelect;
export type PointRate = typeof pointRates.$inferSelect;
