import "server-only";
import { and, asc, count, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  couponRedemptions,
  couponTargets,
  couponUsers,
  coupons,
  purchases,
  subscriptions,
  type Coupon,
  type CouponDuration,
  type Plan,
  type TopupProduct,
} from "@/lib/db/schema";
import {
  assertCurrency,
  assertNonNegativeInteger,
  assertPositiveInteger,
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";
import {
  couponBlockers,
  explainBlocker,
  normalizeCouponCode,
  quoteDiscount,
  type CouponBlocker,
  type CouponTerms,
} from "./coupon-rules";
import { requirePlan } from "./plans";
import { simulatedNow } from "./test-clock";
import { requireTopupProduct } from "./topups";

/** The transaction handle drizzle hands the callback, named once. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type QueryDb = Pick<Tx, "select">;

/**
 * How long a checkout may hold a use of a limited code.
 *
 * A reservation is what stops six tabs from spending the last three uses six
 * times, but an abandoned Checkout would otherwise hold its use forever.
 * `checkout.session.expired` releases it as soon as Stripe gives up; this
 * ceiling is the backstop for a webhook that never arrives, and matches Stripe's
 * own 24-hour session expiry.
 */
export const RESERVATION_TTL_MS = 24 * 60 * 60_000;

/** What a coupon is being applied to. Checkout is always a single line item. */
export type CouponTarget =
  | { kind: "plan"; plan: Plan }
  | { kind: "topup"; product: TopupProduct };

export function targetPrice(target: CouponTarget): {
  priceAmountCents: number;
  currency: string;
} {
  return target.kind === "plan"
    ? {
        priceAmountCents: target.plan.priceAmountCents,
        currency: target.plan.currency,
      }
    : {
        priceAmountCents: target.product.priceAmountCents,
        currency: target.product.currency,
      };
}

export function couponTerms(coupon: Coupon): CouponTerms {
  return {
    discountType: coupon.discountType,
    percentBasisPoints: coupon.percentBasisPoints,
    amountOffCents: coupon.amountOffCents,
    maxDiscountCents: coupon.maxDiscountCents,
    currency: coupon.currency,
    duration: coupon.duration,
    durationInMonths: coupon.durationInMonths,
  };
}

export async function listCoupons(
  applicationId: string,
  options: { includeArchived?: boolean } = {},
) {
  const rows = await db
    .select()
    .from(coupons)
    .where(eq(coupons.applicationId, applicationId))
    .orderBy(asc(coupons.code));
  return options.includeArchived
    ? rows
    : rows.filter((coupon) => coupon.status !== "archived");
}

export async function requireCoupon(applicationId: string, couponId: string) {
  const [coupon] = await db
    .select()
    .from(coupons)
    .where(and(eq(coupons.id, couponId), eq(coupons.applicationId, applicationId)))
    .limit(1);
  if (!coupon) throw new NotFoundError("coupon", couponId);
  return coupon;
}

/** Codes are unique within an application, never across the Stripe account. */
export async function findCouponByCode(applicationId: string, code: string) {
  const [coupon] = await db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.applicationId, applicationId),
        eq(coupons.code, normalizeCouponCode(code)),
      ),
    )
    .limit(1);
  return coupon ?? null;
}

export async function listCouponTargets(couponId: string) {
  return listCouponTargetsWith(db, couponId);
}

function listCouponTargetsWith(database: QueryDb, couponId: string) {
  return database
    .select()
    .from(couponTargets)
    .where(eq(couponTargets.couponId, couponId));
}

export async function listCouponUsers(couponId: string) {
  return db
    .select({
      id: couponUsers.id,
      appUserId: couponUsers.appUserId,
      displayName: appUsers.displayName,
      email: appUsers.email,
      rxlabUserId: appUsers.rxlabUserId,
      isTest: appUsers.isTest,
    })
    .from(couponUsers)
    .innerJoin(appUsers, eq(appUsers.id, couponUsers.appUserId))
    .where(eq(couponUsers.couponId, couponId));
}

/** Live holds plus redeemed uses: what a limit is actually measured against. */
export async function couponUsage(couponId: string, appUserId?: string) {
  return couponUsageWith(db, couponId, appUserId);
}

