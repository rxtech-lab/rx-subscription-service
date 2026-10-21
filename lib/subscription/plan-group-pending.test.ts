import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@/lib/db/schema";
const m = vi.hoisted(() => ({ rows: [] as unknown[][] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => m.rows.shift() }) }) }) } }));
vi.mock("@/lib/subscription/users", () => ({}));
vi.mock("@/lib/subscription/balance-lots", () => ({}));
vi.mock("@/lib/subscription/plans", () => ({}));
import { assertPlanGroupAvailable } from "./subscriptions";
const owned = { planId: "free", planName: "Free", planGroup: "default", billingProvider: "internal", autoSubscribe: true,
  entitlementSnapshot: { pendingPlanChange: { planId: "paid", scheduleId: "sched_1" } } };
const input = { applicationId: "app", appUserId: "user", plan: { id: "paid", planGroup: "default" } as Plan };
beforeEach(() => { m.rows = [[owned], []]; });
describe("pending free-plan upgrades reserve the group", () => {
  it("blocks a new checkout that could cause two future subscriptions", async () => {
    await expect(assertPlanGroupAvailable(input)).rejects.toThrow("User already has");
  });
  it("allows only the confirmed scheduled target at activation", async () => {
    await expect(assertPlanGroupAvailable({ ...input, allowScheduledPlanChangeId: "sched_1" })).resolves.toBeUndefined();
  });
  it("rejects a different schedule or target", async () => {
    await expect(assertPlanGroupAvailable({ ...input, allowScheduledPlanChangeId: "other" })).rejects.toThrow("User already has");
    m.rows = [[owned], []];
    await expect(assertPlanGroupAvailable({ ...input, plan: { ...input.plan, id: "other" }, allowScheduledPlanChangeId: "sched_1" })).rejects.toThrow("User already has");
  });
  it("still permits replacing an automatic free plan without a pending change", async () => {
    m.rows = [[{ ...owned, entitlementSnapshot: {} }], []];
    await expect(assertPlanGroupAvailable(input)).resolves.toBeUndefined();
  });
});
