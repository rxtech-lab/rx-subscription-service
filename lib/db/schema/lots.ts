import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, bigint } from "drizzle-orm/pg-core";
import { appUsers, ledgerEntries } from "./users";
import { balanceUnits } from "./units";
import { plans, BALANCE_EXPIRY_POLICIES } from "./plans";
import { subscriptions } from "./billing";

/**
 * One tranche of granted units, so expiry can be decided per grant.
 *
 * `balances.amount` stays the fast scalar every read and debit guard uses; this
 * table is what makes that scalar divisible. Without it a balance is a single
 * fungible number and there is no way to answer "which of these units came from
 * the March grant, and are they still spendable?" — so no expiry policy can be
 * enforced at all.
 *
 * The invariant is `SUM(remaining) = MAX(0, balances.amount)` per (user, unit).
 * A balance can go negative when a reversal claws back units already spent
 * (see `debitBalanceAllowingNegative`); lots bottom out at zero and the next
 * credit pays that debt down before opening a new lot, which restores it.
 *
 * Debits draw soonest-expiring first, so a user never loses units they could
 * have spent.
 */
export const balanceLots = pgTable(
  "balance_lots",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    unitId: text("unit_id")
      .notNull()
      .references(() => balanceUnits.id, { onDelete: "cascade" }),
    /** The credit that opened this lot. Null for the pre-expiry backfill lot. */
    ledgerEntryId: text("ledger_entry_id").references(() => ledgerEntries.id, {
      onDelete: "set null",
    }),
    originalAmount: bigint("original_amount", { mode: "number" }).notNull(),
    remaining: bigint("remaining", { mode: "number" }).notNull(),
    /**
     * Null means "does not expire". An `after_plan_end` lot is deliberately
     * null until the subscription ends, at which point it is stamped.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date", precision: 3 }),
    /**
     * Retained so an `after_plan_end` lot can be stamped later, and so the
     * console can explain why a lot expires when it does.
     */
    expiryPolicy: text("expiry_policy", { enum: BALANCE_EXPIRY_POLICIES })
      .notNull()
      .default("never"),
    expiryMonths: bigint("expiry_months", { mode: "number" }),
    /** Set for plan grants, so plan end can find the lots it has to stamp. */
    subscriptionId: text("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    /** When the sweep actually zeroed this lot, for auditing. */
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date", precision: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    // The debit path's hot query: open lots for one balance, soonest expiry
    // first. Partial on `remaining` so exhausted lots stop costing anything.
    index("balance_lots_open_idx")
      .on(table.appUserId, table.unitId, table.expiresAt)
      .where(sql`${table.remaining} > 0`),
    // The sweep's query: everything expirable across all users.
    index("balance_lots_due_idx")
      .on(table.expiresAt)
      .where(sql`${table.remaining} > 0 AND ${table.expiresAt} IS NOT NULL`),
    index("balance_lots_subscription_idx").on(table.subscriptionId),
    check("balance_lots_remaining_nonnegative", sql`${table.remaining} >= 0`),
    check(
      "balance_lots_remaining_within_original",
      sql`${table.remaining} <= ${table.originalAmount}`,
    ),
  ],
);

export type BalanceLot = typeof balanceLots.$inferSelect;
export type NewBalanceLot = typeof balanceLots.$inferInsert;
