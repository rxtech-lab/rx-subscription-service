import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEligibilityMode } from "./topup-eligibility";

const m = vi.hoisted(() => ({ rows: [] as unknown[][], roles: [] as string[], set: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => {
    const rows = m.rows.shift() ?? [];
    return { limit: async () => rows, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  } }) }),
  update: () => ({ set: m.set }),
} }));
vi.mock("./shared", async (importOriginal) => ({ ...await importOriginal<typeof import("./shared")>(), recordAudit: vi.fn() }));
vi.mock("./entitlements", () => ({ getUserRoleIds: async () => m.roles }));
import { checkTopupEligibility, updateTopupProduct } from "./topups";

const payg = { ruleType: "requires_active_plan", planId: "payg", roleId: null };
const plus = { ruleType: "requires_active_plan", planId: "plus", roleId: null };
const role = { ruleType: "requires_role", planId: null, roleId: "member" };
const input = { applicationId: "app", topupId: "pack", appUserId: "user" };
function setup(mode: "all" | "any", rules: { ruleType: string; planId: string | null; roleId: string | null }[] = [payg, plus], plans = ["plus"], max: number | null = null, count = 0) {
  m.rows = [rules, [{ eligibilityMode: mode, maxPurchasesPerUser: max }], plans.map(planId => ({ planId, status: "active" })), [{ value: count }]];
}
beforeEach(() => { m.rows = []; m.roles = []; vi.clearAllMocks(); });

describe("topup AND/OR eligibility service", () => {
  it.each(["payg", "plus"])("OR admits %s without the other plan", async (plan) => {
    setup("any", [payg, plus], [plan]);
    expect(await checkTopupEligibility(input)).toEqual({ eligible: true, failed: [] });
  });
  it("AND retains failures when only one plan is present", async () => {
    setup("all");
    expect(await checkTopupEligibility(input)).toEqual({ eligible: false, failed: [payg] });
  });
  it("AND admits a user satisfying every condition", async () => {
    setup("all", [payg, plus], ["payg", "plus"]);
    expect((await checkTopupEligibility(input)).eligible).toBe(true);
  });
  it("OR reports every alternative when none passes", async () => {
    setup("any", [payg, plus], []);
    expect(await checkTopupEligibility(input)).toEqual({ eligible: false, failed: [payg, plus] });
  });
  it.each(["all", "any"] as const)("%s with no conditions allows standalone packs", async (mode) => {
    setup(mode, [], []);
    expect(await checkTopupEligibility(input)).toEqual({ eligible: true, failed: [] });
  });
  it("OR accepts a role alternative", async () => {
    setup("any", [payg, role], []); m.roles = ["member"];
    expect((await checkTopupEligibility(input)).eligible).toBe(true);
  });
  it("AND still requires a role in addition to a plan", async () => {
    setup("all", [plus, role]);
    expect((await checkTopupEligibility(input)).failed).toEqual([role]);
  });
  it("OR cannot bypass the purchase limit", async () => {
    setup("any", [payg, plus], ["plus"], 1, 1);
    expect(await checkTopupEligibility(input)).toEqual({ eligible: false, failed: [{ ruleType: "purchase_limit", planId: null, roleId: null }] });
  });
  it("OR allows purchases below the limit", async () => {
    setup("any", [payg, plus], ["plus"], 2, 1);
    expect((await checkTopupEligibility(input)).eligible).toBe(true);
  });
  it("persists the chosen mode while preserving it on unrelated updates", async () => {
    const product = { id: "pack", eligibilityMode: "any", name: "Pack", priceAmountCents: 499 };
    m.set.mockReturnValue({ where: () => ({ returning: async () => [product] }) });
    m.rows = [[product]];
    await updateTopupProduct({ ...input, eligibilityMode: "all", actor: { type: "system", id: "test" } });
    expect(m.set).toHaveBeenCalledWith(expect.objectContaining({ eligibilityMode: "all" }));
    m.rows = [[product]];
    await updateTopupProduct({ ...input, name: "New name", actor: { type: "system", id: "test" } });
    expect(m.set).toHaveBeenLastCalledWith(expect.objectContaining({ eligibilityMode: "any" }));
  });
});

it("validates modes and defaults old callers to AND", () => {
  expect(parseEligibilityMode()).toBe("all");
  expect(() => parseEligibilityMode("invalid")).toThrow();
});
