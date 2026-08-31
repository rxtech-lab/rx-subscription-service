import "server-only";
import type Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  ledgerEntries,
  purchases,
  stripeWebhookEvents,
  topupProducts,
  type SubscriptionStatus,
} from "@/lib/db/schema";
import {
  markRedemptionProcessing,
  markRedemptionPaid,
  recordPromotionCodeRedemption,
  releaseRedemptionBySession,
} from "@/lib/subscription/coupons";
import { checkTopupEligibility } from "@/lib/subscription/topups";
import {
  buildEntitlementSnapshot,
  grantPeriodBalances,
  upsertSubscriptionFromStripe,
} from "@/lib/subscription/subscriptions";
import {
  creditBalance,
  debitBalanceAllowingNegative,
} from "@/lib/subscription/users";
import { scheduleTrialWatch } from "@/lib/workflows/schedule";
import { referenceId, stripe, webhookSecretFor, type StripeMode } from "./client";

/** A claim older than this is treated as a crashed attempt and retried. */
const STALE_EVENT_MS = 15 * 60_000;

/**
 * Claim an event id. Returns false when another delivery already owns it, which
 * is what makes the whole handler safe to replay — Stripe retries aggressively.
 */
async function beginEvent(input: {
  id: string;
  type: string;
  objectId: string | null;
}): Promise<boolean> {
  const now = new Date();
  const inserted = await db
    .insert(stripeWebhookEvents)
    .values({
      id: input.id,
      type: input.type,
      status: "processing",
      objectId: input.objectId,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return true;

  const reclaimed = await db
    .update(stripeWebhookEvents)
    .set({ status: "processing", createdAt: now })
    .where(
      and(
        eq(stripeWebhookEvents.id, input.id),
        eq(stripeWebhookEvents.status, "processing"),
        sql`${stripeWebhookEvents.createdAt} < ${new Date(now.getTime() - STALE_EVENT_MS)}`,
      ),
    )
    .returning();
  return reclaimed.length > 0;
}

async function finishEvent(
  id: string,
  status: "processed" | "ignored" | "failed",
  failureCode?: string | null,
) {
  await db
    .update(stripeWebhookEvents)
    .set({ status, failureCode: failureCode ?? null, processedAt: new Date() })
    .where(eq(stripeWebhookEvents.id, id));
}

function objectIdOf(value: Stripe.Event.Data.Object): string | null {
  return "id" in value && typeof value.id === "string" ? value.id : null;
}

/** Map Stripe's subscription status onto ours. */
function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    default:
      return "expired";
  }
}

function toDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/**
 * Grant the units a paid topup buys.
 *
 * Eligibility is re-checked here rather than trusted from checkout time: the
 * subscription that unlocked a gated pack may have been cancelled while the
 * payment was in flight. The purchase is still marked paid — the money was
 * taken — but it is flagged for review instead of silently granting.
 */
