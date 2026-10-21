import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/db/schema";

const m = vi.hoisted(() => ({
  rows: [] as unknown[], plans: new Map<string, unknown>(),
  limit: vi.fn(), group: vi.fn(), price: vi.fn(), retrieve: vi.fn(),
  checkout: vi.fn(), customer: vi.fn(), setup: vi.fn(), priceRetrieve: vi.fn(), configuration: vi.fn(), session: vi.fn(), stripe: vi.fn(), where: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: m.where }) }) } }));
vi.mock("@/lib/subscription/plans", () => ({ requirePlan: (_app: string, id: string) => m.plans.get(id) }));
vi.mock("@/lib/subscription/subscriptions", () => ({ assertPlanGroupAvailable: m.group }));
vi.mock("./products", () => ({ ensurePlanPrice: m.price }));
vi.mock("./client", () => ({ modeForUser: (user: { isTest: boolean }) => user.isTest ? "sandbox" : "live",
  referenceId: (value: string | { id: string }) => typeof value === "string" ? value : value?.id,
  stripe: m.stripe,
}));
vi.mock("./checkout", () => ({ createPlanCheckout: m.checkout, customerFor: m.customer }));
import { createPlanChangeSession } from "./plan-change";

const owned = { id: "local", planId: "old", billingProvider: "stripe", stripeSubscriptionId: "sub_1" };
const current = { priceAmountCents: 1000, intervalCount: 1, id: "old", planGroup: "default", billingInterval: "month", currency: "usd" };
const target = { ...current, priceAmountCents: 2000, id: "new", status: "active", autoSubscribe: false };
const remote = () => ({ id: "sub_1", customer: "cus_1", status: "active", collection_method: "charge_automatically",
  metadata: { applicationId: "app", appUserId: "user", planId: "old" },
  items: { data: [{ id: "si_1", quantity: 1, current_period_end: 1898726400, price: { id: "price_old", unit_amount: 1000, metadata: { planId: "old" } } }] },
});
const input = { applicationId: "app", user: { id: "user", isTest: true } as AppUser,
  subscriptionId: "local", planId: "new", returnUrl: "https://example.test/billing" };

beforeEach(() => {
  vi.resetAllMocks();
  m.plans = new Map([["old", { ...current }], ["new", { ...target }]]);
  m.limit.mockResolvedValue([owned]); m.where.mockReturnValue({ limit: m.limit });
  m.customer.mockResolvedValue("cus_1"); m.checkout.mockResolvedValue({ checkoutUrl: "https://checkout.stripe.com/free-upgrade" });
  m.price.mockResolvedValue("price_new"); m.retrieve.mockResolvedValue(remote());
  m.priceRetrieve.mockResolvedValue({ product: "prod_new" });
  m.configuration.mockResolvedValue({ id: "bpc_1" }); m.session.mockResolvedValue({ url: "https://billing.stripe.com/review" });
  m.stripe.mockReturnValue({ subscriptions: { retrieve: m.retrieve }, prices: { retrieve: m.priceRetrieve },
    checkout: { sessions: { create: m.session } }, billingPortal: { configurations: { create: m.configuration }, sessions: { create: m.session } } });
});

describe("plan change confirmation", () => {
  it("opens the exact selected plan without mutating the subscription", async () => {
    await expect(createPlanChangeSession(input)).resolves.toEqual({ url: "https://billing.stripe.com/review" });
    expect(m.stripe).toHaveBeenCalledWith("sandbox");
    expect(m.where).toHaveBeenCalledOnce();
    expect(m.group).toHaveBeenCalledWith(expect.objectContaining({ appUserId: "user", excludeSubscriptionId: "local" }));
    expect(m.configuration).toHaveBeenCalledWith(expect.objectContaining({ features: { payment_method_update: { enabled: true }, subscription_update: {
      enabled: true, default_allowed_updates: ["price"], products: [{ product: "prod_new", prices: ["price_new"] }], proration_behavior: "always_invoice",
    } } }), expect.anything());
    expect(m.session).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1", flow_data: {
      type: "subscription_update_confirm", subscription_update_confirm: { subscription: "sub_1", items: [{ id: "si_1", price: "price_new", quantity: 1 }] },
      after_completion: { type: "redirect", redirect: { return_url: input.returnUrl } },
    } }));
  });
  it("refuses a subscription outside the authenticated ownership query", async () => {
    m.limit.mockResolvedValue([]);
    await expect(createPlanChangeSession(input)).rejects.toThrow("Only active Stripe");
    expect(m.retrieve).not.toHaveBeenCalled();
  });
  it.each([{ autoSubscribe: true }, { planGroup: "other" }, { currency: "hkd" }, { billingInterval: "one_time" }, { status: "archived" }, { id: "old" }])("refuses invalid target %j", async (patch) => {
    m.plans.set("new", { ...target, ...patch });
    await expect(createPlanChangeSession(input)).rejects.toThrow("Choose a different");
    expect(m.session).not.toHaveBeenCalled();
  });
  it.each([{ status: "past_due" }, { cancel_at_period_end: true }, { schedule: "sched_1" }, { pending_update: {} }, { collection_method: "send_invoice" }])("refuses unavailable state %j", async (patch) => {
    m.retrieve.mockResolvedValue({ ...remote(), ...patch });
    await expect(createPlanChangeSession(input)).rejects.toThrow("cannot change plans");
    expect(m.session).not.toHaveBeenCalled();
  });
  it("refuses another tenant's Stripe subscription", async () => {
    m.retrieve.mockResolvedValue({ ...remote(), metadata: { applicationId: "other", appUserId: "user" } });
    await expect(createPlanChangeSession(input)).rejects.toThrow("cannot change plans");
  });
  it("refuses a stale tab after a Stripe price change", async () => {
    const sub = remote(); sub.items.data[0].price.metadata.planId = "new";
    m.retrieve.mockResolvedValue(sub);
    await expect(createPlanChangeSession(input)).rejects.toThrow("Refresh billing");
  });
  it("does not open review when another group conflict or Stripe failure occurs", async () => {
    m.group.mockRejectedValueOnce(new Error("conflict"));
    await expect(createPlanChangeSession(input)).rejects.toThrow("conflict");
    expect(m.session).not.toHaveBeenCalled();
    m.configuration.mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(createPlanChangeSession(input)).rejects.toThrow("Stripe unavailable");
    expect(m.session).not.toHaveBeenCalled();
  });
});