async function couponUsageWith(
  database: QueryDb,
  couponId: string,
  appUserId?: string,
) {
  const live = or(
    eq(couponRedemptions.status, "redeemed"),
    // Delayed payment methods can process for multiple days. Once Checkout is
    // complete, this use stays held until Stripe explicitly succeeds or fails.
    eq(couponRedemptions.status, "processing"),
    and(
      eq(couponRedemptions.status, "reserved"),
      gt(couponRedemptions.createdAt, new Date(Date.now() - RESERVATION_TTL_MS)),
    ),
  );

  const [total] = await database
    .select({ value: count() })
    .from(couponRedemptions)
    .where(and(eq(couponRedemptions.couponId, couponId), live));

  const [redeemed] = await database
    .select({ value: count() })
    .from(couponRedemptions)
    .where(
      and(
        eq(couponRedemptions.couponId, couponId),
        eq(couponRedemptions.status, "redeemed"),
      ),
    );

  const [byUser] = appUserId
    ? await database
        .select({ value: count() })
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.couponId, couponId),
            eq(couponRedemptions.appUserId, appUserId),
            live,
          ),
        )
    : [{ value: 0 }];

  return {
    used: total?.value ?? 0,
    redeemed: redeemed?.value ?? 0,
    usedByUser: byUser?.value ?? 0,
  };
}

export interface CouponInput {
  applicationId: string;
  code: string;
  name: string;
  description?: string | null;
  discountType: "percent" | "amount";
  /** Hundredths of a percent: 25.5% is 2550. */
  percentBasisPoints?: number | null;
  amountOffCents?: number | null;
  currency?: string;
  maxDiscountCents?: number | null;
  duration?: CouponDuration;
  durationInMonths?: number | null;
  appliesTo?: "all" | "selected";
  planIds?: string[];
  topupProductIds?: string[];
  /** Whether couponUsers is an allow-list. False means anyone may redeem. */
  restrictToUsers?: boolean;
  appUserIds?: string[];
  maxRedemptions?: number | null;
  maxRedemptionsPerUser?: number | null;
  minimumAmountCents?: number | null;
  firstTimeOnly?: boolean;
  startsAt?: Date | null;
  redeemBy?: Date | null;
  actor: Actor;
}

/** Shared shape validation for create and update. */
function assertDiscountShape(input: {
  discountType: "percent" | "amount";
  percentBasisPoints: number | null;
  amountOffCents: number | null;
  duration: CouponDuration;
  durationInMonths: number | null;
  maxDiscountCents: number | null;
}) {
  if (input.discountType === "percent") {
    if (input.percentBasisPoints === null) {
      throw new ValidationError("a percentage coupon needs percentBasisPoints");
    }
    assertPositiveInteger(input.percentBasisPoints, "percentBasisPoints");
    if (input.percentBasisPoints > 10_000) {
      throw new ValidationError("percentBasisPoints cannot exceed 10000 (100%)");
    }
  } else {
    if (input.amountOffCents === null) {
      throw new ValidationError("a fixed-amount coupon needs amountOffCents");
    }
    assertPositiveInteger(input.amountOffCents, "amountOffCents");
  }

  if (input.duration === "repeating") {
    if (input.durationInMonths === null) {
      throw new ValidationError("a repeating coupon needs durationInMonths");
    }
    assertPositiveInteger(input.durationInMonths, "durationInMonths");
  }
  if (input.maxDiscountCents !== null) {
    assertPositiveInteger(input.maxDiscountCents, "maxDiscountCents");
  }
}

function assertCouponEnums(input: {
  discountType?: string;
  duration?: string;
  appliesTo?: string;
  status?: string;
}) {
  if (
    input.discountType !== undefined &&
    input.discountType !== "percent" &&
    input.discountType !== "amount"
  ) {
    throw new ValidationError("discountType must be percent or amount");
  }
  if (
    input.duration !== undefined &&
    input.duration !== "once" &&
    input.duration !== "repeating" &&
    input.duration !== "forever"
  ) {
    throw new ValidationError("duration must be once, repeating, or forever");
  }
  if (
    input.appliesTo !== undefined &&
    input.appliesTo !== "all" &&
    input.appliesTo !== "selected"
  ) {
    throw new ValidationError("appliesTo must be all or selected");
  }
  if (
    input.status !== undefined &&
    input.status !== "draft" &&
    input.status !== "active" &&
    input.status !== "archived"
  ) {
    throw new ValidationError("status must be draft, active, or archived");
  }
}