async function fulfillTopup(purchase: typeof purchases.$inferSelect) {
  const [product] = await db
    .select()
    .from(topupProducts)
    .where(eq(topupProducts.id, purchase.topupProductId!))
    .limit(1);
  if (!product) throw new Error(`TOPUP_PRODUCT_MISSING:${purchase.topupProductId}`);

  const eligibility = await checkTopupEligibility({
    applicationId: purchase.applicationId,
    topupId: product.id,
    appUserId: purchase.appUserId,
  });

  if (!eligibility.eligible) {
    await db
      .update(purchases)
      .set({
        status: "paid",
        paidAt: new Date(),
        unitsGranted: 0,
        fulfillmentFailureCode: "topup_not_eligible",
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, purchase.id));
    throw new Error(`TOPUP_INELIGIBLE_AT_FULFILLMENT:${purchase.id}`);
  }

  await creditBalance({
    appUserId: purchase.appUserId,
    unitId: product.unitId,
    amount: product.amount,
    kind: "topup",
    description: `Topup — ${product.name}`,
    idempotencyKey: `topup:${purchase.id}`,
    referenceType: "purchase",
    referenceId: purchase.id,
  });

  await db
    .update(purchases)
    .set({
      status: "paid",
      unitsGranted: product.amount,
      unitId: product.unitId,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(purchases.id, purchase.id));
}

async function purchaseFor(session: Stripe.Checkout.Session) {
  const purchaseId = session.metadata?.purchaseId ?? session.client_reference_id;
  if (!purchaseId) return null;
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .limit(1);
  return purchase ?? null;
}

/**
 * Turn a checkout's reserved coupon use into a spent one.
 *
 * Shared with the storefront's return page, so a run without a webhook tunnel
 * still settles the redemption. Conditional on the row still being a live hold,
 * which is what keeps the two paths — and Stripe's retries — from counting the
 * same use twice. The amount is taken from what Stripe actually discounted
 * rather than from our quote, so a rounding difference is recorded honestly.
 */
async function promotionCodeForSession(
  session: Stripe.Checkout.Session,
  mode: StripeMode,
): Promise<Stripe.PromotionCode | null> {
  const reference = session.discounts?.find((discount) => discount.promotion_code)
    ?.promotion_code;
  if (!reference) return null;
  return typeof reference === "string"
    ? stripe(mode).promotionCodes.retrieve(reference)
    : reference;
}

async function recordHostedPromotionCode(
  session: Stripe.Checkout.Session,
  mode: StripeMode,
  status: "processing" | "redeemed",
): Promise<boolean> {
  const promotionCode = await promotionCodeForSession(session, mode);
  const metadata = promotionCode?.metadata;
  if (
    !promotionCode ||
    !metadata?.couponId ||
    metadata.applicationId !== session.metadata?.applicationId ||
    metadata.appUserId !== session.metadata?.appUserId
  ) {
    return false;
  }
  const coupon = promotionCode.promotion.coupon;
  const stripeCouponId = typeof coupon === "string" ? coupon : (coupon?.id ?? null);
  return recordPromotionCodeRedemption({
    couponId: metadata.couponId,
    applicationId: metadata.applicationId,
    appUserId: metadata.appUserId,
    stripeCheckoutSessionId: session.id,
    stripeCouponId,
    purchaseId: session.metadata?.purchaseId ?? null,
    planId: session.metadata?.planId ?? null,
    topupProductId: session.metadata?.topupProductId ?? null,
    discountCents: session.total_details?.amount_discount ?? 0,
    currency: session.currency ?? "usd",
    status,
  });
}

export async function settleCouponRedemption(
  session: Stripe.Checkout.Session,
  mode: StripeMode = "live",
): Promise<boolean> {
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return false;
  }
  if (!session.metadata?.couponId) {
    return recordHostedPromotionCode(session, mode, "redeemed");
  }
  return markRedemptionPaid({
    stripeCheckoutSessionId: session.id,
    redemptionId: session.metadata.couponRedemptionId,
    discountCents: session.total_details?.amount_discount ?? null,
  });
}

/** A completed delayed payment keeps consuming its reserved coupon use. */
export async function holdCouponRedemption(
  session: Stripe.Checkout.Session,
  mode: StripeMode = "live",
): Promise<boolean> {
  if (
    session.status !== "complete" ||
    session.payment_status !== "unpaid"
  ) {
    return false;
  }
  if (!session.metadata?.couponId) {
    return recordHostedPromotionCode(session, mode, "processing");
  }
  return markRedemptionProcessing({
    stripeCheckoutSessionId: session.id,
    redemptionId: session.metadata.couponRedemptionId,
  });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  mode: StripeMode,
) {
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return holdCouponRedemption(session, mode);
  }

  // Subscriptions are reconciled from `customer.subscription.*`, which carries
  // the authoritative period boundaries — but the coupon use belongs to the
  // session, which only this event carries.
  if (session.mode === "subscription") return settleCouponRedemption(session, mode);

  const purchaseId = session.metadata?.purchaseId ?? session.client_reference_id;
  if (!purchaseId) return settleCouponRedemption(session, mode);

  const fulfilled = await fulfillPaidPurchase({
    purchaseId,
    stripePaymentIntentId: referenceId(session.payment_intent),
    stripeInvoiceId: referenceId(session.invoice),
    mode,
  });
  const redeemed = await settleCouponRedemption(session, mode);
  return fulfilled || redeemed;
}

/**
 * Settle a paid one-time purchase — topup or one-time plan.
 *
 * Shared by the webhook and by the storefront's return-from-Checkout page, so a
 * local run without a webhook tunnel still fulfills. Whichever arrives first
 * wins: the purchase row's `status` guards re-entry and every credit carries an
 * idempotency key, so the loser is a no-op rather than a double grant.
 */
