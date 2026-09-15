import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(), execute: vi.fn(), set: vi.fn(), audit: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/subscription/shared", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/subscription/shared")>(),
  recordAudit: mocks.audit,
}));
import { updateApplicationLink } from "./links";

const row = (id: string, linkedApplicationId: string | null = null, status = "active") => ({
  id, name: id, linkedApplicationId, status,
});
const input = {
  applicationId: "a", linkedApplicationId: "b" as string | null,
  managedApplicationIds: ["a", "b", "c"], actor: { type: "user" as const, id: "admin" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.set.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mocks.transaction.mockImplementation(async (run) => run({
    execute: mocks.execute,
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }),
    update: () => ({ set: mocks.set }),
  }));
});

describe("application link writes", () => {
  it("saves the directional link and its audit within a transaction", async () => {
    mocks.limit.mockResolvedValueOnce([row("a")]).mockResolvedValueOnce([row("b")]);
    await updateApplicationLink(input);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({ linkedApplicationId: "b", updatedAt: expect.any(Date) });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: "a", before: { linkedApplicationId: null }, after: { linkedApplicationId: "b" },
    }), expect.any(Object));
  });

  it("can unlink even when the previous target is no longer accessible", async () => {
    mocks.limit.mockResolvedValueOnce([row("a", "inaccessible")]);
    await updateApplicationLink({ ...input, linkedApplicationId: null, managedApplicationIds: ["a"] });
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ linkedApplicationId: null }));
    expect(mocks.limit).toHaveBeenCalledTimes(1);
  });

  it("rejects an unauthorized source before starting a transaction", async () => {
    await expect(updateApplicationLink({ ...input, managedApplicationIds: ["b"] })).rejects.toThrow("cannot manage");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized target", [row("a")], ["a"], "must be able to manage"],
    ["unauthorized indirect target", [row("a"), row("b", "c")], ["a", "b"], "must be able to manage"],
    ["cycle", [row("a"), row("b", "c"), row("c", "a")], ["a", "b", "c"], "circle"],
    ["disabled target", [row("a"), row("b", null, "disabled")], ["a", "b"], "disabled"],
    ["missing target", [row("a"), null], ["a", "b"], "unavailable"],
  ])("rejects an %s without writing or auditing", async (_name, rows, managedApplicationIds, message) => {
    for (const value of rows) mocks.limit.mockResolvedValueOnce(value ? [value] : []);
    await expect(updateApplicationLink({ ...input, managedApplicationIds })).rejects.toThrow(message);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rejects a self-link", async () => {
    mocks.limit.mockResolvedValueOnce([row("a")]);
    await expect(updateApplicationLink({ ...input, linkedApplicationId: "a" })).rejects.toThrow("circle");
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