function assertRedemptionWindow(startsAt: Date | null, redeemBy: Date | null) {
  if (startsAt && Number.isNaN(startsAt.getTime())) {
    throw new ValidationError("startsAt must be a valid date");
  }
  if (redeemBy && Number.isNaN(redeemBy.getTime())) {
    throw new ValidationError("redeemBy must be a valid date");
  }
  if (startsAt && redeemBy && startsAt >= redeemBy) {
    throw new ValidationError("redeemBy must be later than startsAt");
  }
  if (redeemBy) {
    const latest = new Date();
    latest.setUTCFullYear(latest.getUTCFullYear() + 5);
    if (redeemBy > latest) {
      throw new ValidationError("redeemBy cannot be more than 5 years in the future");
    }
  }
}

async function replaceTargets(
  tx: Tx,
  input: {
    applicationId: string;
    couponId: string;
    planIds: string[];
    topupProductIds: string[];
  },
) {
  await tx.delete(couponTargets).where(eq(couponTargets.couponId, input.couponId));
  const now = new Date();
  const rows = [
    ...input.planIds.map((planId) => ({
      id: newId(),
      couponId: input.couponId,
      planId,
      topupProductId: null,
      createdAt: now,
    })),
    ...input.topupProductIds.map((topupProductId) => ({
      id: newId(),
      couponId: input.couponId,
      planId: null,
      topupProductId,
      createdAt: now,
    })),
  ];
  if (rows.length > 0) await tx.insert(couponTargets).values(rows);
}

async function replaceUsers(
  tx: Tx,
  input: { couponId: string; appUserIds: string[] },
) {
  await tx.delete(couponUsers).where(eq(couponUsers.couponId, input.couponId));
  if (input.appUserIds.length === 0) return;
  const now = new Date();
  await tx.insert(couponUsers).values(
    input.appUserIds.map((appUserId) => ({
      id: newId(),
      couponId: input.couponId,
      appUserId,
      createdAt: now,
    })),
  );
}

/** Every id must belong to this application — an id from another app is a 404. */
async function assertTargetsBelong(input: {
  applicationId: string;
  planIds: string[];
  topupProductIds: string[];
}) {
  for (const planId of input.planIds) {
    await requirePlan(input.applicationId, planId);
  }
  for (const topupId of input.topupProductIds) {
    await requireTopupProduct(input.applicationId, topupId);
  }
}

async function assertUsersBelong(applicationId: string, appUserIds: string[]) {
  if (appUserIds.length === 0) return;
  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.applicationId, applicationId),
        inArray(appUsers.id, appUserIds),
      ),
    );
  const found = new Set(rows.map((row) => row.id));
  for (const id of appUserIds) {
    if (!found.has(id)) throw new NotFoundError("user", id);
  }
}

export async function createCoupon(input: CouponInput) {
  assertCouponEnums(input);
  const code = normalizeCouponCode(input.code);
  const name = input.name.trim();
  if (!name) throw new ValidationError("name is required");
  if (name.length > 120) throw new ValidationError("name cannot exceed 120 characters");

  const discountType = input.discountType;
  const percentBasisPoints =
    discountType === "percent" ? (input.percentBasisPoints ?? null) : null;
  const amountOffCents =
    discountType === "amount" ? (input.amountOffCents ?? null) : null;
  const duration = input.duration ?? "once";
  const durationInMonths = duration === "repeating" ? (input.durationInMonths ?? null) : null;
  const maxDiscountCents = input.maxDiscountCents ?? null;

  assertDiscountShape({
    discountType,
    percentBasisPoints,
    amountOffCents,
    duration,
    durationInMonths,
    maxDiscountCents,
  });

  const currency = assertCurrency(input.currency ?? "usd");
  if (input.maxRedemptions != null) {
    assertPositiveInteger(input.maxRedemptions, "maxRedemptions");
  }
  if (input.maxRedemptionsPerUser != null) {
    assertPositiveInteger(input.maxRedemptionsPerUser, "maxRedemptionsPerUser");
  }
  if (input.minimumAmountCents != null) {
    assertNonNegativeInteger(input.minimumAmountCents, "minimumAmountCents");
  }

  const appliesTo = input.appliesTo ?? "all";
  const planIds = [...new Set(input.planIds ?? [])];
  const topupProductIds = [...new Set(input.topupProductIds ?? [])];
  const restrictToUsers = input.restrictToUsers ?? false;
  const appUserIds = restrictToUsers ? [...new Set(input.appUserIds ?? [])] : [];
  if (appliesTo === "selected" && planIds.length + topupProductIds.length === 0) {
    throw new ValidationError(
      "a coupon restricted to selected items needs at least one plan or topup",
    );
  }
  if (restrictToUsers && appUserIds.length === 0) {
    throw new ValidationError("a user-restricted coupon needs at least one user");
  }
  await assertTargetsBelong({
    applicationId: input.applicationId,
    planIds,
    topupProductIds,
  });
  await assertUsersBelong(input.applicationId, appUserIds);
  assertRedemptionWindow(input.startsAt ?? null, input.redeemBy ?? null);

  const [duplicate] = await db
    .select({ id: coupons.id })
    .from(coupons)
    .where(and(eq(coupons.applicationId, input.applicationId), eq(coupons.code, code)))
    .limit(1);
  if (duplicate) throw new ValidationError(`a coupon with code "${code}" already exists`);

  const now = new Date();
  const coupon = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(coupons)
      .values({
        id: newId(),
        applicationId: input.applicationId,
        code,
        name,
        description: input.description?.trim() || null,
        discountType,
        percentBasisPoints,
        amountOffCents,
        currency,
        maxDiscountCents,
        duration,
        durationInMonths,
        appliesTo,
        restrictToUsers,
        maxRedemptions: input.maxRedemptions ?? null,
        maxRedemptionsPerUser: input.maxRedemptionsPerUser ?? null,
        minimumAmountCents: input.minimumAmountCents ?? null,
        firstTimeOnly: input.firstTimeOnly ?? false,
        startsAt: input.startsAt ?? null,
        redeemBy: input.redeemBy ?? null,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await replaceTargets(tx, {
      applicationId: input.applicationId,
      couponId: row.id,
      planIds: appliesTo === "selected" ? planIds : [],
      topupProductIds: appliesTo === "selected" ? topupProductIds : [],
    });
    await replaceUsers(tx, {
      couponId: row.id,
      appUserIds,
    });
    return row;
  });

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "coupon.create",
    entityType: "coupon",
    entityId: coupon.id,
    after: coupon,
  });
  return coupon;
}