describe("six requested billing cases", () => {
  it("1: free/no-payment plan upgrades immediately through checkout", async () => {
    m.limit.mockResolvedValue([{ ...owned, billingProvider: "internal", stripeSubscriptionId: null }]);
    m.plans.set("old", { ...current, autoSubscribe: true, priceAmountCents: 0 });
    const result = await createPlanChangeSession({ ...input, timing: "immediate" });
    expect(result.url).toBe("https://checkout.stripe.com/free-upgrade");
    expect(m.checkout).toHaveBeenCalledWith(expect.objectContaining({ planId: "new" }));
    expect(m.configuration).not.toHaveBeenCalled();
  });
  it("2: free plan schedules only after a payment-method setup confirmation", async () => {
    m.limit.mockResolvedValue([{ ...owned, billingProvider: "internal", currentPeriodEnd: new Date(1898726400000) }]);
    m.plans.set("old", { ...current, autoSubscribe: true, priceAmountCents: 0 });
    await createPlanChangeSession({ ...input, timing: "next_period" });
    expect(m.session).toHaveBeenCalledWith(expect.objectContaining({ mode: "setup", metadata: expect.objectContaining({ effectiveAt: "1898726400", sourcePlanId: "old", targetPlanId: "new" }) }));
    expect(m.checkout).not.toHaveBeenCalled();
    expect(m.configuration).not.toHaveBeenCalled();
  });
  it("3: $10 to $20 mid-period uses immediate Stripe proration", async () => {
    await createPlanChangeSession({ ...input, timing: "immediate" });
    expect(m.configuration).toHaveBeenCalledWith(expect.objectContaining({ features: expect.objectContaining({ subscription_update: expect.objectContaining({ proration_behavior: "always_invoice" }) }) }), expect.anything());
    expect(m.session).toHaveBeenCalledWith(expect.objectContaining({ flow_data: expect.objectContaining({ type: "subscription_update_confirm" }) }));
  });
  it("4: $10 to $20 next period uses setup, without an immediate charge", async () => {
    await createPlanChangeSession({ ...input, timing: "next_period" });
    expect(m.session).toHaveBeenCalledWith(expect.objectContaining({ mode: "setup", metadata: expect.objectContaining({ effectiveAt: "1898726400" }) }));
    expect(m.configuration).not.toHaveBeenCalled();
  });
  it("5: $20 to $10 cannot downgrade in the middle of the period", async () => {
    m.plans.set("old", { ...current, priceAmountCents: 2000 });
    m.plans.set("new", { ...target, priceAmountCents: 1000 });
    const sub = remote(); sub.items.data[0].price.unit_amount = 2000; m.retrieve.mockResolvedValue(sub);
    await expect(createPlanChangeSession({ ...input, timing: "immediate" })).rejects.toThrow("Downgrades must start at the next billing period");
    expect(m.session).not.toHaveBeenCalled(); expect(m.checkout).not.toHaveBeenCalled();
  });
  it("6: $20 to $10 is allowed starting next period", async () => {
    m.plans.set("old", { ...current, priceAmountCents: 2000 });
    m.plans.set("new", { ...target, priceAmountCents: 1000 });
    await createPlanChangeSession({ ...input, timing: "next_period" });
    expect(m.session).toHaveBeenCalledWith(expect.objectContaining({ mode: "setup", metadata: expect.objectContaining({ targetPlanId: "new", effectiveAt: "1898726400" }) }));
  });
});

describe("actual Stripe price guards", () => {
  it("allows an immediate upgrade from a zero-price Stripe plan", async () => {
    m.plans.set("old", { ...current, priceAmountCents: 0 });
    const sub = remote(); sub.items.data[0].price.unit_amount = 0; m.retrieve.mockResolvedValue(sub);
    await createPlanChangeSession({ ...input, timing: "immediate" });
    expect(m.session).toHaveBeenCalledWith(expect.objectContaining({ flow_data: expect.objectContaining({ type: "subscription_update_confirm" }) }));
  });
  it("prevents an immediate downgrade even if the catalogue price was lowered", async () => {
    m.plans.set("new", { ...target, priceAmountCents: 1500 });
    const sub = remote(); sub.items.data[0].price.unit_amount = 2000; m.retrieve.mockResolvedValue(sub);
    await expect(createPlanChangeSession({ ...input, timing: "immediate" })).rejects.toThrow("Downgrades must start at the next billing period");
    expect(m.session).not.toHaveBeenCalled();
  });
});


describe("portal payment-method prerequisite", () => {
  it("enables payment-method updates and avoids replaying the failed v1 configuration", async () => {
    await createPlanChangeSession(input);
    expect(m.configuration).toHaveBeenCalledWith(expect.objectContaining({
      features: expect.objectContaining({ payment_method_update: { enabled: true },
        subscription_update: expect.objectContaining({ enabled: true }) }),
    }), { idempotencyKey: "plan-change-config:v2:app:price_new" });
  });
});