export async function fulfillPaidPurchase(input: {
  purchaseId: string;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  mode: StripeMode;
}): Promise<boolean> {
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.id, input.purchaseId))
    .limit(1);
  if (!purchase || purchase.status === "paid") return false;

  const invoice = input.stripeInvoiceId
    ? await stripe(input.mode).invoices.retrieve(input.stripeInvoiceId)
    : null;

  await db
    .update(purchases)
    .set({
      billingProvider: "stripe",
      providerTransactionId:
        input.stripePaymentIntentId ?? purchase.stripeCheckoutSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeInvoiceId: invoice?.id ?? null,
      hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null,
      invoicePdfUrl: invoice?.invoice_pdf ?? null,
      updatedAt: new Date(),
    })
    .where(eq(purchases.id, purchase.id));

  if (purchase.kind === "topup") {
    await fulfillTopup({ ...purchase, status: "pending" });
    return true;
  }

  // One-time plan: mark paid and hand out its balance grants once.
  const entitlementSnapshot = purchase.planId
    ? await buildEntitlementSnapshot(purchase.planId)
    : null;
  await db
    .update(purchases)
    .set({
      status: "paid",
      paidAt: new Date(),
      entitlementSnapshot,
      updatedAt: new Date(),
    })
    .where(eq(purchases.id, purchase.id));

  if (purchase.planId) {
    await grantPeriodBalances({
      applicationId: purchase.applicationId,
      appUserId: purchase.appUserId,
      planId: purchase.planId,
      periodKey: `one_time:${purchase.id}`,
      entitlements: (entitlementSnapshot?.entitlements ?? []) as never[],
      idempotencyPrefix: "stripe_one_time_grant",
      referenceType: "purchase",
      referenceId: purchase.id,
    });
  }
  return true;
}

export async function syncSubscriptionFromStripe(subscription: Stripe.Subscription) {
  const metadata = subscription.metadata ?? {};
  const applicationId = metadata.applicationId;
  const appUserId = metadata.appUserId;
  const planId = metadata.planId;
  if (!applicationId || !appUserId || !planId) return false;

  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, appUserId))
    .limit(1);
  if (!user) return false;

  const item = subscription.items?.data?.[0];
  const currentPeriodStart = toDate(
    item?.current_period_start ?? subscription.start_date,
  );
  const currentPeriodEnd = toDate(item?.current_period_end);
  const status = mapStatus(subscription.status);

  const { subscription: row } = await upsertSubscriptionFromStripe({
    applicationId,
    appUserId,
    planId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: referenceId(subscription.customer),
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    providerProductId: item?.price?.id ?? null,
  });

  // Balance grants ride on the period, keyed so a replay cannot double-grant.
  if ((status === "active" || status === "trialing") && currentPeriodStart) {
    await grantPeriodBalances({
      applicationId,
      appUserId,
      planId,
      periodKey: String(currentPeriodStart.getTime()),
      periodEnd: currentPeriodEnd,
      subscriptionId: row.id,
      status,
    });
  }

  // A trial that Stripe has just opened gets a job that waits it out, so the
  // switch to paid allowances does not depend on a single webhook arriving.
  // `trial_end` is authoritative; the item period only coincides with it.
  const trialEndsAt = toDate(subscription.trial_end) ?? currentPeriodEnd;
  if (status === "trialing" && trialEndsAt) {
    await scheduleTrialWatch({ subscriptionId: row.id, trialEndsAt });
  }
  return true;
}

/**
 * Claw back granted units when a payment is refunded or disputed, in proportion
 * to how much of the charge was reversed.
 */
async function reverseTopup(input: {
  paymentIntentId: string;
  refundedAmountCents: number;
  kind: "refund" | "dispute" | "dispute_reversal";
  eventId: string;
}) {
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.stripePaymentIntentId, input.paymentIntentId))
    .limit(1);
  if (!purchase) return false;

  const targetRefundedAmount =
    input.kind === "dispute_reversal"
      ? 0
      : Math.min(purchase.amountCents, input.refundedAmountCents);
  const deltaRefundedAmount = targetRefundedAmount - purchase.refundedAmountCents;
  if (deltaRefundedAmount === 0 && purchase.status !== "paid") return false;

  const grants = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.referenceType, "purchase"),
        eq(ledgerEntries.referenceId, purchase.id),
      ),
    );
  let reversedUnits = 0;
  for (const grant of grants.filter((entry) => entry.delta > 0)) {
    const amount = Math.floor(
      (grant.delta * Math.abs(deltaRefundedAmount)) / Math.max(1, purchase.amountCents),
    );
    if (amount <= 0) continue;
    const mutation = {
      appUserId: purchase.appUserId,
      unitId: grant.unitId,
      amount,
      kind:
        input.kind === "dispute_reversal"
          ? ("dispute_reversal" as const)
          : input.kind,
      description:
        input.kind === "dispute_reversal"
          ? "Dispute resolved in your favour"
          : `Reversal — ${input.kind}`,
      idempotencyKey: `reversal:${input.eventId}:${purchase.id}:${grant.id}`,
      referenceType: "purchase",
      referenceId: purchase.id,
    };
    if (deltaRefundedAmount > 0) await debitBalanceAllowingNegative(mutation);
    else await creditBalance(mutation);
    reversedUnits += amount;
  }

  await db
    .update(purchases)
    .set({
      status: input.kind === "dispute_reversal" ? "paid" : input.kind === "dispute" ? "disputed" : "refunded",
      refundedAmountCents: targetRefundedAmount,
      reversedUnits:
        deltaRefundedAmount >= 0
          ? purchase.reversedUnits + reversedUnits
          : Math.max(0, purchase.reversedUnits - reversedUnits),
      updatedAt: new Date(),
    })
    .where(eq(purchases.id, purchase.id));
  return true;
}