export async function updateCoupon(input: {
  applicationId: string;
  couponId: string;
  name?: string;
  description?: string | null;
  percentBasisPoints?: number | null;
  amountOffCents?: number | null;
  maxDiscountCents?: number | null;
  duration?: CouponDuration;
  durationInMonths?: number | null;
  appliesTo?: "all" | "selected";
  planIds?: string[];
  topupProductIds?: string[];
  restrictToUsers?: boolean;
  appUserIds?: string[];
  maxRedemptions?: number | null;
  maxRedemptionsPerUser?: number | null;
  minimumAmountCents?: number | null;
  firstTimeOnly?: boolean;
  startsAt?: Date | null;
  redeemBy?: Date | null;
  status?: "draft" | "active" | "archived";
  actor: Actor;
}) {
  assertCouponEnums(input);
  const before = await requireCoupon(input.applicationId, input.couponId);
  const name = input.name === undefined ? before.name : input.name.trim();
  if (!name) throw new ValidationError("name is required");
  if (name.length > 120) throw new ValidationError("name cannot exceed 120 characters");

  const percentBasisPoints =
    before.discountType === "percent"
      ? input.percentBasisPoints === undefined
        ? before.percentBasisPoints
        : input.percentBasisPoints
      : null;
  const amountOffCents =
    before.discountType === "amount"
      ? input.amountOffCents === undefined
        ? before.amountOffCents
        : input.amountOffCents
      : null;
  const duration = input.duration ?? before.duration;
  const durationInMonths =
    duration === "repeating"
      ? input.durationInMonths === undefined
        ? before.durationInMonths
        : input.durationInMonths
      : null;
  const maxDiscountCents =
    input.maxDiscountCents === undefined
      ? before.maxDiscountCents
      : input.maxDiscountCents;

  assertDiscountShape({
    discountType: before.discountType,
    percentBasisPoints,
    amountOffCents,
    duration,
    durationInMonths,
    maxDiscountCents,
  });

  if (input.maxRedemptions != null) {
    assertPositiveInteger(input.maxRedemptions, "maxRedemptions");
  }
  if (input.maxRedemptionsPerUser != null) {
    assertPositiveInteger(input.maxRedemptionsPerUser, "maxRedemptionsPerUser");
  }
  if (input.minimumAmountCents != null) {
    assertNonNegativeInteger(input.minimumAmountCents, "minimumAmountCents");
  }

  const appliesTo = input.appliesTo ?? before.appliesTo;
  const existingTargets =
    input.planIds === undefined && input.topupProductIds === undefined
      ? await listCouponTargets(before.id)
      : null;
  const planIds = [
    ...new Set(
      input.planIds ??
        (existingTargets ?? [])
          .map((target) => target.planId)
          .filter((id): id is string => Boolean(id)),
    ),
  ];
  const topupProductIds = [
    ...new Set(
      input.topupProductIds ??
        (existingTargets ?? [])
          .map((target) => target.topupProductId)
          .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (appliesTo === "selected" && planIds.length + topupProductIds.length === 0) {
    throw new ValidationError(
      "a coupon restricted to selected items needs at least one plan or topup",
    );
  }
  await assertTargetsBelong({
    applicationId: input.applicationId,
    planIds,
    topupProductIds,
  });
  const restrictToUsers = input.restrictToUsers ?? before.restrictToUsers;
  const existingUsers =
    input.appUserIds === undefined ? await listCouponUsers(before.id) : null;
  const appUserIds = restrictToUsers
    ? [
        ...new Set(
          input.appUserIds ?? (existingUsers ?? []).map((row) => row.appUserId),
        ),
      ]
    : [];
  if (restrictToUsers && appUserIds.length === 0) {
    throw new ValidationError("a user-restricted coupon needs at least one user");
  }
  await assertUsersBelong(input.applicationId, appUserIds);
  const startsAt = input.startsAt === undefined ? before.startsAt : input.startsAt;
  const redeemBy = input.redeemBy === undefined ? before.redeemBy : input.redeemBy;
  assertRedemptionWindow(startsAt, redeemBy);

  const coupon = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(coupons)
      .set({
        name,
        description:
          input.description === undefined
            ? before.description
            : input.description?.trim() || null,
        percentBasisPoints,
        amountOffCents,
        maxDiscountCents,
        duration,
        durationInMonths,
        appliesTo,
        restrictToUsers,
        maxRedemptions:
          input.maxRedemptions === undefined
            ? before.maxRedemptions
            : input.maxRedemptions,
        maxRedemptionsPerUser:
          input.maxRedemptionsPerUser === undefined
            ? before.maxRedemptionsPerUser
            : input.maxRedemptionsPerUser,
        minimumAmountCents:
          input.minimumAmountCents === undefined
            ? before.minimumAmountCents
            : input.minimumAmountCents,
        firstTimeOnly: input.firstTimeOnly ?? before.firstTimeOnly,
        startsAt,
        redeemBy,
        status: input.status ?? before.status,
        updatedAt: new Date(),
      })
      .where(eq(coupons.id, before.id))
      .returning();

    await replaceTargets(tx, {
      applicationId: input.applicationId,
      couponId: before.id,
      planIds: appliesTo === "selected" ? planIds : [],
      topupProductIds: appliesTo === "selected" ? topupProductIds : [],
    });
    await replaceUsers(tx, {
      couponId: before.id,
      appUserIds,
    });
    return row;
  });

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "coupon.update",
    entityType: "coupon",
    entityId: coupon.id,
    before,
    after: coupon,
  });
  return coupon;
}

