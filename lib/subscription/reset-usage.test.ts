import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), requireItem: vi.fn(), audit: vi.fn(),
  transaction: vi.fn(), update: vi.fn(), select: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { select: (...args: unknown[]) => mocks.select(...args), transaction: mocks.transaction } }));
vi.mock("./users", () => ({ requireAppUser: mocks.requireUser }));
vi.mock("./usage-items", () => ({ requireUsageItem: mocks.requireItem }));
vi.mock("./shared", async (original) => ({ ...await original<object>(), recordAudit: mocks.audit }));
import { resetUserUsage } from "./reset-usage";

const base = { applicationId: "app-a", environment: "production" as const,
  userScope: "user" as const, usageScope: "item" as const,
  appUserId: "user-a", usageItemId: "item-a", actor: { type: "user" as const, id: "admin" } };
let query: { sql: string; params: unknown[] };
const counters = [{ id: "counter-a", appUserId: "user-a", usageItemId: "item-a", used: 42 }];
const updateWhere = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ environment: "production" });
  mocks.requireItem.mockResolvedValue({ id: "item-a" });
  mocks.audit.mockResolvedValue(undefined);
  const builder = drizzle.mock();
  mocks.select.mockImplementation((fields) => builder.select(fields));
  mocks.transaction.mockImplementation(async (run) => run({
    select: () => ({ from: () => ({ where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      query = new PgDialect().sqlToQuery(condition);
      return { orderBy: () => ({ for: () => Promise.resolve(counters) }) };
    } }) }),
    update: mocks.update.mockReturnValue({ set: () => ({ where: updateWhere }) }),
  }));
});

describe("usage reset scope", () => {
  it.each([
    ["user", "item"], ["user", "all"], ["all", "item"], ["all", "all"],
  ] as const)("supports %s users and %s usage", async (userScope, usageScope) => {
    expect(await resetUserUsage({ ...base, userScope, usageScope })).toBe(1);
    expect(query.params).toContain("app-a");
    expect(query.params).toContain("production");
    expect(query.params.includes("user-a")).toBe(userScope === "user");
    expect(query.params.includes("item-a")).toBe(usageScope === "item");
    expect(query.sql).toContain('"period_start" <=');
    expect(query.sql).toContain('"period_end" >');
    expect(query.sql).toContain('"period_end" is null');
    expect(query.sql).toContain('"test_clock_offset_ms"');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      before: { used: 42, appUserId: "user-a", usageItemId: "item-a" },
      after: expect.objectContaining({ used: 0, userScope, usageScope }),
    }), expect.objectContaining({ update: mocks.update }));
  });
  it("rejects a user in another environment before mutation", async () => {
    mocks.requireUser.mockResolvedValue({ environment: "sandbox" });
    await expect(resetUserUsage(base)).rejects.toThrow("environment");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(["user", "item"])("rejects a foreign application %s", async (entity) => {
    (entity === "user" ? mocks.requireUser : mocks.requireItem).mockRejectedValue(new Error("not found"));
    await expect(resetUserUsage(base)).rejects.toThrow("not found");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([
    { appUserId: "" }, { usageItemId: "" }, { userScope: "" }, { usageScope: "" }, { environment: "" },
  ])("does not turn missing or invalid scope into a bulk reset: %j", async (override) => {
    await expect(resetUserUsage({ ...base, ...override } as typeof base)).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("propagates audit failure to the transaction for rollback", async () => {
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(resetUserUsage(base)).rejects.toThrow("audit unavailable");
  });
});