export async function processStripeWebhook(
  rawBody: string,
  signature: string | null,
  mode: StripeMode = "live",
) {
  const secret = webhookSecretFor(mode);
  if (!secret || !signature) throw new Error("STRIPE_WEBHOOK_NOT_CONFIGURED");

  const event = stripe(mode).webhooks.constructEvent(rawBody, signature, secret);
  if (
    !(await beginEvent({
      id: event.id,
      type: event.type,
      objectId: objectIdOf(event.data.object),
    }))
  ) {
    return { duplicate: true, eventId: event.id };
  }

  try {
    let handled = true;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        handled = await handleCheckoutCompleted(event.data.object, mode);
        break;

      case "checkout.session.async_payment_failed": {
        const released = await releaseRedemptionBySession(
          event.data.object.id,
          event.data.object.metadata?.couponRedemptionId,
        );
        const purchase = await purchaseFor(event.data.object);
        if (purchase) {
          await db
            .update(purchases)
            .set({ status: "failed", updatedAt: new Date() })
            .where(and(eq(purchases.id, purchase.id), eq(purchases.status, "pending")));
        } else handled = released;
        break;
      }

      // An abandoned checkout must give its coupon use back, or a code limited
      // to N redemptions would be spent by people who never paid.
      case "checkout.session.expired": {
        const released = await releaseRedemptionBySession(
          event.data.object.id,
          event.data.object.metadata?.couponRedemptionId,
        );
        const purchase = await purchaseFor(event.data.object);
        if (purchase) {
          await db
            .update(purchases)
            .set({ status: "failed", updatedAt: new Date() })
            .where(and(eq(purchases.id, purchase.id), eq(purchases.status, "pending")));
        } else handled = released;
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        handled = await syncSubscriptionFromStripe(event.data.object);
        break;

      case "invoice.paid": {
        const invoice = event.data.object;
        const subscriptionId = referenceId(
          (invoice as unknown as { subscription?: string | { id: string } })
            .subscription,
        );
        if (subscriptionId) {
          // Renewal: re-read the subscription so the new period is granted.
          const subscription =
            await stripe(mode).subscriptions.retrieve(subscriptionId);
          handled = await syncSubscriptionFromStripe(subscription);
        } else handled = false;
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId = referenceId(charge.payment_intent);
        handled = paymentIntentId
          ? await reverseTopup({
              paymentIntentId,
              refundedAmountCents: charge.amount_refunded,
              kind: "refund",
              eventId: event.id,
            })
          : false;
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object;
        const charge = await stripe(mode).charges.retrieve(referenceId(dispute.charge)!);
        const paymentIntentId = referenceId(charge.payment_intent);
        handled = paymentIntentId
          ? await reverseTopup({
              paymentIntentId,
              refundedAmountCents: charge.amount,
              kind: "dispute",
              eventId: event.id,
            })
          : false;
        break;
      }

      case "charge.dispute.closed": {
        const dispute = event.data.object;
        if (dispute.status !== "won") {
          handled = false;
          break;
        }
        const charge = await stripe(mode).charges.retrieve(referenceId(dispute.charge)!);
        const paymentIntentId = referenceId(charge.payment_intent);
        handled = paymentIntentId
          ? await reverseTopup({
              paymentIntentId,
              refundedAmountCents: 0,
              kind: "dispute_reversal",
              eventId: event.id,
            })
          : false;
        break;
      }

      default:
        handled = false;
    }

    await finishEvent(event.id, handled ? "processed" : "ignored");
    return { duplicate: false, eventId: event.id };
  } catch (cause) {
    await finishEvent(
      event.id,
      "failed",
      cause instanceof Error ? cause.message.slice(0, 120) : "WEBHOOK_FAILED",
    );
    throw cause;
  }
}