export async function setCouponStatus(input: {
  applicationId: string;
  couponId: string;
  status: "draft" | "active" | "archived";
  actor: Actor;
}) {
  return updateCoupon({
    applicationId: input.applicationId,
    couponId: input.couponId,
    status: input.status,
    actor: input.actor,
  });
}

export async function deleteCoupon(input: {
  applicationId: string;
  couponId: string;
  actor: Actor;
}) {
  const before = await requireCoupon(input.applicationId, input.couponId);
  const usage = await couponUsage(before.id);
  // Deleting would take the redemption history with it, and a redeemed code is
  // part of the payment record. Archiving stops new redemptions instead.
  if (usage.used > 0) {
    throw new ValidationError(
      "this coupon has active or completed redemptions — archive it instead of deleting it",
    );
  }

  await db.delete(coupons).where(eq(coupons.id, before.id));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "coupon.delete",
    entityType: "coupon",
    entityId: before.id,
    before,
  });
}

/** Has this user ever completed a payment in this application? */
async function hasPriorPurchaseWith(
  database: QueryDb,
  appUserId: string,
): Promise<boolean> {
  const [paid] = await database
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.appUserId, appUserId), eq(purchases.status, "paid")))
    .limit(1);
  if (paid) return true;

  const [subscribed] = await database
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.appUserId, appUserId),
        isNotNull(subscriptions.stripeSubscriptionId),
      ),
    )
    .limit(1);
  return Boolean(subscribed);
}

