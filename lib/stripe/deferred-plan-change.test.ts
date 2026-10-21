import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const m = vi.hoisted(() => ({ rows: [] as unknown[][], set: vi.fn(), group: vi.fn(), price: vi.fn(), setup: vi.fn(), retrieve: vi.fn(), create: vi.fn(), update: vi.fn(), plans: new Map<string, unknown>() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const select = () => {
    const query = { from: () => query, where: () => query, limit: () => query,
      for: async () => m.rows.shift(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(m.rows.shift()).then(resolve) };
    return query;
  };
  const tx = { select, update: () => ({ set: m.set }) };
  return { db: { ...tx, transaction: (fn: (value: unknown) => unknown) => fn(tx) } };
});
vi.mock("@/lib/subscription/plans", () => ({ requirePlan: (_app: string, id: string) => m.plans.get(id) }));
vi.mock("@/lib/subscription/subscriptions", () => ({ assertPlanGroupAvailable: m.group }));
vi.mock("./products", () => ({ ensurePlanPrice: m.price }));
vi.mock("./client", () => ({ modeForUser: () => "sandbox", referenceId: (value: string | { id: string }) => typeof value === "string" ? value : value?.id,
  stripe: () => ({ setupIntents: { retrieve: m.setup }, subscriptions: { retrieve: m.retrieve }, subscriptionSchedules: { create: m.create, update: m.update } }),
}));
import { completeDeferredPlanChange } from "./deferred-plan-change";
const end = 1898726400;
const base = { id: "local", applicationId: "app", appUserId: "user", planId: "old", status: "active", billingProvider: "stripe", stripeSubscriptionId: "sub_1", currentPeriodEnd: new Date(end * 1000), entitlementSnapshot: { entitlements: [] } };
const current = { id: "old", autoSubscribe: false, priceAmountCents: 1000, currency: "usd", planGroup: "default", billingInterval: "month", intervalCount: 1 };
const target = { ...current, id: "new", name: "New plan", priceAmountCents: 2000, status: "active" };
const session = () => ({ id: "cs_setup", mode: "setup", status: "complete", setup_intent: "seti_1", customer: "cus_1",
  metadata: { kind: "plan_change_setup", applicationId: "app", appUserId: "user", sourceSubscriptionId: "local", sourcePlanId: "old", targetPlanId: "new", effectiveAt: String(end), targetPriceId: "price_new" },
}) as unknown as Stripe.Checkout.Session;
function seed(owned = base) { m.rows = [[owned], [{ id: "user", isTest: true }], [{ stripeCustomerId: "cus_1" }]]; }
beforeEach(() => {
  vi.resetAllMocks(); seed();
  m.plans = new Map([["old", { ...current }], ["new", { ...target }]]);
  m.set.mockReturnValue({ where: async () => [] }); m.price.mockResolvedValue("price_new");
  m.setup.mockResolvedValue({ status: "succeeded", payment_method: "pm_1", customer: "cus_1" });
  m.retrieve.mockResolvedValue({ id: "sub_1", customer: "cus_1", status: "active", collection_method: "charge_automatically", metadata: { applicationId: "app", appUserId: "user", planId: "old" },
    items: { data: [{ id: "si_1", quantity: 1, current_period_end: end, price: { id: "price_old", metadata: { planId: "old" } } }] } });
  m.create.mockResolvedValue({ id: "sched_1", phases: [{ start_date: end - 30 * 86400 }] });
  m.update.mockResolvedValue({ id: "sched_1" });
});

describe("deferred changes retain current access until renewal", () => {
  it("2: automatic free plan starts its paid Stripe schedule at the free period end", async () => {
    seed({ ...base, billingProvider: "internal" });
    m.plans.set("old", { ...current, autoSubscribe: true, priceAmountCents: 0 });
    await completeDeferredPlanChange(session(), "sandbox");
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ start_date: end, default_settings: { default_payment_method: "pm_1" },
      phases: [expect.objectContaining({ items: [{ price: "price_new", quantity: 1 }], metadata: expect.objectContaining({ planId: "new" }) })] }), expect.anything());
    expect(m.update).not.toHaveBeenCalled();
    expect(m.set).toHaveBeenCalledWith(expect.objectContaining({ entitlementSnapshot: expect.objectContaining({ pendingPlanChange: expect.objectContaining({ planId: "new", effectiveAt: new Date(end * 1000).toISOString() }) }) }));
    expect(m.set.mock.calls[0][0]).not.toHaveProperty("planId");
  });
  it.each([["4: $10 to $20", 1000, 2000], ["6: $20 to $10", 2000, 1000], ["zero-price Stripe subscription", 0, 2000]])("%s keeps the old price until renewal", async (_name, oldPrice, newPrice) => {
    m.plans.set("old", { ...current, priceAmountCents: oldPrice }); m.plans.set("new", { ...target, priceAmountCents: newPrice });
    await completeDeferredPlanChange(session(), "sandbox");
    expect(m.create).toHaveBeenCalledWith({ from_subscription: "sub_1" }, expect.objectContaining({ idempotencyKey: expect.stringContaining("local") }));
    expect(m.update).toHaveBeenCalledWith("sched_1", expect.objectContaining({ proration_behavior: "none", phases: [
      expect.objectContaining({ end_date: end, items: [expect.objectContaining({ price: "price_old" })] }),
      expect.objectContaining({ items: [{ price: "price_new", quantity: 1 }], default_payment_method: "pm_1", metadata: expect.objectContaining({ planId: "new" }) }),
    ] }), expect.anything());
    expect(m.set.mock.calls[0][0]).not.toHaveProperty("planId");
  });
  it("does nothing for an abandoned setup review", async () => {
    await expect(completeDeferredPlanChange({ ...session(), status: "open" }, "sandbox")).resolves.toBe(false);
    expect(m.create).not.toHaveBeenCalled(); expect(m.set).not.toHaveBeenCalled();
  });
  it("refuses failed payment-method setup", async () => {
    m.setup.mockResolvedValue({ status: "requires_payment_method", customer: "cus_1" });
    await expect(completeDeferredPlanChange(session(), "sandbox")).rejects.toThrow("incomplete");
    expect(m.create).not.toHaveBeenCalled();
  });
  it("replays a completed setup without creating another schedule", async () => {
    seed({ ...base, entitlementSnapshot: { entitlements: [], pendingPlanChange: { checkoutSessionId: "cs_setup" } } } as typeof base);
    await expect(completeDeferredPlanChange(session(), "sandbox")).resolves.toBe(true);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("rejects a stale plan or changed price before scheduling", async () => {
    seed({ ...base, planId: "other" });
    await expect(completeDeferredPlanChange(session(), "sandbox")).rejects.toThrow("current plan has changed");
    seed(); m.price.mockResolvedValue("price_changed");
    await expect(completeDeferredPlanChange(session(), "sandbox")).rejects.toThrow("price has changed");
    expect(m.create).not.toHaveBeenCalled();
  });
  it("does not mark a change scheduled when Stripe fails; retry reuses the idempotency key", async () => {
    m.update.mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(completeDeferredPlanChange(session(), "sandbox")).rejects.toThrow("Stripe unavailable");
    expect(m.set).not.toHaveBeenCalled();
    seed(); await completeDeferredPlanChange(session(), "sandbox");
    expect(m.create.mock.calls[0][1]).toEqual(m.create.mock.calls[1][1]);
  });
});
