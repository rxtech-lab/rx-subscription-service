import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ where: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/lib/db", () => ({ db: { select: () => {
  const chain = { from: () => chain, where: (condition: unknown) => { mocks.where(condition); return chain; },
    orderBy: () => chain, limit: () => chain, offset: async () => mocks.rows };
  return chain;
} } }));
import { listApplicationLogs, redactLogValue } from "./application-logs";

beforeEach(() => { vi.clearAllMocks(); mocks.rows = []; });

it("keeps every query scoped to the app without restricting event types", async () => {
  await listApplicationLogs("selected-app");
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0] as SQL);
  expect(query.sql).toContain('"application_id" =');
  expect(query.params).toEqual(["selected-app"]);
  expect(query.sql).not.toContain('"entity_type" =');
});

it("parameterizes exact filters including transaction IDs", async () => {
  await listApplicationLogs("app", { action: "subscription.create", transactionId: "123" });
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0] as SQL);
  expect(query.params).toEqual(["app", "subscription.create", "123", "123"]);
});

it("redacts nested credentials while retaining useful Apple identifiers", () => {
  expect(redactLogValue({ accountToken: "uuid", transactionId: "123", info: [{ privateKey: "secret", accessToken: "secret" }], signedTransactionInfo: "jws" }))
    .toEqual({ accountToken: "uuid", transactionId: "123", info: [{ privateKey: "[redacted]", accessToken: "[redacted]" }], signedTransactionInfo: "[redacted]" });
});

it("returns bounded pages and redacts both snapshots", async () => {
  mocks.rows = Array.from({ length: 101 }, (_, id) => ({ id, before: { password: "secret" }, after: { clientSecret: "secret" } }));
  const result = await listApplicationLogs("app", { offset: 100 });
  expect(result.logs).toHaveLength(100);
  expect(result.nextOffset).toBe(200);
  expect(result.logs[0].before).toEqual({ password: "[redacted]" });
  expect(result.logs[0].after).toEqual({ clientSecret: "[redacted]" });
});

it("includes IAP diagnostics and store configuration in the IAP category", async () => {
  await listApplicationLogs("app", { category: "iap" });
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0] as SQL);
  expect(query.sql).toContain("split_part");
  expect(query.params).toEqual(["app", "apple_iap", "apple_store", "store_product"]);
});
