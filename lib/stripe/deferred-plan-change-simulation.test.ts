import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { AppUser, Plan, Subscription } from "@/lib/db/schema";
const m = vi.hoisted(() => ({ sourceAmount: 1000, targetAmount: 2000, rows: [] as unknown[][], write: vi.fn(), grant: vi.fn(), upsert: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const select = () => {
    const query = { from: () => query, where: () => query, limit: () => query, for: async () => m.rows.shift(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(m.rows.shift()).then(resolve) };
    return query;
  };
  const tx = { select, update: () => ({ set: (data: unknown) => { m.write(data); return { where: async () => [] }; } }) };
  return { db: { ...tx, transaction: (fn: (value: unknown) => unknown) => fn(tx) } };
});
vi.mock("@/lib/subscription/plans", () => ({ requirePlan: (_app: string, id: string) => ({ id, name: id, planGroup: "default", billingInterval: "month", intervalCount: 1, currency: "usd", status: "active", autoSubscribe: id === "free", priceAmountCents: id === "free" ? 0 : id === "new" ? m.targetAmount : m.sourceAmount }) }));
vi.mock("@/lib/subscription/subscriptions", () => ({ assertPlanGroupAvailable: async () => {}, grantPeriodBalances: m.grant, upsertSubscriptionFromStripe: m.upsert }));
vi.mock("@/lib/subscription/coupons", () => ({}));
vi.mock("@/lib/subscription/users", () => ({}));
vi.mock("@/lib/subscription/topups", () => ({}));
vi.mock("@/lib/workflows/schedule", () => ({}));
vi.mock("./products", () => ({ ensurePlanPrice: async () => "price_new" }));
vi.mock("./checkout", () => ({ customerFor: async () => "cus_good" }));
import { createDeferredPlanReview, completeDeferredPlanChange } from "./deferred-plan-change";
import { syncSubscriptionFromStripe } from "./webhook";
import { stripe } from "./client";
const boundary = 1898726400;
const baseURL = process.env.E2E_STRIPE_API_BASE;
async function control(path: string, body: unknown) {
  const response = await fetch(`${baseURL}/v1/test/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect(response.ok).toBe(true); return response.json();
}

describe.skipIf(process.env.IS_E2E !== "true" || !baseURL)("deferred plan changes through real Stripe SDK HTTP", () => {
  it.each([["free", "internal", 0, 2000], ["old", "stripe", 1000, 2000], ["old", "stripe", 2000, 1000]] as const)("%s / %s: %i to %i retains access until the renewal boundary", async (sourceId, provider, oldAmount, newAmount) => {
    m.sourceAmount = oldAmount; m.targetAmount = newAmount;
    await control("reset", { sourceId, oldAmount, newAmount });
    m.write.mockClear(); m.grant.mockClear(); m.upsert.mockClear();
    const owned = { id: "local", planId: sourceId, billingProvider: provider, status: "active", stripeSubscriptionId: "sub_good", currentPeriodEnd: new Date(boundary * 1000), entitlementSnapshot: {} } as Subscription;
    const current = { id: sourceId, autoSubscribe: provider === "internal", priceAmountCents: oldAmount, currency: "usd", billingInterval: "month", intervalCount: 1 } as Plan;
    const target = { ...current, id: "new", name: "New plan", priceAmountCents: newAmount, autoSubscribe: false } as Plan;
    const review = await createDeferredPlanReview({ applicationId: "app", user: { id: "user", isTest: true } as AppUser, owned, current, target, returnUrl: "https://example.test/billing" });
    expect(review.url).toBe("https://checkout.stripe.com/c/pay/simulated-setup");
    expect(m.write).not.toHaveBeenCalled(); expect(m.grant).not.toHaveBeenCalled();
    // Fixture represents the signed checkout.session.completed delivery after approval.
    const completed = await stripe("sandbox").checkout.sessions.retrieve("cs_setup");
    m.rows = [[owned], [{ id: "user", isTest: true }], [{ stripeCustomerId: "cus_good" }]];
    await completeDeferredPlanChange(completed, "sandbox");
    expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ entitlementSnapshot: expect.objectContaining({ pendingPlanChange: expect.objectContaining({ planId: "new" }) }) }));
    expect(m.write.mock.calls[0][0]).not.toHaveProperty("planId");
    const before = await control("advance", { now: boundary - 1 });
    expect(before.planId).toBe(sourceId); expect(before.invoicedCents).toBe(0);
    const after = await control("advance", { now: boundary });
    expect(after.planId).toBe("new"); expect(after.invoicedCents).toBe(newAmount);
    // Run the real access-sync function only after the provider changes its price.
    m.rows = [[{ id: "new" }], [{ id: "user" }]];
    m.upsert.mockResolvedValue({ subscription: { id: "local-new" } });
    const remote = await stripe("sandbox").subscriptions.retrieve("sub_good");
    await syncSubscriptionFromStripe(remote as Stripe.Subscription);
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ planId: "new" }));
    expect(m.grant).toHaveBeenCalledWith(expect.objectContaining({ planId: "new" }));
  });
});
