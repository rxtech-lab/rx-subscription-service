import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { API_ENVIRONMENTS, applications } from "./applications";
import { BILLING_PROVIDERS, purchases, subscriptions } from "./billing";
import { plans } from "./plans";
import { topupProducts } from "./topups";
import { appUsers } from "./users";

export const STORE_PROVIDERS = ["apple_app_store", "google_play"] as const;
export type StoreProvider = (typeof STORE_PROVIDERS)[number];

export const STORE_PRODUCT_TYPES = [
  "auto_renewable_subscription",
  "non_consumable",
  "consumable",
] as const;
export type StoreProductType = (typeof STORE_PRODUCT_TYPES)[number];

/** Non-secret App Store metadata for one RxArgo application. */
export const appleStoreIntegrations = sqliteTable(
  "apple_store_integrations",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" })
      .unique(),
    bundleId: text("bundle_id").notNull().unique(),
    appAppleId: integer("app_apple_id").notNull().unique(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("apple_store_app_id_positive", sql`${table.appAppleId} > 0`),
  ],
);

/** Maps a provider product id to exactly one local plan or top-up. */
export const storeProductMappings = sqliteTable(
  "store_product_mappings",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: STORE_PROVIDERS }).notNull(),
    productId: text("product_id").notNull(),
    productType: text("product_type", { enum: STORE_PRODUCT_TYPES }).notNull(),
    planId: text("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    topupProductId: text("topup_product_id").references(() => topupProducts.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("store_products_app_provider_product_idx").on(
      table.applicationId,
      table.provider,
      table.productId,
    ),
    uniqueIndex("store_products_provider_plan_idx").on(
      table.provider,
      table.planId,
    ),
    uniqueIndex("store_products_provider_topup_idx").on(
      table.provider,
      table.topupProductId,
    ),
    check(
      "store_products_exactly_one_target",
      sql`(${table.planId} IS NOT NULL AND ${table.topupProductId} IS NULL) OR (${table.planId} IS NULL AND ${table.topupProductId} IS NOT NULL)`,
    ),
  ],
);

/**
 * What a mapped item costs on one store, when that differs from the local
 * catalog price. Apple and Google sell from their own price tiers, so the same
 * plan is routinely $9.99 through Stripe and $12.99 in the App Store. A missing
 * row means the store charges the plan or top-up price.
 *
 * Kept beside the mapping rather than on it because `store_product_mappings`
 * carries a CHECK constraint, and `drizzle-kit push` rebuilds every
 * check-constrained table on each run with an `INSERT ... SELECT` that names
 * the new columns before they exist — so a column added there fails the deploy
 * that introduces it.
 */
export const storeProductPrices = sqliteTable(
  "store_product_prices",
  {
    id: text("id").primaryKey(),
    storeProductMappingId: text("store_product_mapping_id")
      .notNull()
      .references(() => storeProductMappings.id, { onDelete: "cascade" })
      .unique(),
    priceAmountCents: integer("price_amount_cents").notNull(),
    /** Lowercase ISO 4217, e.g. "usd". */
    currency: text("currency").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
);

/** Stable provider-owned account token for one environment-specific app user. */
export const storeAccountLinks = sqliteTable(
  "store_account_links",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: STORE_PROVIDERS }).notNull(),
    providerAccountToken: text("provider_account_token").notNull(),
    consumptionDataConsent: integer("consumption_data_consent", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    consentUpdatedAt: integer("consent_updated_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("store_accounts_user_provider_idx").on(
      table.appUserId,
      table.provider,
    ),
    uniqueIndex("store_accounts_provider_token_idx").on(
      table.provider,
      table.providerAccountToken,
    ),
    index("store_accounts_app_idx").on(table.applicationId),
  ],
);

/** Normalized, verified store transaction used for replay and refund accounting. */
export const storeTransactions = sqliteTable(
  "store_transactions",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: STORE_PROVIDERS }).notNull(),
    environment: text("environment", { enum: API_ENVIRONMENTS }).notNull(),
    transactionId: text("transaction_id").notNull(),
    originalTransactionId: text("original_transaction_id").notNull(),
    productId: text("product_id").notNull(),
    productType: text("product_type", { enum: STORE_PRODUCT_TYPES }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    priceMilliunits: integer("price_milliunits"),
    currency: text("currency"),
    purchaseAt: integer("purchase_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revocationPercentage: integer("revocation_percentage").notNull().default(0),
    signedAt: integer("signed_at", { mode: "timestamp_ms" }).notNull(),
    signedTransaction: text("signed_transaction").notNull(),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    purchaseId: text("purchase_id").references(() => purchases.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("store_transactions_provider_transaction_idx").on(
      table.provider,
      table.transactionId,
    ),
    index("store_transactions_original_idx").on(
      table.provider,
      table.originalTransactionId,
    ),
    index("store_transactions_user_idx").on(table.appUserId, table.purchaseAt),
    check("store_transactions_quantity_positive", sql`${table.quantity} >= 1`),
    check(
      "store_transactions_revocation_percentage",
      sql`${table.revocationPercentage} >= 0 AND ${table.revocationPercentage} <= 100000`,
    ),
  ],
);

/** Signed provider event inbox. A failed row is safe to reclaim and retry. */
export const storeProviderEvents = sqliteTable(
  "store_provider_events",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: STORE_PROVIDERS }).notNull(),
    environment: text("environment", { enum: API_ENVIRONMENTS }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    subtype: text("subtype"),
    status: text("status", {
      enum: ["processing", "processed", "ignored", "failed"],
    }).notNull(),
    signedAt: integer("signed_at", { mode: "timestamp_ms" }),
    signedPayload: text("signed_payload").notNull(),
    failureCode: text("failure_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("store_events_provider_event_idx").on(
      table.provider,
      table.providerEventId,
    ),
    index("store_events_app_status_idx").on(table.applicationId, table.status),
  ],
);

/** Last successfully scanned notification-history boundary per app/environment. */
export const storeReconciliationCursors = sqliteTable(
  "store_reconciliation_cursors",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: BILLING_PROVIDERS }).notNull(),
    environment: text("environment", { enum: API_ENVIRONMENTS }).notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("store_reconciliation_app_provider_env_idx").on(
      table.applicationId,
      table.provider,
      table.environment,
    ),
  ],
);

export type AppleStoreIntegration = typeof appleStoreIntegrations.$inferSelect;
export type StoreProductMapping = typeof storeProductMappings.$inferSelect;
export type StoreProductPrice = typeof storeProductPrices.$inferSelect;
export type StoreAccountLink = typeof storeAccountLinks.$inferSelect;
export type StoreTransaction = typeof storeTransactions.$inferSelect;
