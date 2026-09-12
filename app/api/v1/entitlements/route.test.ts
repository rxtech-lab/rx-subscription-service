import { beforeEach, expect, it, vi } from "vitest";
import type { ResolvedEntitlements } from "@/lib/subscription/entitlements";

const mocks = vi.hoisted(() => ({
  resolveEntitlements: vi.fn(),
  getBalances: vi.fn(),
  getUsageStatus: vi.fn(),
}));

vi.mock("@/lib/api/context", () => ({
  authenticateApiRequest: async () => ({ application: { id: "app" } }),
  requireKeyScope: vi.fn(),
  resolveRequestUser: async () => ({
    id: "user", rxlabUserId: "rx-user", level: 0, levelKey: null,
  }),
  noStore: { "Cache-Control": "no-store" },
  apiError: (error: Error) => Response.json({ error: error.message }, { status: 500 }),
}));
vi.mock("@/lib/subscription/entitlements", () => ({
  resolveEntitlements: mocks.resolveEntitlements,
}));
vi.mock("@/lib/subscription/users", () => ({ getBalances: mocks.getBalances }));
vi.mock("@/lib/subscription/usage", () => ({ getUsageStatus: mocks.getUsageStatus }));

import { GET } from "./route";

function heldPlan(billingProvider: string): ResolvedEntitlements["plans"][number] {
  return {
    subscriptionId: `sub-${billingProvider}`,
    purchaseId: null,
    planId: `plan-${billingProvider}`,
    planKey: billingProvider === "internal" ? "free" : "pro",
    planName: billingProvider === "internal" ? "Free" : "Pro",
    planGroup: "default",
    status: "active",
    currentPeriodStart: new Date("2026-09-12T00:00:00Z"),
    currentPeriodEnd: new Date("2026-10-12T00:00:00Z"),
    cancelAtPeriodEnd: false,
    billingProvider,
    providerProductId: null,
  };
}

const freeEntitlements: ResolvedEntitlements = {
  plans: [heldPlan("internal")],
  roleKeys: ["free"],
  roleIds: ["free-role"],
  permissions: ["read:stickers:all"],
  features: { export: "enabled" },
  usageLimits: { quick: 3 },
  directRoleIds: [],
  usageLimitOverrides: {},
  balanceGrants: [{ unitId: "points", amount: 10 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveEntitlements.mockResolvedValue(freeEntitlements);
  mocks.getBalances.mockResolvedValue([{
    unitKey: "points", unitName: "Points", symbol: "pt", precision: 0,
    amount: 10, reserved: 2,
  }]);
  mocks.getUsageStatus.mockResolvedValue([{
    key: "quick", name: "Quick", used: 1, limit: 3, remaining: 2,
    resetsAt: null, resetPolicy: "never",
  }]);
});

it("keeps default plans out of the paid-plan list for shipped clients without platform headers", async () => {
  const response = await GET(new Request("https://example.com/api/v1/entitlements"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    plans: [],
    defaultPlans: [{ planKey: "free", billingProvider: "internal", status: "active" }],
    roles: ["free"],
    permissions: ["read:stickers:all"],
    features: { export: "enabled" },
    balances: [{ unit: "points", amount: 10, available: 8 }],
    usage: [{ key: "quick", limit: 3, remaining: 2 }],
  });
  expect(mocks.resolveEntitlements).toHaveBeenCalledWith({ applicationId: "app", appUserId: "user" });
  expect(freeEntitlements.plans).toHaveLength(1);
});

it.each(["stripe", "apple_app_store", "google_play"])(
  "preserves %s subscriptions alongside default-plan grants",
  async (provider) => {
    mocks.resolveEntitlements.mockResolvedValue({
      ...freeEntitlements,
      plans: [heldPlan("internal"), heldPlan(provider)],
    });
    const response = await GET(new Request("https://example.com/api/v1/entitlements"));
    const body = await response.json();
    expect(body.plans).toEqual([JSON.parse(JSON.stringify(heldPlan(provider)))]);
    expect(body.defaultPlans).toEqual([JSON.parse(JSON.stringify(heldPlan("internal")))]);
    expect(body.usage).toMatchObject([{ key: "quick", limit: 3 }]);
  },
);

it("preserves purchased one-time plans and returns an empty default-plan list when none exist", async () => {
  const purchased = {
    ...heldPlan("apple_app_store"), subscriptionId: null, purchaseId: "purchase",
    currentPeriodEnd: null,
  };
  mocks.resolveEntitlements.mockResolvedValue({ ...freeEntitlements, plans: [purchased] });
  const response = await GET(new Request("https://example.com/api/v1/entitlements"));
  const body = await response.json();
  expect(body.plans).toEqual([JSON.parse(JSON.stringify(purchased))]);
  expect(body.defaultPlans).toEqual([]);
});
