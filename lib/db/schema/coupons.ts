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
import { plans } from "./plans";
import { topupProducts } from "./topups";

export const COUPON_DURATIONS = ["once", "repeating", "forever"] as const;
export type CouponDuration = (typeof COUPON_DURATIONS)[number];

export const COUPON_DISCOUNT_TYPES = ["percent", "amount"] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];

/**
 * A discount code, scoped to one application.
 *
 * Stripe coupons live in an account, not in an application, so a coupon here is
 * ours first and Stripe's second: the code, who may redeem it, how often, and
 * what it may be spent on are all resolved from these rows, and only the
 * resulting discount is handed to Stripe. That is what makes a code belong to a
 * single app even though every app shares one Stripe account —
 * `lib/stripe/coupons.ts` additionally pins the minted Stripe Coupon to this
 * application's Products with `applies_to`, so a leaked id is refused by Stripe
 * itself on another app's line item.
 *
 * `percentBasisPoints` keeps the house rule that money and rates are integers:
 * 2550 is 25.5%, which is exactly what Stripe's float `percent_off` wants.
 */
export const coupons = sqliteTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    /** What the buyer types. Compared case-insensitively; stored upper-case. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    discountType: text("discount_type", { enum: COUPON_DISCOUNT_TYPES }).notNull(),
    /** Hundredths of a percent, so 25.5% is 2550. Null for amount coupons. */
    percentBasisPoints: integer("percent_basis_points"),
    /** Flat discount in minor units. Null for percentage coupons. */
    amountOffCents: integer("amount_off_cents"),
    currency: text("currency").notNull().default("usd"),
    /**
     * Ceiling on what one charge may be discounted by. Stripe has no such field,
     * so a percentage that would exceed it is converted to an equivalent
     * `amount_off` coupon at checkout.
     */
    maxDiscountCents: integer("max_discount_cents"),
    duration: text("duration", { enum: COUPON_DURATIONS }).notNull().default("once"),
    /** Required when duration is `repeating` — "20% off for 3 months". */
    durationInMonths: integer("duration_in_months"),
    /** `all` covers every active plan and topup; `selected` uses coupon_targets. */
    appliesTo: text("applies_to", { enum: ["all", "selected"] })
      .notNull()
      .default("all"),
    /** When true, an empty coupon_users set means nobody, never everybody. */
    restrictToUsers: integer("restrict_to_users", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Total redemptions allowed across every user. Null is unlimited. */
    maxRedemptions: integer("max_redemptions"),
    /** Redemptions allowed per user. Null is unlimited. */
    maxRedemptionsPerUser: integer("max_redemptions_per_user"),
    /** Order subtotal the code needs to apply at all. */
    minimumAmountCents: integer("minimum_amount_cents"),
    /** Only redeemable by a user who has never paid for anything here. */
    firstTimeOnly: integer("first_time_only", { mode: "boolean" })
      .notNull()
      .default(false),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }),
    redeemBy: integer("redeem_by", { mode: "timestamp_ms" }),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    /**
     * The last Stripe Coupon minted for this row, per account. Informational:
     * the id is derived from the coupon's terms, so checkout recomputes it and
     * mints a fresh one whenever those terms — or the set of Products it may
     * apply to — change.
     */
    stripeCouponId: text("stripe_coupon_id"),
    stripeSandboxCouponId: text("stripe_sandbox_coupon_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("coupons_app_code_idx").on(table.applicationId, table.code),
    index("coupons_app_status_idx").on(table.applicationId, table.status),
    check(
      "coupons_percent_range",
      sql`${table.percentBasisPoints} is null or (${table.percentBasisPoints} > 0 and ${table.percentBasisPoints} <= 10000)`,
    ),
    check(
      "coupons_amount_positive",
      sql`${table.amountOffCents} is null or ${table.amountOffCents} > 0`,
    ),
    check(
      "coupons_max_discount_positive",
      sql`${table.maxDiscountCents} is null or ${table.maxDiscountCents} > 0`,
    ),
    check(
      "coupons_duration_months",
      sql`${table.duration} <> 'repeating' or ${table.durationInMonths} >= 1`,
    ),
    check(
      "coupons_discount_shape",
      sql`(${table.discountType} = 'percent' and ${table.percentBasisPoints} is not null and ${table.amountOffCents} is null) or (${table.discountType} = 'amount' and ${table.amountOffCents} is not null and ${table.percentBasisPoints} is null)`,
    ),
    check(
      "coupons_usage_limits",
      sql`(${table.maxRedemptions} is null or ${table.maxRedemptions} > 0) and (${table.maxRedemptionsPerUser} is null or ${table.maxRedemptionsPerUser} > 0) and (${table.minimumAmountCents} is null or ${table.minimumAmountCents} >= 0)`,
    ),
    check(
      "coupons_redemption_window",
      sql`${table.startsAt} is null or ${table.redeemBy} is null or ${table.startsAt} < ${table.redeemBy}`,
    ),
  ],
);

