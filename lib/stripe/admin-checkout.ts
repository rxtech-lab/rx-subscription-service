import type Stripe from "stripe";

export function adminSubscriptionCheckoutUrls(
  origin: string,
  applicationId: string,
) {
  const subscriptionsPath = `/apps/${encodeURIComponent(applicationId)}/subscriptions`;
  return {
    successUrl: `${origin}${subscriptionsPath}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}${subscriptionsPath}?checkout=cancelled`,
  };
}

/**
 * A success redirect is only a navigation signal. Verify the Checkout Session
 * with Stripe before treating it as a completed subscription for this app.
 */
export function completedSubscriptionFromSession(
  session: Stripe.Checkout.Session,
  applicationId: string,
): string | Stripe.Subscription {
  if (session.status !== "complete") {
    throw new Error("STRIPE_CHECKOUT_NOT_COMPLETE");
  }
  if (session.mode !== "subscription") {
    throw new Error("STRIPE_CHECKOUT_NOT_SUBSCRIPTION");
  }
  if (
    session.metadata?.kind !== "plan_subscription" ||
    session.metadata.applicationId !== applicationId
  ) {
    throw new Error("STRIPE_CHECKOUT_APPLICATION_MISMATCH");
  }
  if (!session.subscription) {
    throw new Error("STRIPE_CHECKOUT_SUBSCRIPTION_MISSING");
  }
  return session.subscription;
}

export function assertSubscriptionMatchesSession(
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription,
) {
  const sessionMetadata = session.metadata;
  const subscriptionMetadata = subscription.metadata;
  if (
    !sessionMetadata ||
    subscriptionMetadata.applicationId !== sessionMetadata.applicationId ||
    subscriptionMetadata.appUserId !== sessionMetadata.appUserId ||
    subscriptionMetadata.planId !== sessionMetadata.planId ||
    subscriptionMetadata.kind !== sessionMetadata.kind
  ) {
    throw new Error("STRIPE_SUBSCRIPTION_CHECKOUT_MISMATCH");
  }
}
