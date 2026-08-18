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

/**
 * A user *within* an application. The same rxlab identity (`rxlabUserId`, the
 * token `sub`) gets an independent row — and therefore independent balances,
 * level, and usage — per application.
 */
export const appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    rxlabUserId: text("rxlab_user_id").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    /** Application-defined tier. Meaning is owned by the app, not by us. */
    level: integer("level").notNull().default(0),
    levelKey: text("level_key"),
    externalRef: text("external_ref"),
    /**
     * A disposable user created from the console Test tab. Test users have no
     * rxlab identity behind them, are hidden from the real user list, and bill
     * against the Stripe sandbox account instead of the live one.
     */
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    /** Free-text label for what this test user is set up to exercise. */
    testNote: text("test_note"),
    /**
     * How far this user's clock runs ahead of the real one, in milliseconds.
     *
     * Usage periods reset by arithmetic on `now` rather than on a schedule, so
     * shifting what `now` means for one user is enough to watch a daily or
     * monthly allowance roll over without waiting for it. Zero — every real
     * user — is ordinary wall-clock time.
     */
    testClockOffsetMs: integer("test_clock_offset_ms").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("app_users_app_rxlab_idx").on(table.applicationId, table.rxlabUserId),
    index("app_users_rxlab_idx").on(table.rxlabUserId),
    index("app_users_app_test_idx").on(table.applicationId, table.isTest),
  ],
);

export const balances = sqliteTable(
  "balances",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    unitId: text("unit_id")
      .notNull()
      .references(() => balanceUnits.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("balances_user_unit_idx").on(table.appUserId, table.unitId),
    check("balances_reserved_nonnegative", sql`${table.reserved} >= 0`),
  ],
);

export const LEDGER_KINDS = [
  "plan_grant",
  "topup",
  "usage",
  "overage",
  "refund",
  "dispute",
  "dispute_reversal",
  "adjustment",
  "expiry",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/**
 * Append-only history of every balance movement. `idempotencyKey` is unique, so
 * a retried webhook or API call can never double-credit.
 */
export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    unitId: text("unit_id")
      .notNull()
      .references(() => balanceUnits.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LEDGER_KINDS }).notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    description: text("description").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("ledger_entries_user_created_idx").on(table.appUserId, table.createdAt),
    index("ledger_entries_reference_idx").on(table.referenceType, table.referenceId),
  ],
);

export type AppUser = typeof appUsers.$inferSelect;
export type Balance = typeof balances.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
