import "server-only";
import type Stripe from "stripe";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchases, stripeCustomers, type AppUser } from "@/lib/db/schema";
import { newId, ValidationError } from "@/lib/subscription/shared";
import { requirePlan } from "@/lib/subscription/plans";
import { checkTopupEligibility, requireTopupProduct } from "@/lib/subscription/topups";
import { getActiveSubscriptionForPlan } from "@/lib/subscription/subscriptions";
import {
  attachRedemptionSession,
  attachRedemptionStripeCoupon,
  releaseRedemption,
  reserveRedemption,
  type CouponTarget,
} from "@/lib/subscription/coupons";
import {
  assertSubscriptionMatchesSession,
  completedSubscriptionFromSession,
} from "./admin-checkout";
import {
  automaticTax,
  modeForUser,
  referenceId,
  siteUrl,
  stripe,
  type StripeMode,
} from "./client";
import { resolveStripeCoupon } from "./coupons";
import { ensurePlanPrice, ensureTopupPrice } from "./products";
import {
  fulfillPaidPurchase,
  holdCouponRedemption,
  settleCouponRedemption,
  syncSubscriptionFromStripe,
} from "./webhook";

export class NotEligibleError extends Error {
  constructor(readonly failed: unknown[]) {
    super("Not eligible to purchase this topup");
    this.name = "NotEligibleError";
  }
}

interface AppliedCoupon {
  redemptionId: string;
  couponId: string;
  code: string;
  stripeCouponId: string;
  discountCents: number;
}

/**
 * Validate a code, mint the Stripe Coupon it resolves to, and take a use of it.
 *
 * Every restriction Stripe cannot express on a coupon — an allow-list of users,
 * a per-user limit, a minimum order, first-purchase-only, and the ceiling on a
 * percentage — is decided here against our own rows, immediately before the
 * session is created. The reservation is what makes a limited code safe under
 * concurrency: it is released below if Stripe then refuses the session.
 */
async function applyCoupon(input: {
  applicationId: string;
  user: AppUser;
  target: CouponTarget;
  code: string;
  mode: StripeMode;
}): Promise<AppliedCoupon> {
  const reserved = await reserveRedemption({
    applicationId: input.applicationId,
    appUserId: input.user.id,
    target: input.target,
    code: input.code,
  });

  try {
    const resolved = await resolveStripeCoupon({
      coupon: reserved.coupon,
      target: input.target,
      mode: input.mode,
    });
    await attachRedemptionStripeCoupon({
      redemptionId: reserved.redemption.id,
      stripeCouponId: resolved.stripeCouponId,
    });

    return {
      redemptionId: reserved.redemption.id,
      couponId: reserved.coupon.id,
      code: reserved.coupon.code,
      stripeCouponId: resolved.stripeCouponId,
      discountCents: resolved.discountCents,
    };
  } catch (error) {
    await releaseRedemption(reserved.redemption.id);
    throw error;
  }
}

/**
 * One Stripe Customer per (application, user), created on first purchase.
 *
 * No mode column is needed: a test user always transacts in the sandbox and a
 * real user always in live, so the row is unambiguous for the user it belongs to.
 */
