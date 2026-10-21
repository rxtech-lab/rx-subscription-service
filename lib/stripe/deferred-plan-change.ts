import "server-only";
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, subscriptions, stripeCustomers, type AppUser, type Plan, type Subscription } from "@/lib/db/schema";
import { requirePlan } from "@/lib/subscription/plans";
import { assertPlanGroupAvailable } from "@/lib/subscription/subscriptions";
import { ValidationError } from "@/lib/subscription/shared";
import { ensurePlanPrice } from "./products";
import { modeForUser, referenceId, stripe, type StripeMode } from "./client";

export async function createDeferredPlanReview(input: {
  applicationId: string; user: AppUser; owned: Subscription; current: Plan; target: Plan; returnUrl: string;
}) {
  const mode = modeForUser(input.user);
  const client = stripe(mode);
  let end = input.owned.currentPeriodEnd;
  if (input.owned.billingProvider === "stripe") {
    if (!input.owned.stripeSubscriptionId) throw new ValidationError("Stripe subscription is missing");
    const remote = await client.subscriptions.retrieve(input.owned.stripeSubscriptionId);
    const item = remote.items.data[0];
    if (remote.metadata.applicationId !== input.applicationId || remote.metadata.appUserId !== input.user.id ||
        !["active", "trialing"].includes(remote.status) || remote.items.data.length !== 1 ||
        remote.schedule || remote.pending_update || remote.cancel_at_period_end ||
        remote.collection_method !== "charge_automatically" ||
        (item?.price.metadata?.planId ?? remote.metadata.planId) !== input.current.id) {
      throw new ValidationError("This subscription cannot change plans right now");
    }
    end = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  }
  if (!end || end.getTime() <= Date.now()) throw new ValidationError("Refresh billing to load the next billing date");
  const targetPriceId = await ensurePlanPrice(input.target, mode);
  const { customerFor } = await import("./checkout");
  const customer = await customerFor(input.user, mode);
  const session = await client.checkout.sessions.create({
    mode: "setup", customer, currency: input.target.currency,
    metadata: { kind: "plan_change_setup", applicationId: input.applicationId, appUserId: input.user.id,
      sourceSubscriptionId: input.owned.id, sourcePlanId: input.current.id, targetPlanId: input.target.id,
      effectiveAt: String(Math.floor(end.getTime() / 1000)), targetPriceId },
    custom_text: { submit: { message: `${input.target.name} starts on ${end.toISOString().slice(0, 10)} at ${input.target.currency.toUpperCase()} ${(input.target.priceAmountCents / 100).toFixed(2)} per ${input.target.intervalCount} ${input.target.billingInterval}. No plan charge today.` } },
    success_url: input.returnUrl, cancel_url: input.returnUrl,
  });
  if (!session.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");
  return { url: session.url };
}

/** Called only for a signed, completed setup checkout. No new access is granted here. */
export async function completeDeferredPlanChange(session: Stripe.Checkout.Session, mode: StripeMode) {
  const meta = session.metadata;
  if (meta?.kind !== "plan_change_setup") return false;
  if (session.mode !== "setup" || session.status !== "complete") return false;
  const effectiveAt = Number(meta.effectiveAt);
  if (!Number.isSafeInteger(effectiveAt)) throw new ValidationError("The requested start date has passed");
  const client = stripe(mode);
  const setupId = referenceId(session.setup_intent);
  if (!setupId) throw new ValidationError("Payment method setup is incomplete");
  const setup = await client.setupIntents.retrieve(setupId);
  const paymentMethod = referenceId(setup.payment_method);
  if (setup.status !== "succeeded" || !paymentMethod || referenceId(setup.customer) !== referenceId(session.customer)) {
    throw new ValidationError("Payment method setup is incomplete");
  }
  return db.transaction(async (tx) => {
    const [owned] = await tx.select().from(subscriptions).where(and(
      eq(subscriptions.id, meta.sourceSubscriptionId), eq(subscriptions.applicationId, meta.applicationId),
      eq(subscriptions.appUserId, meta.appUserId),
    )).limit(1).for("update");
    if (!owned) throw new ValidationError("Subscription not found");
    const pending = owned.entitlementSnapshot?.pendingPlanChange as { checkoutSessionId?: string } | undefined;
    if (pending?.checkoutSessionId === session.id) return true;
    if (effectiveAt <= Date.now() / 1000) throw new ValidationError("The requested start date has passed");
    if (pending || owned.planId !== meta.sourcePlanId || !["active", "trialing"].includes(owned.status) || owned.cancelAtPeriodEnd) {
      throw new ValidationError("The current plan has changed");
    }
    const [user] = await tx.select().from(appUsers).where(and(eq(appUsers.id, meta.appUserId), eq(appUsers.applicationId, meta.applicationId))).limit(1);
    const [customer] = await tx.select().from(stripeCustomers).where(eq(stripeCustomers.appUserId, meta.appUserId)).limit(1);
    if (!user || modeForUser(user) !== mode || customer?.stripeCustomerId !== referenceId(session.customer)) {
      throw new ValidationError("Billing account mismatch");
    }
    const [current, target] = await Promise.all([requirePlan(meta.applicationId, owned.planId, tx), requirePlan(meta.applicationId, meta.targetPlanId, tx)]);
    if (target.status !== "active" || target.autoSubscribe || target.id === current.id || target.planGroup !== current.planGroup ||
        target.currency !== current.currency || target.billingInterval === "one_time" || current.billingInterval === "one_time") {
      throw new ValidationError("Target plan is no longer available");
    }
    await assertPlanGroupAvailable({ applicationId: meta.applicationId, appUserId: user.id, plan: target, excludeSubscriptionId: owned.id }, tx);
    const priceId = await ensurePlanPrice(target, mode);
    if (priceId !== meta.targetPriceId) throw new ValidationError("Plan price has changed. Review it again");
    const metadata = { applicationId: meta.applicationId, appUserId: user.id, planId: target.id, kind: "plan_subscription" };
    const future: Stripe.SubscriptionScheduleCreateParams.Phase = {
      items: [{ price: priceId, quantity: 1 }], metadata,
      duration: { interval: target.billingInterval === "year" ? "year" : "month", interval_count: target.intervalCount * (target.billingInterval === "quarter" ? 3 : 1) },
      proration_behavior: "none",
    };
    const key = `deferred-plan:v1:${owned.id}:${effectiveAt}`;
    let schedule: Stripe.SubscriptionSchedule;
    if (owned.billingProvider === "internal") {
      if (!current.autoSubscribe || current.priceAmountCents !== 0 || Math.floor((owned.currentPeriodEnd?.getTime() ?? 0) / 1000) !== effectiveAt) {
        throw new ValidationError("The free plan billing period has changed");
      }
      schedule = await client.subscriptionSchedules.create({ customer: referenceId(session.customer)!, start_date: effectiveAt,
        end_behavior: "release", default_settings: { default_payment_method: paymentMethod }, phases: [future],
      }, { idempotencyKey: key });
    } else if (owned.billingProvider === "stripe" && owned.stripeSubscriptionId) {
      const remote = await client.subscriptions.retrieve(owned.stripeSubscriptionId);
      const item = remote.items.data[0];
      if (!item || remote.items.data.length !== 1 || !["active", "trialing"].includes(remote.status) || remote.cancel_at_period_end || remote.pending_update ||
          remote.collection_method !== "charge_automatically" || referenceId(remote.customer) !== referenceId(session.customer) || remote.metadata.applicationId !== meta.applicationId || remote.metadata.appUserId !== user.id ||
          (item.price.metadata?.planId ?? remote.metadata.planId) !== current.id || item.current_period_end !== effectiveAt) {
        throw new ValidationError("The current Stripe plan has changed");
      }
      // Replays use the same key, including recovery after a failed local write.
      const initial = await client.subscriptionSchedules.create({ from_subscription: remote.id }, { idempotencyKey: key });
      const phase = initial.phases[0];
      if (!phase || initial.phases.length !== 1) throw new ValidationError("An existing schedule cannot be replaced");
      schedule = await client.subscriptionSchedules.update(initial.id, {
        end_behavior: "release", proration_behavior: "none",
        phases: [{ start_date: phase.start_date, end_date: effectiveAt,
          items: [{ price: item.price.id, quantity: item.quantity ?? 1,
            discounts: (item.discounts ?? []).map((discount) => ({ discount: referenceId(discount)! })),
            tax_rates: item.tax_rates?.map((rate) => rate.id) }],
          discounts: (remote.discounts ?? []).map((discount) => ({ discount: referenceId(discount)! })),
          metadata: remote.metadata, ...(remote.trial_end && remote.trial_end <= effectiveAt ? { trial_end: remote.trial_end } : {}),
          proration_behavior: "none" },
          { ...future, default_payment_method: paymentMethod }],
      }, { idempotencyKey: `${key}:phases` });
    } else throw new ValidationError("Unsupported billing provider");
    await tx.update(subscriptions).set({ entitlementSnapshot: { ...owned.entitlementSnapshot,
      pendingPlanChange: { planId: target.id, planName: target.name, effectiveAt: new Date(effectiveAt * 1000).toISOString(),
        scheduleId: schedule.id, checkoutSessionId: session.id } }, updatedAt: new Date() }).where(eq(subscriptions.id, owned.id));
    return true;
  });
}