/** What a `selected` coupon may be spent on. Exactly one column is set. */
export const couponTargets = sqliteTable(
  "coupon_targets",
  {
    id: text("id").primaryKey(),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    topupProductId: text("topup_product_id").references(() => topupProducts.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("coupon_targets_coupon_idx").on(table.couponId),
    uniqueIndex("coupon_targets_plan_idx").on(table.couponId, table.planId),
    uniqueIndex("coupon_targets_topup_idx").on(table.couponId, table.topupProductId),
    check(
      "coupon_targets_exactly_one_target",
      sql`(${table.planId} is not null and ${table.topupProductId} is null) or (${table.planId} is null and ${table.topupProductId} is not null)`,
    ),
  ],
);

/** An allow-list, enabled explicitly by coupons.restrictToUsers. */
export const couponUsers = sqliteTable(
  "coupon_users",
  {
    id: text("id").primaryKey(),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("coupon_users_coupon_user_idx").on(table.couponId, table.appUserId),
  ],
);

export const COUPON_REDEMPTION_STATUSES = [
  "reserved",
  "processing",
  "redeemed",
  "released",
] as const;
export type CouponRedemptionStatus = (typeof COUPON_REDEMPTION_STATUSES)[number];

/**
 * One row per checkout that carried a code.
 *
 * Written `reserved` when Checkout opens, kept as `processing` for a delayed
 * payment, and flipped to `redeemed` once the funds settle, so a code with three
 * uses left cannot be spent six times by six tabs opened at once. An abandoned,
 * expired, or failed session is `released` and gives the use back. Usage counts
 * are read from here rather than from Stripe's `times_redeemed`, which resets
 * whenever the terms change and a new Stripe Coupon is minted.
 */
export const couponRedemptions = sqliteTable(
  "coupon_redemptions",
  {
    id: text("id").primaryKey(),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    status: text("status", { enum: COUPON_REDEMPTION_STATUSES })
      .notNull()
      .default("reserved"),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    topupProductId: text("topup_product_id").references(() => topupProducts.id, {
      onDelete: "set null",
    }),
    purchaseId: text("purchase_id"),
    /** What the first charge was discounted by, after any cap. */
    discountCents: integer("discount_cents").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    stripeCouponId: text("stripe_coupon_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("coupon_redemptions_coupon_status_idx").on(table.couponId, table.status),
    index("coupon_redemptions_user_idx").on(table.couponId, table.appUserId),
    uniqueIndex("coupon_redemptions_session_idx").on(table.stripeCheckoutSessionId),
    // A live redemption has exactly one target. If that catalogue item is later
    // deleted, its `set null` foreign key preserves the payment history, so the
    // database must also allow neither target while still forbidding both.
    check(
      "coupon_redemptions_at_most_one_target",
      sql`${table.planId} is null or ${table.topupProductId} is null`,
    ),
  ],
);

export type Coupon = typeof coupons.$inferSelect;
export type NewCoupon = typeof coupons.$inferInsert;
export type CouponTarget = typeof couponTargets.$inferSelect;
export type CouponUser = typeof couponUsers.$inferSelect;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
