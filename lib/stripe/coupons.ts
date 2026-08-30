import "server-only";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { coupons, type AppUser, type Coupon } from "@/lib/db/schema";
import { listPlans } from "@/lib/subscription/plans";
import { listTopupProducts } from "@/lib/subscription/topups";
import {
  couponUsage,
  couponTerms,
  evaluateCoupon,
  listCoupons,
  listCouponTargets,
  targetPrice,
  type CouponTarget,
} from "@/lib/subscription/coupons";
import { quoteDiscount } from "@/lib/subscription/coupon-rules";
import { stripeCouponColumns, type StripeMode } from "./accounts";
import { stripe } from "./client";
import {
  couponDisplayName,
  deriveStripeCouponId,
  percentFromBasisPoints,
  toStripeTimestamp,
  type StripeCouponShape,
} from "./coupon-scope";
import { ensurePlanProduct, ensureTopupProduct } from "./products";

/**
 * Mirror a coupon into one Stripe account, scoped to this application.
 *
 * See `coupon-scope.ts` for why the id is derived and why a scope change mints a
 * new coupon rather than editing one.
 */

function isStripeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Stripe.errors.StripeError && error.code === code;
}

/** Get-or-create on a derived id: safe to call from two checkouts at once. */
async function getOrCreateCoupon(
  mode: StripeMode,
  id: string,
  params: Omit<Stripe.CouponCreateParams, "id">,
): Promise<Stripe.Coupon> {
  try {
    // A coupon deleted in the dashboard is `resource_missing` here, so a
    // deliberate deletion is repaired by minting the same derived id again.
    const existing = await stripe(mode).coupons.retrieve(id);
    if (!("deleted" in existing) || !existing.deleted) return existing;
  } catch (error) {
    if (!isStripeErrorCode(error, "resource_missing")) throw error;
  }

  try {
    const created = await stripe(mode).coupons.create({ ...params, id });
    return created;
  } catch (error) {
    // Another request won the race with the same derived id — which means it
    // created the same coupon, because the id encodes the terms.
    if (isStripeErrorCode(error, "resource_already_exists")) {
      return stripe(mode).coupons.retrieve(id);
    }
    throw error;
  }
}

/**
 * Every Stripe Product this coupon may discount.
 *
 * An `all` coupon covers the application's active plans and topups; a `selected`
 * one covers exactly what was chosen, active or not. Products are minted on
 * demand, so a catalogue that has never been sold still gets a Stripe Product
 * the moment a coupon needs to name it.
 */
export async function couponProductIds(input: {
  coupon: Coupon;
  mode: StripeMode;
}): Promise<string[]> {
  const { coupon, mode } = input;
  const productIds: string[] = [];

  if (coupon.appliesTo === "selected") {
    const targets = await listCouponTargets(coupon.id);
    const planIds = new Set(
      targets.map((target) => target.planId).filter((id): id is string => Boolean(id)),
    );
    const topupIds = new Set(
      targets
        .map((target) => target.topupProductId)
        .filter((id): id is string => Boolean(id)),
    );

    const [plans, topups] = await Promise.all([
      listPlans(coupon.applicationId, { includeArchived: true }),
      listTopupProducts(coupon.applicationId, { includeArchived: true }),
    ]);
    for (const plan of plans) {
      if (planIds.has(plan.id)) productIds.push(await ensurePlanProduct(plan, mode));
    }
    for (const topup of topups) {
      if (topupIds.has(topup.id)) productIds.push(await ensureTopupProduct(topup, mode));
    }
    return productIds;
  }

  const [plans, topups] = await Promise.all([
    listPlans(coupon.applicationId),
    listTopupProducts(coupon.applicationId),
  ]);
  for (const plan of plans) {
    if (plan.status === "active") productIds.push(await ensurePlanProduct(plan, mode));
  }
  for (const topup of topups) {
    if (topup.status === "active") productIds.push(await ensureTopupProduct(topup, mode));
  }
  return productIds;
}

/** The one Product a capped discount is pinned to. */
async function targetProductId(
  target: CouponTarget,
  mode: StripeMode,
): Promise<string> {
  return target.kind === "plan"
    ? ensurePlanProduct(target.plan, mode)
    : ensureTopupProduct(target.product, mode);
}

export interface StripeCouponResolution {
  stripeCouponId: string;
  /** What the first charge will actually be reduced by, in minor units. */
  discountCents: number;
  /** True when a percentage was converted to a flat amount to honour the cap. */
  cappedToFixedAmount: boolean;
}

function promotionCouponId(promotionCode: Stripe.PromotionCode): string | null {
  const coupon = promotionCode.promotion.coupon;
  return typeof coupon === "string" ? coupon : (coupon?.id ?? null);
}

function remainingPromotionUses(promotionCode: Stripe.PromotionCode): number | null {
  return promotionCode.max_redemptions === null
    ? null
    : Math.max(0, promotionCode.max_redemptions - promotionCode.times_redeemed);
}

