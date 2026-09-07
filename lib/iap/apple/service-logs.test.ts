import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), find: vi.fn(), log: vi.fn(), owner: vi.fn() }));
vi.mock("./client", () => ({ verifyAppleTransaction: mocks.verify }));
vi.mock("./logs", async (original) => ({ ...await original<typeof import("./logs")>(), recordAppleLog: mocks.log }));
vi.mock("@/lib/iap/configuration", () => ({ findAppleAccountByToken: mocks.find }));
vi.mock("@/lib/subscription/subscriptions", () => ({}));
vi.mock("@/lib/subscription/topups", () => ({}));
vi.mock("@/lib/subscription/users", () => ({}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.owner }) }) }) } }));
import { fulfillAppleTransaction } from "./service";

const transaction = { appAccountToken: "11111111-1111-4111-8111-111111111111", transactionId: "20001", originalTransactionId: "20000", productId: "plus10", environment: "Sandbox" };
const input = {
  integration: { applicationId: "app" }, environment: "sandbox", signedTransaction: "secret-jws",
  expectedUser: { id: "sandbox-user", applicationId: "app", environment: "sandbox", rxlabUserId: "same-login" },
} as Parameters<typeof fulfillAppleTransaction>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.verify.mockResolvedValue(transaction);
  mocks.find.mockResolvedValue(null);
  mocks.owner.mockResolvedValue([{ id: "production-user", applicationId: "app", environment: "production", rxlabUserId: "same-login" }]);
});

it("persists the unknown token with real transaction IDs without storing the JWS", async () => {
  await expect(fulfillAppleTransaction(input)).rejects.toThrow("unknown");
  expect(mocks.log).toHaveBeenCalledWith("app", "sandbox-user", "account_token_rejected", expect.objectContaining({
    level: "error", error: "unknown_token", accountToken: transaction.appAccountToken, transactionId: "20001", originalTransactionId: "20000",
  }));
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("secret-jws");
});

it("preserves cross-environment ownership evidence without weakening rejection", async () => {
  mocks.find.mockResolvedValue({ id: "old-link", applicationId: "app", appUserId: "production-user" });
  await expect(fulfillAppleTransaction(input)).rejects.toThrow("another user");
  expect(mocks.log).toHaveBeenCalledWith("app", "sandbox-user", "account_token_rejected", expect.objectContaining({
    error: "user_mismatch", info: expect.objectContaining({ sameIdentity: true, owner: expect.objectContaining({ environment: "production" }) }),
  }));
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("same-login");
});
