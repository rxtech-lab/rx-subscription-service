import type { CouponDiscountType, CouponDuration } from "@/lib/db/schema";

/**
 * What a coupon is worth and who may spend it, decided without touching the
 * database or Stripe.
 *
 * The console preview, the `/api/v1/coupons/validate` response, and the discount
 * actually sent to Checkout all come through here, so a code can never quote one
 * number and charge another. Deliberately free of `server-only` and of any
 * import that reaches a client, so the arithmetic is unit-testable on its own.
 */

/** Codes are typed by hand and read aloud, so the alphabet stays narrow. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;

export class CouponCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Upper-cases and validates a code. Lookups compare the normalized form. */
export function normalizeCouponCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new CouponCodeError(
      "code must be 3-64 characters: letters, digits, - or _, starting with a letter or digit",
    );
  }
  return code;
}

export interface CouponTerms {
  discountType: CouponDiscountType;
  percentBasisPoints: number | null;
  amountOffCents: number | null;
  maxDiscountCents: number | null;
  currency: string;
  duration: CouponDuration;
  durationInMonths: number | null;
}

export interface DiscountQuote {
  /** What the first charge is reduced by, after the cap and the price floor. */
  discountCents: number;
  /** True when `maxDiscountCents` — not the percentage — decided the amount. */
  capped: boolean;
  /**
   * True when the discount must be sent to Stripe as a flat `amount_off`.
   *
   * Stripe has no ceiling on a percentage, so a capped percentage is only
   * expressible as the equivalent fixed amount for the price being bought.
   */
  requiresFixedAmount: boolean;
}

/**
 * The discount one charge receives.
 *
 * Percentages round half-up to whole cents, matching Stripe. Nothing is ever
 * discounted below zero: an amount coupon larger than the price simply makes the
 * charge free, exactly as Stripe would settle it.
 */
export function quoteDiscount(
  terms: CouponTerms,
  priceAmountCents: number,
): DiscountQuote {
  const price = Math.max(0, Math.trunc(priceAmountCents));

  if (terms.discountType === "amount") {
    const requested = Math.max(0, terms.amountOffCents ?? 0);
    const capped = terms.maxDiscountCents !== null && requested > terms.maxDiscountCents;
    const allowed = capped ? terms.maxDiscountCents! : requested;
    return {
      discountCents: Math.min(allowed, price),
      capped,
      requiresFixedAmount: false,
    };
  }

  const basisPoints = Math.max(0, terms.percentBasisPoints ?? 0);
  const uncapped = Math.round((price * basisPoints) / 10_000);
  const capped = terms.maxDiscountCents !== null && uncapped > terms.maxDiscountCents;
  const discountCents = Math.min(capped ? terms.maxDiscountCents! : uncapped, price);
  return { discountCents, capped, requiresFixedAmount: capped };
}

/** Human-readable terms — "25.5% off for 3 months, up to $10.00". */
export function describeCoupon(terms: CouponTerms): string {
  const value =
    terms.discountType === "percent"
      ? `${formatBasisPoints(terms.percentBasisPoints ?? 0)}% off`
      : `${formatMinor(terms.amountOffCents ?? 0)} ${terms.currency.toUpperCase()} off`;

  const duration =
    terms.duration === "forever"
      ? "every charge"
      : terms.duration === "repeating"
        ? `the first ${terms.durationInMonths ?? 1} month${(terms.durationInMonths ?? 1) === 1 ? "" : "s"}`
        : "the first charge";

  const cap =
    terms.maxDiscountCents === null
      ? ""
      : `, up to ${formatMinor(terms.maxDiscountCents)} ${terms.currency.toUpperCase()}`;

  return `${value} on ${duration}${cap}`;
}

function formatBasisPoints(basisPoints: number): string {
  const percent = basisPoints / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0$/, "");
}

function formatMinor(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const COUPON_BLOCKERS = [
  "not_active",
  "not_started",
  "expired",
  "fully_redeemed",
  "user_limit_reached",
  "user_not_allowed",
  "not_applicable",
  "below_minimum",
  "not_first_purchase",
  "currency_mismatch",
] as const;
export type CouponBlocker = (typeof COUPON_BLOCKERS)[number];

export interface RedemptionContext {
  status: "draft" | "active" | "archived";
  startsAt: Date | null;
  redeemBy: Date | null;
  maxRedemptions: number | null;
  maxRedemptionsPerUser: number | null;
  minimumAmountCents: number | null;
  firstTimeOnly: boolean;
  /** Reserved plus redeemed. A reservation holds a use until it settles. */
  redemptionsUsed: number;
  redemptionsUsedByUser: number;
  /** False only when an allow-list exists and this user is not on it. */
  userAllowed: boolean;
  /** False when the coupon does not cover the plan or topup being bought. */
  appliesToTarget: boolean;
  /** Whether the user has ever completed a payment in this application. */
  hasPriorPurchase: boolean;
  priceAmountCents: number;
  targetCurrency: string;
  now: Date;
}

/**
 * Every reason this coupon cannot be redeemed right now, in the order a person
 * would want to hear them. An empty array means it applies.
 */
export function couponBlockers(
  terms: CouponTerms,
  context: RedemptionContext,
): CouponBlocker[] {
  const blockers: CouponBlocker[] = [];

  if (context.status !== "active") blockers.push("not_active");
  if (context.startsAt && context.now < context.startsAt) blockers.push("not_started");
  if (context.redeemBy && context.now > context.redeemBy) blockers.push("expired");

  if (
    context.maxRedemptions !== null &&
    context.redemptionsUsed >= context.maxRedemptions
  ) {
    blockers.push("fully_redeemed");
  }
  if (
    context.maxRedemptionsPerUser !== null &&
    context.redemptionsUsedByUser >= context.maxRedemptionsPerUser
  ) {
    blockers.push("user_limit_reached");
  }
  if (!context.userAllowed) blockers.push("user_not_allowed");
  if (!context.appliesToTarget) blockers.push("not_applicable");

  if (
    context.minimumAmountCents !== null &&
    context.priceAmountCents < context.minimumAmountCents
  ) {
    blockers.push("below_minimum");
  }
  if (context.firstTimeOnly && context.hasPriorPurchase) {
    blockers.push("not_first_purchase");
  }

  // Every money-denominated restriction uses the coupon's currency. Applying a
  // $10 discount, cap, or minimum to a euro price would compare the wrong minor
  // units even when the underlying discount itself is a percentage.
  if (
    (terms.discountType === "amount" ||
      terms.maxDiscountCents !== null ||
      context.minimumAmountCents !== null) &&
    terms.currency.toLowerCase() !== context.targetCurrency.toLowerCase()
  ) {
    blockers.push("currency_mismatch");
  }

  return blockers;
}

/** What the buyer is told when a code will not apply. */
export function explainBlocker(blocker: CouponBlocker): string {
  switch (blocker) {
    case "not_active":
      return "This code is not available.";
    case "not_started":
      return "This code is not active yet.";
    case "expired":
      return "This code has expired.";
    case "fully_redeemed":
      return "This code has been fully redeemed.";
    case "user_limit_reached":
      return "You have already used this code the maximum number of times.";
    case "user_not_allowed":
      return "This code is not available for your account.";
    case "not_applicable":
      return "This code does not apply to this item.";
    case "below_minimum":
      return "This order is below the minimum for this code.";
    case "not_first_purchase":
      return "This code is only for a first purchase.";
    case "currency_mismatch":
      return "This code cannot be used in this currency.";
  }
}
