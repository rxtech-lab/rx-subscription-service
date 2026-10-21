import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/db/schema";

const m = vi.hoisted(() => ({
  rows: [] as unknown[], plans: new Map<string, unknown>(),
  limit: vi.fn(), group: vi.fn(), price: vi.fn(), retrieve: vi.fn(),
  priceRetrieve: vi.fn(), configuration: vi.fn(), session: vi.fn(), stripe: vi.fn(), where: vi.fn(),
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
import { createPlanChangeSession } from "./plan-change";

const owned = { id: "local", planId: "old", billingProvider: "stripe", stripeSubscriptionId: "sub_1" };
const current = { id: "old", planGroup: "default", billingInterval: "month", currency: "usd" };
const target = { ...current, id: "new", status: "active", autoSubscribe: false };
const remote = () => ({ id: "sub_1", customer: "cus_1", status: "active", collection_method: "charge_automatically",
  metadata: { applicationId: "app", appUserId: "user", planId: "old" },
  items: { data: [{ id: "si_1", quantity: 1, price: { metadata: { planId: "old" } } }] },
});
const input = { applicationId: "app", user: { id: "user", isTest: true } as AppUser,
  subscriptionId: "local", planId: "new", returnUrl: "https://example.test/billing" };

beforeEach(() => {
  vi.resetAllMocks();
  m.plans = new Map([["old", { ...current }], ["new", { ...target }]]);
  m.limit.mockResolvedValue([owned]); m.where.mockReturnValue({ limit: m.limit });
  m.price.mockResolvedValue("price_new"); m.retrieve.mockResolvedValue(remote());
  m.priceRetrieve.mockResolvedValue({ product: "prod_new" });
  m.configuration.mockResolvedValue({ id: "bpc_1" }); m.session.mockResolvedValue({ url: "https://billing.stripe.com/review" });
  m.stripe.mockReturnValue({ subscriptions: { retrieve: m.retrieve }, prices: { retrieve: m.priceRetrieve },
    billingPortal: { configurations: { create: m.configuration }, sessions: { create: m.session } } });
});

describe("plan change confirmation", () => {
  it("opens the exact selected plan without mutating the subscription", async () => {
    await expect(createPlanChangeSession(input)).resolves.toEqual({ url: "https://billing.stripe.com/review" });
    expect(m.stripe).toHaveBeenCalledWith("sandbox");
    expect(m.where).toHaveBeenCalledOnce();
    expect(m.group).toHaveBeenCalledWith(expect.objectContaining({ appUserId: "user", excludeSubscriptionId: "local" }));
    expect(m.configuration).toHaveBeenCalledWith(expect.objectContaining({ features: { subscription_update: {
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
