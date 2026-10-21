import { describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/db/schema";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "local", planId: "old", billingProvider: "stripe", stripeSubscriptionId: "sub_good" }] }) }) }) } }));
vi.mock("@/lib/subscription/plans", () => ({ requirePlan: (_app: string, id: string) => ({ id, planGroup: "default", billingInterval: "month", currency: "usd", status: "active", autoSubscribe: false }) }));
vi.mock("@/lib/subscription/subscriptions", () => ({ assertPlanGroupAvailable: async () => {} }));
vi.mock("./products", () => ({ ensurePlanPrice: async () => "price_new" }));
import { createPlanChangeSession } from "./plan-change";

// Real Stripe SDK + HTTP. Only the database/price mirror are fixtures.
describe.skipIf(!process.env.E2E_STRIPE_API_BASE)("plan change Postman simulation", () => {
  it("creates the hosted confirmation through the real SDK transport", async () => {
    const result = await createPlanChangeSession({ applicationId: "app", user: { id: "user", isTest: true } as AppUser,
      subscriptionId: "local", planId: "new", returnUrl: "https://example.test/billing" });
    expect(result.url).toBe("https://billing.stripe.com/p/session/simulated");
  });
});
