import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, timestamp, boolean, jsonb, bigint } from "drizzle-orm/pg-core";
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

/** Free default subscriptions are owned locally and never mirrored to a store. */
export const SUBSCRIPTION_BILLING_PROVIDERS = [
  ...BILLING_PROVIDERS,
  "internal",
] as const;
export type SubscriptionBillingProvider =
  (typeof SUBSCRIPTION_BILLING_PROVIDERS)[number];

/**
 * `entitlementSnapshot` records grants captured for purchase history.
 * Existing subscriptions use current plan grants for access and future period
 * credits without changing historical balances or resetting usage periods.
 */
export const subscriptions = pgTable(
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
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: "date", precision: 3 }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "date", precision: 3 }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end")
      .notNull()
      .default(false),
    billingProvider: text("billing_provider", {
      enum: SUBSCRIPTION_BILLING_PROVIDERS,
    })
      .notNull()
      .default("stripe"),
    /** Provider-stable subscription identity; Apple's originalTransactionId. */
    providerSubscriptionId: text("provider_subscription_id"),
    providerProductId: text("provider_product_id"),
    /** Reject provider state older than the latest signed snapshot we applied. */
    providerSignedAt: timestamp("provider_signed_at", { withTimezone: true, mode: "date", precision: 3 }),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripeCustomerId: text("stripe_customer_id"),
    entitlementSnapshot: jsonb("entitlement_snapshot").$type<
      Record<string, unknown>
    >(),
    /**
     * The trial-watch workflow run already scheduled for this subscription, and
     * the trial end it was scheduled for. A trialing subscription re-syncs on
     * every Stripe event, and `start()` has no idempotency key of its own, so
     * without these a fresh durable timer would be enqueued per webhook.
     */
    trialWatchRunId: text("trial_watch_run_id"),
    trialWatchEndsAt: timestamp("trial_watch_ends_at", { withTimezone: true, mode: "date", precision: 3 }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date", precision: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
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
export const purchases = pgTable(
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
    unitsGranted: bigint("units_granted", { mode: "number" }).notNull().default(0),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
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
    quantity: bigint("quantity", { mode: "number" }).notNull().default(1),
    /** Apple records prices in 1/1000 currency units; cents remain for reports. */
    priceMilliunits: bigint("price_milliunits", { mode: "number" }),
    entitlementSnapshot: jsonb("entitlement_snapshot").$type<
      Record<string, unknown>
    >(),
    fulfillmentFailureCode: text("fulfillment_failure_code"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeInvoiceId: text("stripe_invoice_id"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdfUrl: text("invoice_pdf_url"),
    refundedAmountCents: bigint("refunded_amount_cents", { mode: "number" }).notNull().default(0),
    reversedUnits: bigint("reversed_units", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date", precision: 3 }),
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
export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" })
      .unique(),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("stripe_customers_customer_idx").on(table.stripeCustomerId),
  ],
);

/** Webhook dedupe. A claimed row means "someone is already handling this event". */
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status", {
    enum: ["processing", "processed", "ignored", "failed"],
  }).notNull(),
  objectId: text("object_id"),
  failureCode: text("failure_code"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date", precision: 3 }),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type StripeCustomer = typeof stripeCustomers.$inferSelect;
