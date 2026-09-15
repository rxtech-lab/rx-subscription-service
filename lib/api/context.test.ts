import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  resolveApiKey: vi.fn(),
  verifyUserToken: vi.fn(),
  ensureAppUser: vi.fn(),
  syncDefaults: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.limit }) }),
    }),
  },
}));
vi.mock("./keys", () => ({ resolveApiKey: mocks.resolveApiKey }));
vi.mock("./user-token", () => ({
  requireUserTokenIssuer: () => "https://auth.example.test",
  verifyUserToken: mocks.verifyUserToken,
}));
vi.mock("@/lib/subscription/users", () => ({ ensureAppUser: mocks.ensureAppUser }));
vi.mock("@/lib/subscription/subscriptions", () => ({
  syncInternalDefaultSubscriptions: mocks.syncDefaults,
}));

import { authenticateApiRequest, requireKeyScope, resolveRequestUser } from "./context";

const application = (id: string, linkedApplicationId: string | null = null, status = "active") => ({
  id, linkedApplicationId, status, name: id,
});
const request = () => new Request("https://subscription.example.test/api/v1/catalog", {
  headers: { "X-Api-Key": "test-key", Authorization: "Bearer user-token" },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveApiKey.mockResolvedValue({
    applicationId: "a", keyId: "a-key", kind: "secret", environment: "sandbox",
    allowedClientIds: [],
  });
});

describe("linked application API context", () => {
  it("uses the target's data with the source key and environment", async () => {
    mocks.limit.mockResolvedValueOnce([application("a", "b")])
      .mockResolvedValueOnce([application("b")]);
    const context = await authenticateApiRequest(request());
    expect(context).toMatchObject({ application: { id: "b" }, keyId: "a-key", environment: "sandbox" });
    mocks.ensureAppUser.mockResolvedValue({ id: "b-user" });
    await resolveRequestUser(context, { rxlabUserId: "shared-user" });
    expect(mocks.ensureAppUser).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: "b", rxlabUserId: "shared-user", environment: "sandbox",
    }));
    expect(mocks.syncDefaults).toHaveBeenCalledWith({ applicationId: "b", appUserId: "b-user" });
  });

  it("follows a chain to its final application", async () => {
    mocks.limit.mockResolvedValueOnce([application("a", "b")])
      .mockResolvedValueOnce([application("b", "c")])
      .mockResolvedValueOnce([application("c")]);
    expect((await authenticateApiRequest(request())).application.id).toBe("c");
  });

  it("keeps independent applications unchanged", async () => {
    mocks.limit.mockResolvedValueOnce([application("a")]);
    expect((await authenticateApiRequest(request())).application.id).toBe("a");
    expect(mocks.limit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["disabled source", [application("a", "b", "disabled")], "application_disabled"],
    ["disabled target", [application("a", "b"), application("b", null, "disabled")], "application_disabled"],
    ["missing target", [application("a", "b"), null], "invalid_application_link"],
    ["self link", [application("a", "a")], "invalid_application_link"],
    ["circular link", [application("a", "b"), application("b", "a")], "invalid_application_link"],
  ])("rejects a %s without falling back to source data", async (_name, rows, code) => {
    for (const row of rows) mocks.limit.mockResolvedValueOnce(row ? [row] : []);
    await expect(authenticateApiRequest(request())).rejects.toMatchObject({ code, status: 403 });
  });

  it("preserves publishable key identity, client allow-list, and operation restrictions", async () => {
    mocks.resolveApiKey.mockResolvedValue({
      applicationId: "a", keyId: "a-public-key", kind: "publishable", environment: "xcode",
      allowedClientIds: ["a-ios"],
    });
    mocks.limit.mockResolvedValueOnce([application("a", "b")])
      .mockResolvedValueOnce([application("b")]);
    mocks.verifyUserToken.mockResolvedValue({ subject: "signed-in-user", email: null, displayName: null });
    const context = await authenticateApiRequest(request());
    expect(mocks.verifyUserToken).toHaveBeenCalledWith("user-token", {
      issuer: "https://auth.example.test", allowedClientIds: ["a-ios"],
    });
    expect(context).toMatchObject({ application: { id: "b" }, kind: "publishable", environment: "xcode" });
    expect(() => requireKeyScope(context, "balances.adjust")).toThrow();
    await expect(resolveRequestUser(context, { rxlabUserId: "another-user" }))
      .rejects.toMatchObject({ code: "user_mismatch" });
  });
});