export interface CouponEvaluation {
  coupon: Coupon;
  applies: boolean;
  blockers: CouponBlocker[];
  /** The first blocker, phrased for a buyer. Null when the code applies. */
  reason: string | null;
  discountCents: number;
  /** Price after the discount, for the first charge. */
  totalCents: number;
  capped: boolean;
  requiresFixedAmount: boolean;
  currency: string;
}

/**
 * Decide whether one user may spend one code on one item, and for how much.
 *
 * The console preview, the validate endpoint, and checkout itself all call this,
 * so the quoted discount and the charged discount are the same number computed
 * the same way. Checkout calls it again inside its reservation, because
 * everything here can change between a preview and a payment.
 */
export async function evaluateCoupon(input: {
  applicationId: string;
  coupon: Coupon;
  appUserId: string;
  target: CouponTarget;
  now?: Date;
}): Promise<CouponEvaluation> {
  return evaluateCouponWith(db, input);
}

async function evaluateCouponWith(
  database: QueryDb,
  input: {
    applicationId: string;
    coupon: Coupon;
    appUserId: string;
    target: CouponTarget;
    now?: Date;
  },
): Promise<CouponEvaluation> {
  const { coupon, target } = input;
  if (coupon.applicationId !== input.applicationId) {
    throw new NotFoundError("coupon", coupon.id);
  }
  const { priceAmountCents, currency } = targetPrice(target);
  const terms = couponTerms(coupon);

  const [usage, allowList, targets, prior, userClock] = await Promise.all([
    couponUsageWith(database, coupon.id, input.appUserId),
    database
      .select({ appUserId: couponUsers.appUserId })
      .from(couponUsers)
      .where(eq(couponUsers.couponId, coupon.id)),
    coupon.appliesTo === "selected"
      ? listCouponTargetsWith(database, coupon.id)
      : Promise.resolve([]),
    coupon.firstTimeOnly
      ? hasPriorPurchaseWith(database, input.appUserId)
      : Promise.resolve(false),
    database
      .select({
        isTest: appUsers.isTest,
        testClockOffsetMs: appUsers.testClockOffsetMs,
      })
      .from(appUsers)
      .where(
        and(
          eq(appUsers.id, input.appUserId),
          eq(appUsers.applicationId, input.applicationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const appliesToTarget =
    coupon.appliesTo === "all"
      ? true
      : targets.some((row) =>
          target.kind === "plan"
            ? row.planId === target.plan.id
            : row.topupProductId === target.product.id,
        );

  const blockers = couponBlockers(terms, {
    status: coupon.status,
    startsAt: coupon.startsAt,
    redeemBy: coupon.redeemBy,
    maxRedemptions: coupon.maxRedemptions,
    maxRedemptionsPerUser: coupon.maxRedemptionsPerUser,
    minimumAmountCents: coupon.minimumAmountCents,
    firstTimeOnly: coupon.firstTimeOnly,
    redemptionsUsed: usage.used,
    redemptionsUsedByUser: usage.usedByUser,
    userAllowed:
      !coupon.restrictToUsers ||
      allowList.some((row) => row.appUserId === input.appUserId),
    appliesToTarget,
    hasPriorPurchase: prior,
    priceAmountCents,
    targetCurrency: currency,
    // Test users carry a persisted clock offset. Using it here makes validity
    // windows deterministic in both preview and checkout reservation, just as
    // usage reset windows already are. Real users always remain on wall time.
    now:
      input.now ??
      (userClock?.isTest
        ? simulatedNow(userClock.testClockOffsetMs)
        : new Date()),
  });

  const quote = quoteDiscount(terms, priceAmountCents);
  return {
    coupon,
    applies: blockers.length === 0,
    blockers,
    reason: blockers.length === 0 ? null : explainBlocker(blockers[0]),
    discountCents: quote.discountCents,
    totalCents: Math.max(0, priceAmountCents - quote.discountCents),
    capped: quote.capped,
    requiresFixedAmount: quote.requiresFixedAmount,
    currency,
  };
}

export class CouponNotApplicableError extends Error {
  constructor(
    readonly blockers: CouponBlocker[],
    message: string,
  ) {
    super(message);
    this.name = "CouponNotApplicableError";
  }
}

/**
 * Re-evaluate and take a use of a code in the same database transaction.
 *
 * Previewing a coupon and reserving it are deliberately separate operations,
 * but the limit check and reservation cannot be: otherwise two concurrent
 * checkouts can both observe the last available use. SQLite serializes the
 * write transaction, so the second checkout either sees the first reservation
 * or retries after the writer releases the lock; it never overspends the code.
 */
export async function reserveRedemption(input: {
  applicationId: string;
  code: string;
  appUserId: string;
  target: CouponTarget;
}) {
  const targetApplicationId =
    input.target.kind === "plan"
      ? input.target.plan.applicationId
      : input.target.product.applicationId;
  if (targetApplicationId !== input.applicationId) {
    throw new NotFoundError(
      input.target.kind === "plan" ? "plan" : "topup",
      input.target.kind === "plan" ? input.target.plan.id : input.target.product.id,
    );
  }

  const code = normalizeCouponCode(input.code);
  return db.transaction(async (tx) => {
    const [coupon] = await tx
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.applicationId, input.applicationId),
          eq(coupons.code, code),
        ),
      )
      .limit(1);
    if (!coupon) {
      throw new CouponNotApplicableError([], "That code is not valid for this app.");
    }

    const [user] = await tx
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(
        and(
          eq(appUsers.id, input.appUserId),
          eq(appUsers.applicationId, input.applicationId),
        ),
      )
      .limit(1);
    if (!user) throw new NotFoundError("user", input.appUserId);

    const evaluation = await evaluateCouponWith(tx, {
      applicationId: input.applicationId,
      coupon,
      appUserId: input.appUserId,
      target: input.target,
    });
    if (!evaluation.applies) {
      throw new CouponNotApplicableError(
        evaluation.blockers,
        evaluation.reason ?? explainBlocker(evaluation.blockers[0]),
      );
    }
    if (evaluation.discountCents <= 0) {
      throw new CouponNotApplicableError(
        [],
        "That code does not discount this item.",
      );
    }

    const [redemption] = await tx
      .insert(couponRedemptions)
      .values({
        id: newId(),
        couponId: coupon.id,
        applicationId: input.applicationId,
        appUserId: input.appUserId,
        status: "reserved",
        planId: input.target.kind === "plan" ? input.target.plan.id : null,
        topupProductId:
          input.target.kind === "topup" ? input.target.product.id : null,
        discountCents: evaluation.discountCents,
        currency: evaluation.currency,
        createdAt: new Date(),
      })
      .returning();

    return { redemption, coupon, evaluation };
  });
}

export async function attachRedemptionStripeCoupon(input: {
  redemptionId: string;
  stripeCouponId: string;
}) {
  await db
    .update(couponRedemptions)
    .set({ stripeCouponId: input.stripeCouponId })
    .where(
      and(
        eq(couponRedemptions.id, input.redemptionId),
        inArray(couponRedemptions.status, ["reserved", "processing"]),
      ),
    );
}

export async function attachRedemptionSession(input: {
  redemptionId: string;
  stripeCheckoutSessionId: string;
  purchaseId: string | null;
}) {
  await db
    .update(couponRedemptions)
    .set({
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      purchaseId: input.purchaseId,
    })
    .where(eq(couponRedemptions.id, input.redemptionId));
}

export async function releaseRedemption(redemptionId: string) {
  await db
    .update(couponRedemptions)
    .set({ status: "released" })
    .where(
      and(
        eq(couponRedemptions.id, redemptionId),
        eq(couponRedemptions.status, "reserved"),
      ),
    );
}

/**
 * Settle the use once the payment has. Conditional on a live hold, so a replayed
 * webhook and the storefront's own reconciliation cannot both count it.
 */
export async function markRedemptionPaid(input: {
  stripeCheckoutSessionId: string;
  /** Metadata fallback for a webhook that beats the post-create DB update. */
  redemptionId?: string | null;
  discountCents?: number | null;
}): Promise<boolean> {
  const values = {
    status: "redeemed" as const,
    redeemedAt: new Date(),
    ...(input.discountCents == null ? {} : { discountCents: input.discountCents }),
  };
  const updated = await db
    .update(couponRedemptions)
    .set(values)
    .where(
      and(
        eq(couponRedemptions.stripeCheckoutSessionId, input.stripeCheckoutSessionId),
        inArray(couponRedemptions.status, ["reserved", "processing"]),
      ),
    )
    .returning({ id: couponRedemptions.id });
  if (updated.length > 0 || !input.redemptionId) return updated.length > 0;

  const fallback = await db
    .update(couponRedemptions)
    .set({
      ...values,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    })
    .where(
      and(
        eq(couponRedemptions.id, input.redemptionId),
        inArray(couponRedemptions.status, ["reserved", "processing"]),
      ),
    )
    .returning({ id: couponRedemptions.id });
  return fallback.length > 0;
}

/** Keep a use held while a completed delayed payment is still processing. */
export async function markRedemptionProcessing(input: {
  stripeCheckoutSessionId: string;
  /** Metadata fallback for a webhook that beats the post-create DB update. */
  redemptionId?: string | null;
}): Promise<boolean> {
  const updated = await db
    .update(couponRedemptions)
    .set({ status: "processing" })
    .where(
      and(
        eq(couponRedemptions.stripeCheckoutSessionId, input.stripeCheckoutSessionId),
        eq(couponRedemptions.status, "reserved"),
      ),
    )
    .returning({ id: couponRedemptions.id });
  if (updated.length > 0 || !input.redemptionId) return updated.length > 0;

  const fallback = await db
    .update(couponRedemptions)
    .set({
      status: "processing",
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    })
    .where(
      and(
        eq(couponRedemptions.id, input.redemptionId),
        eq(couponRedemptions.status, "reserved"),
      ),
    )
    .returning({ id: couponRedemptions.id });
  return fallback.length > 0;
}

/** Persist a coupon selected inside Stripe-hosted Checkout rather than pre-applied. */
export async function recordPromotionCodeRedemption(input: {
  couponId: string;
  applicationId: string;
  appUserId: string;
  stripeCheckoutSessionId: string;
  stripeCouponId: string | null;
  purchaseId: string | null;
  planId: string | null;
  topupProductId: string | null;
  discountCents: number;
  currency: string;
  status: "processing" | "redeemed";
}): Promise<boolean> {
  const [coupon] = await db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.id, input.couponId),
        eq(coupons.applicationId, input.applicationId),
      ),
    )
    .limit(1);
  if (!coupon) return false;

  const inserted = await db
    .insert(couponRedemptions)
    .values({
      id: newId(),
      couponId: coupon.id,
      applicationId: input.applicationId,
      appUserId: input.appUserId,
      status: input.status,
      planId: input.planId,
      topupProductId: input.topupProductId,
      purchaseId: input.purchaseId,
      discountCents: input.discountCents,
      currency: input.currency,
      stripeCouponId: input.stripeCouponId,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      createdAt: new Date(),
      redeemedAt: input.status === "redeemed" ? new Date() : null,
    })
    .onConflictDoNothing({ target: couponRedemptions.stripeCheckoutSessionId })
    .returning({ id: couponRedemptions.id });
  if (inserted.length > 0) return true;

  return input.status === "redeemed"
    ? markRedemptionPaid({
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        discountCents: input.discountCents,
      })
    : false;
}

