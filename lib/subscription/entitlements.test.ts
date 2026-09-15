import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: new Map<unknown, unknown[]>(), sync: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  select: () => {
    let table: unknown;
    const query = {
      from: (value: unknown) => { table = value; return query; },
      innerJoin: () => query, where: () => query, orderBy: () => query, limit: () => query,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(mocks.rows.get(table) ?? []).then(resolve),
    };
    return query;
  },
} }));
vi.mock("./subscriptions", () => ({ syncInternalDefaultSubscriptions: mocks.sync }));
vi.mock("./roles", () => ({
  listRoles: async () => [{ id: "role", key: "pro", isDefault: false }],
  getRolePermissions: async () => ({ expressions: [] }),
}));
vi.mock("./users", () => ({ requireAppUser: async () => ({ testClockOffsetMs: 0 }) }));
vi.mock("./usage-items", () => {
  const item = {
    id: "quick", key: "quick_mode_allowance", defaultLimit: null,
    resetPolicy: "calendar_period", resetIntervalUnit: "day", resetIntervalCount: 1,
    overagePolicy: "block",
  };
  return { listUsageItems: async () => [item], requireUsageItem: async () => item };
});

import { appUserUsageLimits, planEntitlements, purchases, subscriptions, usageCounters } from "@/lib/db/schema";
import { resolveEntitlements } from "./entitlements";
import { getUsageStatus, recordUsage } from "./usage";

const owner = { applicationId: "app", appUserId: "user" };
const now = new Date("2026-09-07T12:00:00Z");
const start = new Date("2026-09-07T00:00:00Z");
const end = new Date("2026-09-08T00:00:00Z");
const usageGrant = (limitValue: number | null) => ({
  planId: "plan", kind: "usage_limit", usageItemId: "quick", limitValue, trialLimitValue: 10,
});
const subscription = (snapshot: unknown[], status = "active", billingProvider = "apple_app_store") => ({
  subscriptionId: "sub", planId: "plan", status, billingProvider, planKey: "monthly",
  currentPeriodStart: start, currentPeriodEnd: end, entitlementSnapshot: { entitlements: snapshot },
});

beforeEach(() => {
  mocks.rows.clear(); vi.clearAllMocks();
  mocks.rows.set(subscriptions, [subscription([])]);
  mocks.rows.set(planEntitlements, [usageGrant(1000)]);
  mocks.rows.set(usageCounters, [{ used: 2, periodStart: start, periodEnd: end }]);
});

it("applies a newly added plan allowance to an existing subscriber with an empty snapshot", async () => {
  expect((await resolveEntitlements(owner)).usageLimits).toEqual({ quick: 1000 });
  expect(await getUsageStatus({ ...owner, now })).toMatchObject([
    { key: "quick_mode_allowance", limit: 1000, used: 2, remaining: 998, resetsAt: end },
  ]);
});

it.each(["apple_app_store", "stripe", "internal", "complimentary"])("applies grant edits and removals to existing %s subscriptions", async (provider) => {
  mocks.rows.set(subscriptions, [subscription([usageGrant(null)], "active", provider)]);
  expect((await resolveEntitlements(owner)).usageLimits.quick).toBe(1000);
  mocks.rows.set(planEntitlements, [usageGrant(5)]);
  expect(await getUsageStatus({ ...owner, now })).toMatchObject([{ limit: 5, used: 2, remaining: 3 }]);
  mocks.rows.set(planEntitlements, []);
  expect((await resolveEntitlements(owner)).usageLimits).toEqual({});
});

it.each(["trialing", "active", "past_due"])("uses current grants for %s and retains explicit user overrides", async (status) => {
  mocks.rows.set(subscriptions, [subscription([usageGrant(null)], status)]);
  expect((await resolveEntitlements(owner)).usageLimits.quick).toBe(status === "trialing" ? 10 : 1000);
  mocks.rows.set(appUserUsageLimits, [{ usageItemId: "quick", limitValue: 4 }]);
  expect((await resolveEntitlements(owner)).usageLimits.quick).toBe(4);
  mocks.rows.set(appUserUsageLimits, [{ usageItemId: "quick", limitValue: null }]);
  expect((await resolveEntitlements(owner)).usageLimits.quick).toBeNull();
});

it.each(["apple_app_store", "stripe", "internal", "complimentary"])("applies added, edited, and removed access grants for %s subscribers", async (provider) => {
  mocks.rows.set(subscriptions, [subscription([
    { kind: "feature", featureKey: "old_feature", featureValue: "enabled" },
    { kind: "balance_grant", unitId: "points", amount: 100 },
  ], "active", provider)]);
  mocks.rows.set(planEntitlements, [
    usageGrant(1000),
    { planId: "plan", kind: "role", roleId: "role" },
    { planId: "plan", kind: "permission", permissionKey: "read:stickers", permissionScope: "all" },
    { planId: "plan", kind: "feature", featureKey: "export", featureValue: "enabled" },
    { planId: "plan", kind: "balance_grant", unitId: "points", amount: 2000 },
  ]);
  expect(await resolveEntitlements(owner)).toMatchObject({
    roleKeys: ["pro"], permissions: ["read:stickers:all"], features: { export: "enabled" },
    balanceGrants: [{ unitId: "points", amount: 2000 }], usageLimits: { quick: 1000 },
  });
  expect((await resolveEntitlements(owner)).features).not.toHaveProperty("old_feature");
  mocks.rows.set(planEntitlements, []);
  expect(await resolveEntitlements(owner)).toMatchObject({
    roleKeys: [], permissions: [], features: {}, balanceGrants: [], usageLimits: {},
  });
});

it("preserves one-time purchase grants while a subscription to the same plan uses current grants", async () => {
  mocks.rows.set(purchases, [{
    purchaseId: "purchase", planId: "plan", paidAt: start,
    entitlementSnapshot: { entitlements: [usageGrant(2000)] },
  }]);
  expect((await resolveEntitlements(owner)).usageLimits.quick).toBe(2000);
});

it("enforces the edited plan limit without resetting an existing usage counter", async () => {
  mocks.rows.set(subscriptions, [subscription([usageGrant(null)])]);
  mocks.rows.set(planEntitlements, [usageGrant(2)]);
  expect(await recordUsage({
    ...owner, usageItemId: "quick", amount: 1, idempotencyKey: "next-attempt", now,
  })).toMatchObject({ allowed: false, reason: "limit_exceeded", limit: 2, used: 2, remaining: 0 });
  mocks.rows.set(planEntitlements, [usageGrant(1)]);
  expect(await getUsageStatus({ ...owner, now })).toMatchObject([{ limit: 1, used: 2, remaining: 0 }]);
});

it("keeps legacy subscriptions without a snapshot on live grants", async () => {
  mocks.rows.set(subscriptions, [{ ...subscription([]), entitlementSnapshot: null }]);
  expect((await resolveEntitlements(owner)).usageLimits.quick).toBe(1000);
});
