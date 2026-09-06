import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, timestamp, boolean, jsonb, bigint } from "drizzle-orm/pg-core";
import {
  API_ENVIRONMENTS,
  applications,
  type ApiEnvironment,
} from "./applications";
import { balanceUnits } from "./units";

/**
 * A user *within* an application environment. The same rxlab identity
 * (`rxlabUserId`, the token `sub`) gets independent production, sandbox, and Xcode
 * rows — and therefore independent balances, level, usage, and purchases.
 */
export const appUsers = pgTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    rxlabUserId: text("rxlab_user_id").notNull(),
    environment: text("environment", { enum: API_ENVIRONMENTS })
      .$type<ApiEnvironment>()
      .notNull()
      .default("production"),
    email: text("email"),
    displayName: text("display_name"),
    /** Application-defined tier. Meaning is owned by the app, not by us. */
    level: bigint("level", { mode: "number" }).notNull().default(0),
    levelKey: text("level_key"),
    externalRef: text("external_ref"),
    /**
     * A disposable user created from the console Test tab. Test users have no
     * rxlab identity behind them, are hidden from the real user list, and bill
     * against the Stripe sandbox account instead of the live one.
     */
    isTest: boolean("is_test").notNull().default(false),
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
    testClockOffsetMs: bigint("test_clock_offset_ms", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("app_users_app_rxlab_env_idx").on(
      table.applicationId,
      table.rxlabUserId,
      table.environment,
    ),
    index("app_users_rxlab_idx").on(table.rxlabUserId),
    index("app_users_app_test_idx").on(table.applicationId, table.isTest),
    index("app_users_app_environment_idx").on(
      table.applicationId,
      table.environment,
    ),
  ],
);

export const balances = pgTable(
  "balances",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    unitId: text("unit_id")
      .notNull()
      .references(() => balanceUnits.id, { onDelete: "cascade" }),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    reserved: bigint("reserved", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
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
export const ledgerEntries = pgTable(
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
    delta: bigint("delta", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    description: text("description").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    index("ledger_entries_user_created_idx").on(table.appUserId, table.createdAt),
    index("ledger_entries_reference_idx").on(table.referenceType, table.referenceId),
  ],
);

export const BALANCE_RESERVATION_STATUSES = [
  "open",
  "closed",
  "released",
  "expired",
] as const;
export type BalanceReservationStatus =
  (typeof BALANCE_RESERVATION_STATUSES)[number];

/**
 * A durable hold against a balance. `balances.reserved` is the aggregate fast
 * path used by debit guards; these rows are the source of truth for releasing,
 * settling, expiry, and recovery after an application restart.
 */
export const balanceReservations = pgTable(
  "balance_reservations",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    unitId: text("unit_id")
      .notNull()
      .references(() => balanceUnits.id, { onDelete: "cascade" }),
    initialAmount: bigint("initial_amount", { mode: "number" }).notNull(),
    /** Remaining hold size after increases and incremental settlements. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: text("status", { enum: BALANCE_RESERVATION_STATUSES })
      .notNull()
      .default("open"),
    description: text("description").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    requestFingerprint: text("request_fingerprint").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    /** The value returned by the original idempotent reserve operation. */
    availableAfterReserve: bigint("available_after_reserve", { mode: "number" }).notNull(),
    /** Renewed after each incremental settle and successful increase. */
    ttlSeconds: bigint("ttl_seconds", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    requestedAmount: bigint("requested_amount", { mode: "number" }).notNull().default(0),
    settledAmount: bigint("settled_amount", { mode: "number" }).notNull().default(0),
    releasedAmount: bigint("released_amount", { mode: "number" }).notNull().default(0),
    shortfallAmount: bigint("shortfall_amount", { mode: "number" }).notNull().default(0),
    releaseReason: text("release_reason"),
    entryId: text("entry_id"),
    balanceAfter: bigint("balance_after", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date", precision: 3 }),
  },
  (table) => [
    index("balance_reservations_app_user_status_idx").on(
      table.applicationId,
      table.appUserId,
      table.status,
    ),
    index("balance_reservations_expiry_idx").on(table.status, table.expiresAt),
    check("balance_reservations_initial_positive", sql`${table.initialAmount} > 0`),
    check("balance_reservations_amount_nonnegative", sql`${table.amount} >= 0`),
    check(
      "balance_reservations_available_nonnegative",
      sql`${table.availableAfterReserve} >= 0`,
    ),
    check(
      "balance_reservations_requested_nonnegative",
      sql`${table.requestedAmount} >= 0`,
    ),
    check(
      "balance_reservations_settled_nonnegative",
      sql`${table.settledAmount} >= 0`,
    ),
    check(
      "balance_reservations_released_nonnegative",
      sql`${table.releasedAmount} >= 0`,
    ),
    check(
      "balance_reservations_shortfall_nonnegative",
      sql`${table.shortfallAmount} >= 0`,
    ),
  ],
);

export const BALANCE_RESERVATION_OPERATION_KINDS = [
  "increase",
  "settle",
  "release",
] as const;
export type BalanceReservationOperationKind =
  (typeof BALANCE_RESERVATION_OPERATION_KINDS)[number];

/** Stores the exact result of each reservation mutation for safe API retries. */
export const balanceReservationOperations = pgTable(
  "balance_reservation_operations",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => balanceReservations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: BALANCE_RESERVATION_OPERATION_KINDS }).notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    requestFingerprint: text("request_fingerprint").notNull(),
    response: jsonb("response")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    index("balance_reservation_operations_reservation_idx").on(
      table.reservationId,
      table.createdAt,
    ),
    index("balance_reservation_operations_app_idx").on(table.applicationId),
  ],
);

export type AppUser = typeof appUsers.$inferSelect;
export type Balance = typeof balances.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type BalanceReservation = typeof balanceReservations.$inferSelect;
export type BalanceReservationOperation =
  typeof balanceReservationOperations.$inferSelect;
