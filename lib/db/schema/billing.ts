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
import { appUsers } from "./users";
import { balanceUnits } from "./units";
import { plans } from "./plans";
import { topupProducts } from "./topups";

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_PROVIDERS = [
  "stripe",
  "apple_app_store",
  "google_play",
] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

/**
 * `entitlementSnapshot` freezes what the plan granted at purchase time, so
 * editing a plan never silently changes what existing subscribers already paid
 * for. Live plan edits only affect new subscriptions and renewals.
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
    currentPeriodStart: integer("current_period_start", { mode: "timestamp_ms" }),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    billingProvider: text("billing_provider", { enum: BILLING_PROVIDERS })
      .notNull()
      .default("stripe"),
    /** Provider-stable subscription identity; Apple's originalTransactionId. */
    providerSubscriptionId: text("provider_subscription_id"),
    providerProductId: text("provider_product_id"),
    /** Reject provider state older than the latest signed snapshot we applied. */
    providerSignedAt: integer("provider_signed_at", { mode: "timestamp_ms" }),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripeCustomerId: text("stripe_customer_id"),
    entitlementSnapshot: text("entitlement_snapshot", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    /**
     * The trial-watch workflow run already scheduled for this subscription, and
     * the trial end it was scheduled for. A trialing subscription re-syncs on
     * every Stripe event, and `start()` has no idempotency key of its own, so
     * without these a fresh durable timer would be enqueued per webhook.
     */
    trialWatchRunId: text("trial_watch_run_id"),
    trialWatchEndsAt: integer("trial_watch_ends_at", { mode: "timestamp_ms" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("subscriptions_user_status_idx").on(table.appUserId, table.status),
    index("subscriptions_app_status_idx").on(table.applicationId, table.status),
    index("subscriptions_plan_idx").on(table.planId),
    uniqueIndex("subscriptions_provider_id_idx").on(
      table.billingProvider,
      table.appUserId,
      table.providerSubscriptionId,
    ),
  ],
);

/** One-time plan purchases and topups. Recurring charges live on `subscriptions`. */
export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["plan_one_time", "topup"] }).notNull(),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    topupProductId: text("topup_product_id").references(() => topupProducts.id, {
      onDelete: "set null",
    }),
    unitId: text("unit_id").references(() => balanceUnits.id, {
      onDelete: "set null",
    }),
    unitsGranted: integer("units_granted").notNull().default(0),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: text("status", {
      enum: ["pending", "paid", "failed", "refunded", "disputed"],
    }).notNull(),
    billingProvider: text("billing_provider", { enum: BILLING_PROVIDERS })
      .notNull()
      .default("stripe"),
    providerTransactionId: text("provider_transaction_id"),
    providerOriginalTransactionId: text("provider_original_transaction_id"),
    providerProductId: text("provider_product_id"),
    quantity: integer("quantity").notNull().default(1),
    /** Apple records prices in 1/1000 currency units; cents remain for reports. */
    priceMilliunits: integer("price_milliunits"),
    entitlementSnapshot: text("entitlement_snapshot", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    fulfillmentFailureCode: text("fulfillment_failure_code"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeInvoiceId: text("stripe_invoice_id"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdfUrl: text("invoice_pdf_url"),
    refundedAmountCents: integer("refunded_amount_cents").notNull().default(0),
    reversedUnits: integer("reversed_units").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("purchases_user_created_idx").on(table.appUserId, table.createdAt),
    index("purchases_app_created_idx").on(table.applicationId, table.createdAt),
    uniqueIndex("purchases_provider_transaction_idx").on(
      table.billingProvider,
      table.appUserId,
      table.providerTransactionId,
    ),
    check("purchases_quantity_positive", sql`${table.quantity} >= 1`),
    check("purchases_refund_nonnegative", sql`${table.refundedAmountCents} >= 0`),
  ],
);

/** One Stripe Customer per (application, user) so balances never cross apps. */
export const stripeCustomers = sqliteTable(
  "stripe_customers",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" })
      .unique(),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("stripe_customers_customer_idx").on(table.stripeCustomerId),
  ],
);

/** Webhook dedupe. A claimed row means "someone is already handling this event". */
export const stripeWebhookEvents = sqliteTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status", {
    enum: ["processing", "processed", "ignored", "failed"],
  }).notNull(),
  objectId: text("object_id"),
  failureCode: text("failure_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type StripeCustomer = typeof stripeCustomers.$inferSelect;
