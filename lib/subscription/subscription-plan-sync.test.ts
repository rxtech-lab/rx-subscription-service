import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ existing: { id: "local", planId: "old", providerProductId: "price_old", entitlementSnapshot: { marker: "original" } }, set: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [m.existing], then: (resolve: (rows: unknown[]) => unknown) => resolve([{ kind: "feature", key: "new-feature" }]) }) }) }),
  update: () => ({ set: m.set }),
} }));
vi.mock("@/lib/subscription/users", () => ({}));
vi.mock("@/lib/subscription/balance-lots", () => ({}));
vi.mock("@/lib/subscription/plans", () => ({}));
import { upsertSubscriptionFromStripe } from "./subscriptions";
beforeEach(() => { vi.clearAllMocks(); m.set.mockReturnValue({ where: () => ({ returning: async () => [{ id: "local", endedAt: null }] }) }); });

describe("existing subscription plan persistence", () => {
  it("updates the plan and captures its new entitlement snapshot", async () => {
    await upsertSubscriptionFromStripe({ applicationId: "app", appUserId: "user", planId: "new", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "canceled", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(m.set).toHaveBeenCalledWith(expect.objectContaining({ planId: "new", entitlementSnapshot: {
      capturedAt: expect.any(String), entitlements: [{ kind: "feature", key: "new-feature" }],
    } }));
  });
  it("preserves the existing snapshot when the plan has not changed", async () => {
    await upsertSubscriptionFromStripe({ applicationId: "app", appUserId: "user", planId: "old", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "canceled", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(m.set).toHaveBeenCalledWith(expect.objectContaining({ planId: "old", entitlementSnapshot: m.existing.entitlementSnapshot }));
  });
});
