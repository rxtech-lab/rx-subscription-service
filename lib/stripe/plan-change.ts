import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, type AppUser } from "@/lib/db/schema";
import { requirePlan } from "@/lib/subscription/plans";
import { assertPlanGroupAvailable } from "@/lib/subscription/subscriptions";
import { ValidationError } from "@/lib/subscription/shared";
import { ensurePlanPrice } from "./products";
import { modeForUser, referenceId, stripe } from "./client";

/** Only creates a confirmation session. Stripe applies the change after approval. */
export async function createPlanChangeSession(input: {
  applicationId: string;
  user: AppUser;
  subscriptionId: string;
  planId: string;
  returnUrl: string;
}) {
  const [owned] = await db.select().from(subscriptions).where(and(
    eq(subscriptions.id, input.subscriptionId),
    eq(subscriptions.applicationId, input.applicationId),
    eq(subscriptions.appUserId, input.user.id),
    inArray(subscriptions.status, ["active", "trialing"]),
  )).limit(1);
  if (!owned || owned.billingProvider !== "stripe" || !owned.stripeSubscriptionId) {
    throw new ValidationError("Only active Stripe subscriptions can change plans here");
  }
  const [current, target] = await Promise.all([
    requirePlan(input.applicationId, owned.planId),
    requirePlan(input.applicationId, input.planId),
  ]);
  if (target.id === current.id || target.status !== "active" || target.autoSubscribe ||
      target.billingInterval === "one_time" || current.billingInterval === "one_time" ||
      target.planGroup !== current.planGroup || target.currency !== current.currency) {
    throw new ValidationError("Choose a different active recurring plan in the same group and currency");
  }
  await assertPlanGroupAvailable({ applicationId: input.applicationId,
    appUserId: input.user.id, plan: target, excludeSubscriptionId: owned.id });
  const mode = modeForUser(input.user);
  const client = stripe(mode);
  const subscription = await client.subscriptions.retrieve(owned.stripeSubscriptionId);
  const item = subscription.items.data[0];
  if (subscription.metadata.applicationId !== input.applicationId ||
      subscription.metadata.appUserId !== input.user.id ||
      !["active", "trialing"].includes(subscription.status) ||
      subscription.items.data.length !== 1 || !item || subscription.schedule ||
      subscription.pending_update || subscription.cancel_at_period_end ||
      subscription.collection_method !== "charge_automatically") {
    throw new ValidationError("This subscription cannot change plans right now");
  }
  // Refuse stale tabs, including a completed change whose webhook is still queued.
  const actualPlan = item.price.metadata?.planId ?? subscription.metadata.planId;
  if (actualPlan !== current.id) throw new ValidationError("Your plan has changed. Refresh billing and try again");
  const priceId = await ensurePlanPrice(target, mode);
  const price = await client.prices.retrieve(priceId);
  const productId = referenceId(price.product);
  if (!productId) throw new ValidationError("Plan price has no product");
  // Isolated configuration: this deep link can only change to the selected plan.
  const configuration = await client.billingPortal.configurations.create({
    features: { subscription_update: {
      enabled: true, default_allowed_updates: ["price"],
      products: [{ product: productId, prices: [priceId] }],
      proration_behavior: "always_invoice",
    } },
  }, { idempotencyKey: `plan-change-config:v1:${input.applicationId}:${priceId}` });
  const session = await client.billingPortal.sessions.create({
    customer: referenceId(subscription.customer)!,
    configuration: configuration.id,
    return_url: input.returnUrl,
    flow_data: {
      type: "subscription_update_confirm",
      subscription_update_confirm: { subscription: subscription.id,
        items: [{ id: item.id, price: priceId, quantity: item.quantity ?? 1 }] },
      after_completion: { type: "redirect", redirect: { return_url: input.returnUrl } },
    },
  });
  return { url: session.url };
}