async function customerFor(user: AppUser, mode: StripeMode): Promise<string> {
  const [existing] = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.appUserId, user.id))
    .limit(1);

  const email = user.email?.trim() || undefined;
  if (existing) {
    if (email) {
      await stripe(mode).customers.update(existing.stripeCustomerId, { email });
    }
    return existing.stripeCustomerId;
  }

  const customer = await stripe(mode).customers.create(
    {
      email,
      name: user.displayName ?? undefined,
      metadata: {
        applicationId: user.applicationId,
        appUserId: user.id,
        rxlabUserId: user.rxlabUserId,
      },
    },
    { idempotencyKey: `customer:${user.id}` },
  );

  await db
    .insert(stripeCustomers)
    .values({
      id: newId(),
      appUserId: user.id,
      stripeCustomerId: customer.id,
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  return customer.id;
}

/**
 * The discount half of a Checkout Session.
 *
 * Stripe's own `allow_promotion_codes` box is deliberately not enabled: a
 * promotion code belongs to the Stripe *account*, which every application here
 * shares, so the box would let one app's buyer redeem another app's code. Codes
 * are collected by the calling app instead and resolved through `applyCoupon`,
 * which only ever looks in that application's coupons.
 */
function discountParams(coupon: AppliedCoupon | null) {
  return coupon ? { discounts: [{ coupon: coupon.stripeCouponId }] } : {};
}

/**
 * A Checkout Session that never reached the caller must not remain payable.
 * Once Stripe has created it, expire it before marking the purchase failed or
 * releasing a coupon hold. If expiry fails, retaining both pending records is
 * safer: the webhook can still fulfill a session that completed concurrently.
 */
async function abandonCheckout(
  mode: StripeMode,
  coupon: AppliedCoupon | null,
  session: Stripe.Checkout.Session | null,
): Promise<boolean> {
  if (session) {
    try {
      await stripe(mode).checkout.sessions.expire(session.id);
    } catch (error) {
      console.error(`Could not expire coupon checkout ${session.id}:`, error);
      return false;
    }
  }
  if (coupon) await releaseRedemption(coupon.redemptionId);
  return true;
}

function redirectUrls(input: { successUrl?: string; cancelUrl?: string }) {
  const origin = siteUrl();
  return {
    success_url:
      input.successUrl ?? `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl ?? `${origin}/checkout/cancelled`,
  };
}

export async function createPlanCheckout(input: {
  applicationId: string;
  user: AppUser;
  planId: string;
  /** A discount code from this application. Codes never cross applications. */
  couponCode?: string | null;
  successUrl?: string;
  cancelUrl?: string;
  /** Defaults to the account the user belongs to; sandbox for test users. */
  mode?: StripeMode;
}) {
  const mode = input.mode ?? modeForUser(input.user);
  const plan = await requirePlan(input.applicationId, input.planId);
  if (plan.status !== "active") {
    throw new ValidationError("plan is not available for purchase");
  }

  const existing = await getActiveSubscriptionForPlan({
    appUserId: input.user.id,
    planId: plan.id,
  });
  if (existing) throw new ValidationError("user already subscribes to this plan");

  const priceId = await ensurePlanPrice(plan, mode);
  const customer = await customerFor(input.user, mode);
  const recurring = plan.billingInterval !== "one_time";
  const coupon = input.couponCode?.trim()
    ? await applyCoupon({
        applicationId: input.applicationId,
        user: input.user,
        target: { kind: "plan", plan },
        code: input.couponCode,
        mode,
      })
    : null;

  // A one-time plan is a payment, so it needs a purchase row to fulfill against;
  // recurring plans are reconciled from `customer.subscription.*` events instead.
  const purchaseId = recurring ? null : newId();
  const metadata: Record<string, string> = {
    applicationId: input.applicationId,
    appUserId: input.user.id,
    planId: plan.id,
    kind: recurring ? "plan_subscription" : "plan_one_time",
    ...(purchaseId ? { purchaseId } : {}),
    ...(coupon
      ? {
          couponId: coupon.couponId,
          couponCode: coupon.code,
          couponRedemptionId: coupon.redemptionId,
        }
      : {}),
  };

  let session: Stripe.Checkout.Session | null = null;
  try {
    if (purchaseId) {
      await db.insert(purchases).values({
        id: purchaseId,
        applicationId: input.applicationId,
        appUserId: input.user.id,
        kind: "plan_one_time",
        planId: plan.id,
        amountCents: plan.priceAmountCents,
        currency: plan.currency,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    session = await stripe(mode).checkout.sessions.create(
      {
        mode: recurring ? "subscription" : "payment",
        customer,
        client_reference_id: purchaseId ?? input.user.id,
        line_items: [{ price: priceId, quantity: 1 }],
        ...discountParams(coupon),
        automatic_tax: { enabled: automaticTax() },
        metadata,
        ...(recurring
          ? {
              subscription_data: {
                metadata,
                ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
              },
            }
          : {
              invoice_creation: { enabled: true, invoice_data: { metadata } },
              payment_intent_data: { metadata },
            }),
        ...redirectUrls(input),
      },
      {
        idempotencyKey: `plan-checkout:${
          purchaseId ?? `${input.user.id}:${plan.id}`
        }${coupon ? `:${coupon.redemptionId}` : ""}`,
      },
    );
    if (!session.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");
    if (purchaseId) {
      await db
        .update(purchases)
        .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
        .where(eq(purchases.id, purchaseId));
    }
    if (coupon) {
      await attachRedemptionSession({
        redemptionId: coupon.redemptionId,
        stripeCheckoutSessionId: session.id,
        purchaseId,
      });
    }

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      purchaseId,
      discount: coupon
        ? { code: coupon.code, discountCents: coupon.discountCents }
        : null,
    };
  } catch (error) {
    const abandoned = await abandonCheckout(mode, coupon, session);
    if (purchaseId && abandoned) {
      await db
        .update(purchases)
        .set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(purchases.id, purchaseId), eq(purchases.status, "pending")));
    }
    throw error;
  }
}

export async function createTopupCheckout(input: {
  applicationId: string;
  user: AppUser;
  topupId: string;
  /** A discount code from this application. Codes never cross applications. */
  couponCode?: string | null;
  successUrl?: string;
  cancelUrl?: string;
  /** Defaults to the account the user belongs to; sandbox for test users. */
  mode?: StripeMode;
}) {
  const mode = input.mode ?? modeForUser(input.user);
  const product = await requireTopupProduct(input.applicationId, input.topupId);
  if (product.status !== "active") {
    throw new ValidationError("topup is not available for purchase");
  }

  // Gate check #1. The webhook repeats it at fulfillment, so a plan that lapses
  // between here and payment cannot be used to claim a plan-gated pack.
  const eligibility = await checkTopupEligibility({
    applicationId: input.applicationId,
    topupId: product.id,
    appUserId: input.user.id,
  });
  if (!eligibility.eligible) throw new NotEligibleError(eligibility.failed);

  if (product.maxPurchasesPerUser !== null) {
    const prior = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.appUserId, input.user.id),
          eq(purchases.topupProductId, product.id),
          inArray(purchases.status, ["paid", "pending"]),
        ),
      );
    if (prior.length >= product.maxPurchasesPerUser) {
      throw new ValidationError("purchase limit reached for this topup");
    }
  }

  const priceId = await ensureTopupPrice(product, mode);
  const customer = await customerFor(input.user, mode);
  const coupon = input.couponCode?.trim()
    ? await applyCoupon({
        applicationId: input.applicationId,
        user: input.user,
        target: { kind: "topup", product },
        code: input.couponCode,
        mode,
      })
    : null;
  const purchaseId = newId();

  const metadata = {
    applicationId: input.applicationId,
    appUserId: input.user.id,
    topupProductId: product.id,
    purchaseId,
    kind: "topup",
    ...(coupon
      ? {
          couponId: coupon.couponId,
          couponCode: coupon.code,
          couponRedemptionId: coupon.redemptionId,
        }
      : {}),
  };

  let session: Stripe.Checkout.Session | null = null;
  try {
    await db.insert(purchases).values({
      id: purchaseId,
      applicationId: input.applicationId,
      appUserId: input.user.id,
      kind: "topup",
      topupProductId: product.id,
      unitId: product.unitId,
      unitsGranted: 0,
      amountCents: product.priceAmountCents,
      currency: product.currency,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    session = await stripe(mode).checkout.sessions.create(
      {
        mode: "payment",
        customer,
        client_reference_id: purchaseId,
        line_items: [{ price: priceId, quantity: 1 }],
        ...discountParams(coupon),
        automatic_tax: { enabled: automaticTax() },
        invoice_creation: { enabled: true, invoice_data: { metadata } },
        payment_intent_data: { metadata },
        metadata,
        ...redirectUrls(input),
      },
      { idempotencyKey: `topup-checkout:${purchaseId}` },
    );
    if (!session.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");
    await db
      .update(purchases)
      .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
      .where(eq(purchases.id, purchaseId));
    if (coupon) {
      await attachRedemptionSession({
        redemptionId: coupon.redemptionId,
        stripeCheckoutSessionId: session.id,
        purchaseId,
      });
    }

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      purchaseId,
      discount: coupon
        ? { code: coupon.code, discountCents: coupon.discountCents }
        : null,
    };
  } catch (error) {
    const abandoned = await abandonCheckout(mode, coupon, session);
    if (abandoned) {
      await db
        .update(purchases)
        .set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(purchases.id, purchaseId), eq(purchases.status, "pending")));
    }
    throw error;
  }
}

/** Stripe-hosted portal for cancelling and updating payment methods. */
export async function createBillingPortalSession(input: {
  user: AppUser;
  returnUrl?: string;
  mode?: StripeMode;
}) {
  const [customer] = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.appUserId, input.user.id))
    .limit(1);
  if (!customer) throw new ValidationError("user has no billing account yet");

  const mode = input.mode ?? modeForUser(input.user);
  const session = await stripe(mode).billingPortal.sessions.create({
    customer: customer.stripeCustomerId,
    return_url: input.returnUrl ?? siteUrl(),
  });
  return { url: session.url };
}

/**
 * Verify an admin Checkout return with Stripe and persist its authoritative
 * subscription state. The webhook uses the same sync function, so either path
 * can arrive first without creating duplicate local subscriptions or grants.
 */
export async function reconcilePlanCheckoutSession(input: {
  applicationId: string;
  sessionId: string;
  mode?: StripeMode;
}) {
  const mode = input.mode ?? "live";
  const session = await stripe(mode).checkout.sessions.retrieve(input.sessionId, {
    expand: ["subscription"],
  });
  const subscriptionRef = completedSubscriptionFromSession(
    session,
    input.applicationId,
  );
  const subscription =
    typeof subscriptionRef === "string"
      ? await stripe(mode).subscriptions.retrieve(subscriptionRef)
      : subscriptionRef;
  assertSubscriptionMatchesSession(session, subscription);
  const synced = await syncSubscriptionFromStripe(subscription);
  if (!synced) throw new Error("STRIPE_SUBSCRIPTION_METADATA_MISSING");
  if (!(await settleCouponRedemption(session))) {
    await holdCouponRedemption(session);
  }
  return { sessionId: session.id, subscriptionId: subscription.id };
}

/**
 * The topup equivalent of the above: verify a returning Checkout session with
 * Stripe and fulfill the purchase. The webhook performs the same fulfillment, so
 * whichever arrives first wins and the other is a no-op — `fulfillPaidTopup` is
 * keyed on the purchase row's status and the ledger's idempotency key.
 */
export async function reconcileTopupCheckoutSession(input: {
  applicationId: string;
  sessionId: string;
  mode?: StripeMode;
}) {
  const mode = input.mode ?? "live";
  const session = await stripe(mode).checkout.sessions.retrieve(input.sessionId);

  if (session.metadata?.applicationId !== input.applicationId) {
    throw new ValidationError("checkout session belongs to another application");
  }
  if (session.metadata?.kind !== "topup") {
    throw new ValidationError("checkout session is not a topup purchase");
  }
  // An async payment method can leave the session complete but unpaid. That is
  // not a failure — the webhook settles it once the funds clear.
  if (session.status !== "complete" || session.payment_status === "unpaid") {
    await holdCouponRedemption(session);
    return { sessionId: session.id, status: "pending" as const };
  }

  const purchaseId = session.metadata?.purchaseId ?? session.client_reference_id;
  if (!purchaseId) throw new Error("STRIPE_PURCHASE_METADATA_MISSING");

  // `false` here means the webhook already settled it, which is still success.
  await fulfillPaidPurchase({
    purchaseId,
    stripePaymentIntentId: referenceId(session.payment_intent),
    stripeInvoiceId: referenceId(session.invoice),
    mode,
  });
  await settleCouponRedemption(session);
  return { sessionId: session.id, status: "settled" as const };
}
