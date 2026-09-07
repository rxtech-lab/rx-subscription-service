import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), requireIntegration: vi.fn(), verify: vi.fn(), api: vi.fn(),
  info: vi.fn(), setToken: vi.fn(), rows: [] as unknown[][], insert: vi.fn(), update: vi.fn(), remove: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/subscription/users", () => ({ requireAppUser: mocks.requireUser }));
vi.mock("@/lib/iap/configuration", () => ({ requireAppleIntegration: mocks.requireIntegration }));
vi.mock("./client", () => ({ appleApiClient: mocks.api, verifyAppleTransaction: mocks.verify }));
vi.mock("./logs", () => ({ recordAppleLog: mocks.log }));
vi.mock("@/lib/db", () => {
  const tx = {
    select: () => {
      const chain = { from: () => chain, where: () => chain, leftJoin: () => chain,
        for: async () => [], limit: async () => mocks.rows.shift() ?? [] };
      return chain;
    },
    insert: () => ({ values: mocks.insert }),
    update: () => ({ set: (...args: unknown[]) => { mocks.update(...args); return { where: async () => [] }; } }),
    delete: () => ({ where: mocks.remove }),
  };
  return { db: { transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) } };
});

import { manageAppleAccountToken } from "./admin";
import { appleTokenActionSchema } from "./admin-schema";

const token = "11111111-1111-4111-8111-111111111111";
const replacement = "22222222-2222-4222-8222-222222222222";
const user = { id: "user", applicationId: "app", environment: "sandbox", rxlabUserId: "identity" };
const before = { id: "link", providerAccountToken: token };
const input = { appUserId: "user", environment: "sandbox", expectedToken: token, operation: "repair", originalTransactionId: "1234", acknowledged: true };
const run = (args = input) => manageAppleAccountToken("app", { type: "user", id: "admin" }, args);

beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = [[before], [], []];
  mocks.requireUser.mockResolvedValue(user);
  mocks.requireIntegration.mockResolvedValue({ bundleId: "app.bundle" });
  mocks.api.mockReturnValue({ getTransactionInfo: mocks.info, setAppAccountToken: mocks.setToken });
  mocks.info.mockResolvedValue({ signedTransactionInfo: "signed-but-not-logged" });
  mocks.verify.mockResolvedValue({ originalTransactionId: "1234", environment: "Sandbox", bundleId: "app.bundle", appAccountToken: replacement });
  mocks.setToken.mockResolvedValue(undefined);
  mocks.insert.mockResolvedValue(undefined);
});

describe("Apple account administration", () => {
  it("requires explicit acknowledgment and valid IDs", () => {
    expect(appleTokenActionSchema.safeParse({ ...input, acknowledged: false }).success).toBe(false);
    expect(appleTokenActionSchema.safeParse({ ...input, originalTransactionId: "fingerprint" }).success).toBe(false);
    expect(appleTokenActionSchema.safeParse({ ...input, environment: "xcode" }).success).toBe(false);
  });
  it("stops before writes when application authorization lookup fails", async () => {
    mocks.requireUser.mockRejectedValue(new Error("not found"));
    await expect(run()).rejects.toThrow("not found");
    expect(mocks.setToken).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects environment changes and stale forms", async () => {
    await expect(run({ ...input, environment: "production" })).rejects.toThrow("environment changed");
    await expect(run({ ...input, expectedToken: replacement })).rejects.toThrow("Token changed");
    expect(mocks.setToken).not.toHaveBeenCalled();
  });
  it("verifies Apple's environment before updating", async () => {
    mocks.verify.mockResolvedValue({ originalTransactionId: "1234", environment: "Production", bundleId: "app.bundle" });
    await expect(run()).rejects.toThrow("environment mismatch");
    expect(mocks.setToken).not.toHaveBeenCalled();
  });
  it("rejects another identity's token", async () => {
    mocks.rows = [[before], [{ applicationId: "app", identity: "someone-else" }]];
    await expect(run()).rejects.toThrow("another identity");
    expect(mocks.setToken).not.toHaveBeenCalled();
  });
  it("blocks previously fulfilled purchases owned by another user record", async () => {
    mocks.rows = [[before], [{ applicationId: "app", identity: "identity" }], [{ id: "old-fulfillment" }]];
    await expect(run()).rejects.toThrow("reconcile its grants");
    expect(mocks.setToken).not.toHaveBeenCalled();
  });
  it("repairs the verified purchase and audits without granting credits", async () => {
    const result = await run();
    expect(mocks.api).toHaveBeenCalledWith({ bundleId: "app.bundle" }, "sandbox");
    expect(mocks.setToken).toHaveBeenCalledWith("1234", { appAccountToken: token });
    expect(result.message).toContain("No credits");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "apple_iap.token_repair", entityId: "user" }));
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain("signed-but-not-logged");
  });
  it("removes only the mapping and records the former token for recovery", async () => {
    await run({ ...input, operation: "remove" });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ before: { accountToken: token } }));
  });
  it("refuses to bind a token already owned by another user", async () => {
    mocks.rows = [[before], [{ id: "other-link" }]];
    await expect(manageAppleAccountToken("app", { type: "ai", id: "admin" }, { ...input, operation: "bind", token: replacement })).rejects.toThrow("already bound");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
