import { createHash } from "node:crypto";
import type { StripeMode } from "./accounts";

/**
 * How a coupon is pinned to one application inside a shared Stripe account.
 *
 * Stripe coupons belong to an account, so nothing about a Stripe Coupon says
 * which of our applications minted it. Two things fix that, and both are decided
 * here: the coupon carries `applies_to.products` listing only this application's
 * Products, so Stripe itself refuses to discount another app's line item; and
 * its id is derived from those Products plus its terms, so a changed catalogue
 * or a changed discount deterministically resolves to a different Stripe Coupon
 * instead of quietly reusing a stale one.
 *
 * Stripe coupons are immutable apart from `name` and `metadata` — there is no
 * way to edit `applies_to` — which is why re-minting under a new derived id is
 * the only correct response to a scope change. Discounts already attached to a
 * subscription keep billing on the coupon they were created with, exactly as
 * plan prices do.
 *
 * Deliberately free of `server-only`, of the SDK, and of the database, so the
 * scoping rules are unit-testable on their own.
 */

/** The Stripe-facing shape of a discount, once our own rules have been applied. */
export interface StripeCouponShape {
  /** Stripe's float percentage: 25.5 for 25.5% off. Null for amount coupons. */
  percentOff: number | null;
  /** Minor units. Set when the coupon is fixed-amount, or when a cap bound. */
  amountOffCents: number | null;
  currency: string;
  duration: "once" | "repeating" | "forever";
  durationInMonths: number | null;
  maxRedemptions: number | null;
  redeemBySeconds: number | null;
}

/** Basis points to the float Stripe wants: 2550 → 25.5. */
export function percentFromBasisPoints(basisPoints: number): number {
  return Math.round(basisPoints) / 100;
}

/** Seconds since the epoch, or null. Stripe timestamps are integer seconds. */
export function toStripeTimestamp(value: Date | null): number | null {
  return value ? Math.floor(value.getTime() / 1000) : null;
}

/** Order-independent: reordering the catalogue must not re-mint the coupon. */
export function scopeFingerprint(productIds: readonly string[]): string {
  return [...new Set(productIds)].sort().join(",");
}

/**
 * The Stripe Coupon id for a set of terms and a scope.
 *
 * Derived rather than stored, so "get or create" is idempotent forever — unlike
 * an idempotency key, which Stripe forgets after 24 hours and which would then
 * mint a duplicate coupon on the next checkout.
 */
export function deriveStripeCouponId(input: {
  applicationId: string;
  couponId: string;
  mode: StripeMode;
  shape: StripeCouponShape;
  productIds: readonly string[];
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.applicationId,
        input.couponId,
        input.mode,
        input.shape.percentOff ?? "",
        input.shape.amountOffCents ?? "",
        input.shape.currency,
        input.shape.duration,
        input.shape.durationInMonths ?? "",
        input.shape.maxRedemptions ?? "",
        input.shape.redeemBySeconds ?? "",
        scopeFingerprint(input.productIds),
      ].join("|"),
    )
    .digest("hex");
  // Stripe accepts any unique string; a fixed-width hex tail keeps ids legible
  // in the dashboard and safely under every id length limit.
  return `rxc_${digest.slice(0, 32)}`;
}

/** Stripe truncates nothing for us: coupon names are capped at 40 characters. */
export function couponDisplayName(name: string, code: string): string {
  const candidate = `${code} — ${name}`.trim();
  return candidate.length <= 40 ? candidate : candidate.slice(0, 39).trimEnd() + "…";
}
