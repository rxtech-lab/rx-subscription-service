import "server-only";
import type Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  purchases,
  stripeWebhookEvents,
  topupProducts,
  type SubscriptionStatus,
} from "@/lib/db/schema";
import { newId } from "@/lib/subscription/shared";
import { checkTopupEligibility } from "@/lib/subscription/topups";
import {
  grantPeriodBalances,
  upsertSubscriptionFromStripe,
} from "@/lib/subscription/subscriptions";
import { creditBalance, debitBalance } from "@/lib/subscription/users";
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

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  mode: StripeMode,
) {
  if (session.payment_status !== "paid") return false;

  // Subscriptions are reconciled from `customer.subscription.*`, which carries
  // the authoritative period boundaries.
  if (session.mode === "subscription") return false;

  const purchaseId = session.metadata?.purchaseId ?? session.client_reference_id;
  if (!purchaseId) return false;

  return fulfillPaidPurchase({
    purchaseId,
    stripePaymentIntentId: referenceId(session.payment_intent),
    stripeInvoiceId: referenceId(session.invoice),
    mode,
  });
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
  await db
    .update(purchases)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(purchases.id, purchase.id));

  if (purchase.planId) {
    await grantPeriodBalances({
      applicationId: purchase.applicationId,
      appUserId: purchase.appUserId,
      planId: purchase.planId,
      periodKey: `one_time:${purchase.id}`,
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

  await upsertSubscriptionFromStripe({
    applicationId,
    appUserId,
    planId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: referenceId(subscription.customer),
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
  });

  // Balance grants ride on the period, keyed so a replay cannot double-grant.
  if ((status === "active" || status === "trialing") && currentPeriodStart) {
    await grantPeriodBalances({
      applicationId,
      appUserId,
      planId,
      periodKey: String(currentPeriodStart.getTime()),
    });
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
  if (!purchase || !purchase.unitId || purchase.unitsGranted <= 0) return false;

  const targetReversed =
    input.kind === "dispute_reversal"
      ? 0
      : Math.min(
          purchase.unitsGranted,
          Math.floor(
            (purchase.unitsGranted * input.refundedAmountCents) /
              Math.max(1, purchase.amountCents),
          ),
        );
  const delta = targetReversed - purchase.reversedUnits;
  if (delta === 0) return false;

  const mutation = {
    appUserId: purchase.appUserId,
    unitId: purchase.unitId,
    amount: Math.abs(delta),
    kind: input.kind === "dispute_reversal" ? ("dispute_reversal" as const) : input.kind,
    description:
      input.kind === "dispute_reversal"
        ? "Dispute resolved in your favour"
        : `Reversal — ${input.kind}`,
    idempotencyKey: `reversal:${input.eventId}:${purchase.id}`,
    referenceType: "purchase",
    referenceId: purchase.id,
  };

  // A balance already spent can go negative here; that debt is real and is
  // settled by the next credit rather than being silently forgiven.
  if (delta > 0) {
    await db.transaction(async () => {
      await debitBalanceAllowingNegative(mutation);
    });
  } else {
    await creditBalance(mutation);
  }

  await db
    .update(purchases)
    .set({
      status: input.kind === "dispute_reversal" ? "paid" : input.kind === "dispute" ? "disputed" : "refunded",
      refundedAmountCents: input.refundedAmountCents,
      reversedUnits: targetReversed,
      updatedAt: new Date(),
    })
    .where(eq(purchases.id, purchase.id));
  return true;
}

/**
 * Reversals must apply even when the user has already spent the units, so this
 * bypasses the sufficiency check that guards ordinary debits.
 */
async function debitBalanceAllowingNegative(input: {
  appUserId: string;
  unitId: string;
  amount: number;
  kind: "refund" | "dispute" | "dispute_reversal";
  description: string;
  idempotencyKey: string;
  referenceType: string;
  referenceId: string;
}) {
  try {
    await debitBalance(input);
  } catch {
    const { balances, ledgerEntries } = await import("@/lib/db/schema");
    const now = new Date();
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(balances)
        .set({ amount: sql`${balances.amount} - ${input.amount}`, updatedAt: now })
        .where(
          and(
            eq(balances.appUserId, input.appUserId),
            eq(balances.unitId, input.unitId),
          ),
        )
        .returning();
      if (!updated) return;
      await tx
        .insert(ledgerEntries)
        .values({
          id: newId(),
          appUserId: input.appUserId,
          unitId: input.unitId,
          kind: input.kind,
          delta: -input.amount,
          balanceAfter: updated.amount,
          description: input.description,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
        })
        .onConflictDoNothing();
    });
  }
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
        const purchase = await purchaseFor(event.data.object);
        if (purchase) {
          await db
            .update(purchases)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(purchases.id, purchase.id));
        } else handled = false;
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