function promotionRuleFingerprint(coupon: Coupon): string {
  return [
    coupon.maxRedemptions ?? "unlimited",
    coupon.maxRedemptionsPerUser ?? "unlimited",
    coupon.minimumAmountCents ?? "none",
    coupon.currency,
    coupon.firstTimeOnly,
  ].join("|");
}

/**
 * Make this user's currently eligible app coupons redeemable in hosted Checkout.
 *
 * Promotion Codes are restricted to the app-specific Stripe Customer. Their
 * Coupons are additionally restricted to the app's Products, so enabling
 * Checkout's code box does not turn the shared Stripe account into a
 * cross-application coupon namespace.
 */
export async function prepareCheckoutPromotionCodes(input: {
  applicationId: string;
  user: AppUser;
  customerId: string;
  target: CouponTarget;
  mode: StripeMode;
}): Promise<boolean> {
  const appCoupons = await listCoupons(input.applicationId, {
    includeArchived: true,
  });
  const client = stripe(input.mode);
  const activePromotionCodes = await client.promotionCodes
    .list({ active: true, customer: input.customerId, limit: 100 })
    .autoPagingToArray({ limit: 1_000 });
  let available = 0;

  for (const coupon of appCoupons) {
    const owned = activePromotionCodes.filter(
      (promotionCode) =>
        promotionCode.code.toUpperCase() === coupon.code.toUpperCase() &&
        promotionCode.metadata?.applicationId === input.applicationId &&
        promotionCode.metadata?.couponId === coupon.id,
    );
    const evaluation = await evaluateCoupon({
      applicationId: input.applicationId,
      coupon,
      appUserId: input.user.id,
      target: input.target,
    });

    if (!evaluation.applies || evaluation.discountCents <= 0) {
      await Promise.all(
        owned.map((promotionCode) =>
          client.promotionCodes.update(promotionCode.id, { active: false }),
        ),
      );
      continue;
    }

    const usage = await couponUsage(coupon.id, input.user.id);
    const remainingLimits = [
      coupon.maxRedemptions === null
        ? null
        : Math.max(0, coupon.maxRedemptions - usage.used),
      coupon.maxRedemptionsPerUser === null
        ? null
        : Math.max(0, coupon.maxRedemptionsPerUser - usage.usedByUser),
    ].filter((value): value is number => value !== null);
    const maxRedemptions =
      remainingLimits.length > 0 ? Math.min(...remainingLimits) : null;
    if (maxRedemptions === 0) {
      await Promise.all(
        owned.map((promotionCode) =>
          client.promotionCodes.update(promotionCode.id, { active: false }),
        ),
      );
      continue;
    }

    const resolved = await resolveStripeCoupon({
      coupon,
      target: input.target,
      mode: input.mode,
    });
    const ruleFingerprint = promotionRuleFingerprint(coupon);
    const reusable = owned.find((promotionCode) => {
      if (
        promotionCouponId(promotionCode) !== resolved.stripeCouponId ||
        promotionCode.metadata?.ruleFingerprint !== ruleFingerprint
      ) {
        return false;
      }
      const remaining = remainingPromotionUses(promotionCode);
      // A tighter existing Stripe limit is safe and can simply be reused while
      // its completion webhook catches the local redemption count up.
      return (
        remaining === maxRedemptions ||
        (remaining !== null && (maxRedemptions === null || remaining < maxRedemptions))
      );
    });

    await Promise.all(
      owned
        .filter((promotionCode) => promotionCode.id !== reusable?.id)
        .map((promotionCode) =>
          client.promotionCodes.update(promotionCode.id, { active: false }),
        ),
    );

    if (!reusable) {
      const restrictions = {
        ...(coupon.firstTimeOnly ? { first_time_transaction: true } : {}),
        ...(coupon.minimumAmountCents === null
          ? {}
          : {
              minimum_amount: coupon.minimumAmountCents,
              minimum_amount_currency: coupon.currency,
            }),
      };
      await client.promotionCodes.create({
        promotion: { type: "coupon", coupon: resolved.stripeCouponId },
        code: coupon.code,
        customer: input.customerId,
        ...(maxRedemptions === null ? {} : { max_redemptions: maxRedemptions }),
        ...(coupon.redeemBy === null
          ? {}
          : { expires_at: toStripeTimestamp(coupon.redeemBy)! }),
        ...(Object.keys(restrictions).length === 0 ? {} : { restrictions }),
        metadata: {
          applicationId: input.applicationId,
          appUserId: input.user.id,
          couponId: coupon.id,
          code: coupon.code,
          ruleFingerprint,
        },
      }, {
        idempotencyKey: [
          "promotion-code",
          coupon.id,
          input.customerId,
          resolved.stripeCouponId,
          maxRedemptions ?? "unlimited",
          coupon.updatedAt.getTime(),
        ].join(":"),
      });
    }
    available += 1;
  }

  return available > 0;
}

