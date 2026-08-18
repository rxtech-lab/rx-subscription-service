import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  adminSubscriptionCheckoutUrls,
  assertSubscriptionMatchesSession,
  completedSubscriptionFromSession,
} from "./admin-checkout";

function session(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_test_123",
    status: "complete",
    mode: "subscription",
    metadata: {
      applicationId: "app-123",
      appUserId: "user-123",
      planId: "plan-123",
      kind: "plan_subscription",
    },
    subscription: "sub_123",
    ...overrides,
  } as Stripe.Checkout.Session;
}

describe("adminSubscriptionCheckoutUrls", () => {
  it("returns to the application subscription admin page", () => {
    expect(
      adminSubscriptionCheckoutUrls("https://subscriptions.example.com", "app/123"),
    ).toEqual({
      successUrl:
        "https://subscriptions.example.com/apps/app%2F123/subscriptions/checkout/complete?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl:
        "https://subscriptions.example.com/apps/app%2F123/subscriptions?checkout=cancelled",
    });
  });
});

describe("assertSubscriptionMatchesSession", () => {
  const subscription = {
    id: "sub_123",
    metadata: {
      applicationId: "app-123",
      appUserId: "user-123",
      planId: "plan-123",
      kind: "plan_subscription",
    },
  } as unknown as Stripe.Subscription;

  it("accepts matching Checkout and subscription metadata", () => {
    expect(() =>
      assertSubscriptionMatchesSession(session(), subscription),
    ).not.toThrow();
  });

  it("rejects a subscription for a different plan", () => {
    expect(() =>
      assertSubscriptionMatchesSession(session(), {
        ...subscription,
        metadata: { ...subscription.metadata, planId: "another-plan" },
      }),
    ).toThrow("STRIPE_SUBSCRIPTION_CHECKOUT_MISMATCH");
  });
});

describe("completedSubscriptionFromSession", () => {
  it("returns the Stripe subscription from a verified completed session", () => {
    expect(completedSubscriptionFromSession(session(), "app-123")).toBe("sub_123");
  });

  it("rejects an unfinished Checkout Session", () => {
    expect(() =>
      completedSubscriptionFromSession(session({ status: "open" }), "app-123"),
    ).toThrow("STRIPE_CHECKOUT_NOT_COMPLETE");
  });

  it("rejects a session belonging to a different application", () => {
    expect(() =>
      completedSubscriptionFromSession(session(), "another-app"),
    ).toThrow("STRIPE_CHECKOUT_APPLICATION_MISMATCH");
  });

  it("rejects a completed session without a subscription", () => {
    expect(() =>
      completedSubscriptionFromSession(session({ subscription: null }), "app-123"),
    ).toThrow("STRIPE_CHECKOUT_SUBSCRIPTION_MISSING");
  });
});