/** Give the use back when Stripe expires or fails the session. */
export async function releaseRedemptionBySession(
  stripeCheckoutSessionId: string,
  redemptionId?: string | null,
): Promise<boolean> {
  const updated = await db
    .update(couponRedemptions)
    .set({ status: "released" })
    .where(
      and(
        eq(couponRedemptions.stripeCheckoutSessionId, stripeCheckoutSessionId),
        inArray(couponRedemptions.status, ["reserved", "processing"]),
      ),
    )
    .returning({ id: couponRedemptions.id });
  if (updated.length > 0 || !redemptionId) return updated.length > 0;

  const fallback = await db
    .update(couponRedemptions)
    .set({ status: "released", stripeCheckoutSessionId })
    .where(
      and(
        eq(couponRedemptions.id, redemptionId),
        inArray(couponRedemptions.status, ["reserved", "processing"]),
      ),
    )
    .returning({ id: couponRedemptions.id });
  return fallback.length > 0;
}

/** Redemption history for the console, newest first. */
export async function listCouponRedemptions(couponId: string, limit = 50) {
  return db
    .select({
      id: couponRedemptions.id,
      status: couponRedemptions.status,
      discountCents: couponRedemptions.discountCents,
      currency: couponRedemptions.currency,
      createdAt: couponRedemptions.createdAt,
      redeemedAt: couponRedemptions.redeemedAt,
      appUserId: couponRedemptions.appUserId,
      displayName: appUsers.displayName,
      email: appUsers.email,
      isTest: appUsers.isTest,
    })
    .from(couponRedemptions)
    .innerJoin(appUsers, eq(appUsers.id, couponRedemptions.appUserId))
    .where(eq(couponRedemptions.couponId, couponId))
    .orderBy(sql`${couponRedemptions.createdAt} desc`)
    .limit(limit);
}