/**
 * The Stripe Coupon to send with one Checkout Session.
 *
 * A percentage whose `maxDiscountCents` binds cannot be expressed as a Stripe
 * percentage — Stripe has no ceiling — so it becomes the equivalent flat amount
 * for the price being bought, pinned to that one Product so the derived amount
 * can never land on a different, more expensive item.
 */
export async function resolveStripeCoupon(input: {
  coupon: Coupon;
  target: CouponTarget;
  mode: StripeMode;
}): Promise<StripeCouponResolution> {
  const { coupon, target, mode } = input;
  const terms = couponTerms(coupon);
  const { priceAmountCents, currency } = targetPrice(target);
  const quote = quoteDiscount(terms, priceAmountCents);
  const effectiveAmountOff = Math.min(
    coupon.amountOffCents ?? 0,
    coupon.maxDiscountCents ?? Number.POSITIVE_INFINITY,
  );

  const productIds = quote.requiresFixedAmount
    ? [await targetProductId(target, mode)]
    : await couponProductIds({ coupon, mode });

  const shape: StripeCouponShape = quote.requiresFixedAmount
    ? {
        percentOff: null,
        amountOffCents: quote.discountCents,
        currency,
        duration: coupon.duration,
        durationInMonths: coupon.durationInMonths,
        maxRedemptions: coupon.maxRedemptions,
        redeemBySeconds: toStripeTimestamp(coupon.redeemBy),
      }
    : coupon.discountType === "percent"
      ? {
          percentOff: percentFromBasisPoints(coupon.percentBasisPoints ?? 0),
          amountOffCents: null,
          currency: coupon.currency,
          duration: coupon.duration,
          durationInMonths: coupon.durationInMonths,
          maxRedemptions: coupon.maxRedemptions,
          redeemBySeconds: toStripeTimestamp(coupon.redeemBy),
        }
      : {
          percentOff: null,
          // A max on an amount coupon is just a smaller amount coupon. Keep the
          // price floor out of this shape so the same Stripe coupon can cover a
          // $3 and a $30 product while Stripe naturally floors the former at 0.
          amountOffCents: effectiveAmountOff,
          currency: coupon.currency,
          duration: coupon.duration,
          durationInMonths: coupon.durationInMonths,
          maxRedemptions: coupon.maxRedemptions,
          redeemBySeconds: toStripeTimestamp(coupon.redeemBy),
        };

  const id = deriveStripeCouponId({
    applicationId: coupon.applicationId,
    couponId: coupon.id,
    mode,
    shape,
    productIds,
  });

  const name = couponDisplayName(coupon.name, coupon.code);
  const metadata = {
    applicationId: coupon.applicationId,
    couponId: coupon.id,
    code: coupon.code,
    appliesTo: coupon.appliesTo,
    userRestriction: coupon.restrictToUsers ? "allow-list" : "any app user",
    maxRedemptionsPerUser: String(coupon.maxRedemptionsPerUser ?? "unlimited"),
    maximumDiscountCents: String(coupon.maxDiscountCents ?? "none"),
    minimumAmountCents: String(coupon.minimumAmountCents ?? "none"),
    firstTimeOnly: String(coupon.firstTimeOnly),
    startsAt: coupon.startsAt?.toISOString() ?? "immediate",
  };
  const stripeCoupon = await getOrCreateCoupon(mode, id, {
    name,
    ...(shape.percentOff === null
      ? { amount_off: shape.amountOffCents ?? 0, currency: shape.currency }
      : { percent_off: shape.percentOff }),
    duration: shape.duration,
    ...(shape.duration === "repeating"
      ? { duration_in_months: shape.durationInMonths ?? 1 }
      : {}),
    ...(shape.maxRedemptions === null
      ? {}
      : { max_redemptions: shape.maxRedemptions }),
    ...(shape.redeemBySeconds ? { redeem_by: shape.redeemBySeconds } : {}),
    // Empty means "no product restriction", which would let the coupon land on
    // another application's line item. An app with nothing purchasable has no
    // coupon to apply, so callers never reach here with an empty scope.
    ...(productIds.length > 0 ? { applies_to: { products: productIds } } : {}),
    // Restrictions Stripe cannot express on a Coupon are still recorded so
    // the Dashboard explains why the app can refuse an otherwise-valid object.
    metadata,
  });
  if (
    stripeCoupon.name !== name ||
    Object.entries(metadata).some(
      ([key, value]) => stripeCoupon.metadata?.[key] !== value,
    )
  ) {
    await stripe(mode).coupons.update(stripeCoupon.id, { name, metadata });
  }
  const stripeCouponId = stripeCoupon.id;

  if (
    (mode === "sandbox" ? coupon.stripeSandboxCouponId : coupon.stripeCouponId) !==
    stripeCouponId
  ) {
    await db
      .update(coupons)
      .set({ ...stripeCouponColumns(mode, stripeCouponId), updatedAt: new Date() })
      .where(eq(coupons.id, coupon.id));
  }

  return {
    stripeCouponId,
    discountCents: quote.discountCents,
    cappedToFixedAmount: quote.requiresFixedAmount,
  };
}
