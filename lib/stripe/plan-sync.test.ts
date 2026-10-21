import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const m = vi.hoisted(() => ({ limit: vi.fn(), upsert: vi.fn(), grant: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: m.limit }) }) }) } }));
vi.mock("@/lib/subscription/subscriptions", () => ({ upsertSubscriptionFromStripe: m.upsert, grantPeriodBalances: m.grant }));
vi.mock("@/lib/subscription/coupons", () => ({}));
vi.mock("@/lib/subscription/topups", () => ({}));
vi.mock("@/lib/subscription/users", () => ({}));
vi.mock("@/lib/workflows/schedule", () => ({}));
import { syncSubscriptionFromStripe } from "./webhook";
const subscription = () => ({ id: "sub_1", customer: "cus_1", status: "active", start_date: 100,
  metadata: { applicationId: "app", appUserId: "user", planId: "old" },
  items: { data: [{ current_period_start: 100, current_period_end: 200,
    price: { id: "price_new", metadata: { applicationId: "app", planId: "new" } } }] },
}) as unknown as Stripe.Subscription;
beforeEach(() => { vi.resetAllMocks(); m.limit.mockResolvedValue([{ id: "found" }]); m.upsert.mockResolvedValue({ subscription: { id: "local" } }); });
describe("confirmed Stripe price determines access", () => {
  it("uses the new price instead of original subscription metadata", async () => {
    await expect(syncSubscriptionFromStripe(subscription())).resolves.toBe(true);
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ planId: "new", stripeSubscriptionId: "sub_1", providerProductId: "price_new" }));
    expect(m.grant).toHaveBeenCalledWith(expect.objectContaining({ planId: "new", subscriptionId: "local" }));
  });
  it("rejects a price from a different application", async () => {
    const sub = subscription(); sub.items.data[0].price.metadata.applicationId = "other";
    await expect(syncSubscriptionFromStripe(sub)).rejects.toThrow("STRIPE_PRICE_APPLICATION_MISMATCH");
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("rejects an unknown plan before writing access", async () => {
    m.limit.mockResolvedValueOnce([]);
    await expect(syncSubscriptionFromStripe(subscription())).rejects.toThrow("STRIPE_PRICE_PLAN_NOT_FOUND");
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("retains legacy subscriptions without price metadata", async () => {
    const sub = subscription(); sub.items.data[0].price.metadata = {};
    await syncSubscriptionFromStripe(sub);
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ planId: "old" }));
  });
});
