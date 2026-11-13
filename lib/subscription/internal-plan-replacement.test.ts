import { expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ set: vi.fn(), stamp: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./plans", () => ({ requirePlan: async () => ({ planGroup: "default" }) }));
vi.mock("./balance-lots", () => ({ stampLotsForPlanEnd: m.stamp }));
import type { DbExecutor } from "@/lib/db";
import { replaceInternalDefaultForPlan } from "./subscriptions";

it("ends a replaced automatic free plan without marking it canceled and still expires its balance lots", async () => {
  m.set.mockReturnValue({ where: () => ({ returning: async () => [{ id: "free-sub" }] }) });
  const executor = {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => [{ id: "free-sub" }] }) }) }),
    update: () => ({ set: m.set }),
  } as unknown as DbExecutor;
  await replaceInternalDefaultForPlan({ applicationId: "app", appUserId: "user", planId: "pro" }, executor);
  expect(m.set).toHaveBeenCalledWith(expect.objectContaining({ status: "expired", endedAt: expect.any(Date), cancelAtPeriodEnd: false }));
  expect(m.stamp).toHaveBeenCalledWith({ subscriptionId: "free-sub", endedAt: expect.any(Date) }, executor);
});
