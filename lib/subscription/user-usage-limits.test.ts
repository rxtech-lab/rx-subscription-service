import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

const settings = vi.hoisted(() => ({ resetPolicy: "never" }));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  return { db: drizzle(client), testClient: client };
});
vi.mock("./users", () => ({
  requireAppUser: async (applicationId: string, appUserId: string) => {
    const [user] = await db.select({ id: appUsers.id }).from(appUsers)
      .where(and(eq(appUsers.id, appUserId), eq(appUsers.applicationId, applicationId)));
    if (!user) throw new Error("app user not found");
    return { ...user, testClockOffsetMs: 0 };
  },
}));
vi.mock("./usage-items", () => {
  const item = { id: "meter", key: "chat", name: "Chat", defaultLimit: 10, overagePolicy: "block",
    get resetPolicy() { return settings.resetPolicy; }, resetIntervalUnit: "day", resetIntervalCount: 1 };
  return {
    listUsageItems: async () => [item],
    requireUsageItem: async (applicationId: string, id: string) => {
      if (applicationId !== "app" || id !== item.id) throw new Error("usage item not found");
      return item;
    },
  };
});
vi.mock("./entitlements", () => ({
  resolveEntitlements: async ({ appUserId }: { appUserId: string }) => {
    const rows = await db.select().from(appUserUsageLimits).where(eq(appUserUsageLimits.appUserId, appUserId));
    return { usageLimits: Object.fromEntries(rows.map(row => [row.usageItemId, row.limitValue])) };
  },
  getBillingWindow: async () => ({ start: null, end: null }),
}));

import { db } from "@/lib/db";
import { appUsers, appUserUsageLimits, auditLogs } from "@/lib/db/schema";
import { updateUserUsageLimit } from "./user-usage-limits";
import { getUsageStatus, recordUsage } from "./usage";

const owner = { applicationId: "app", appUserId: "user", usageItemId: "meter" };
const base = { ...owner, actor: { type: "user" as const, id: "admin" } };

beforeAll(async () => {
  const ddl = `
    CREATE TABLE app_users (id text PRIMARY KEY, application_id text);
    INSERT INTO app_users VALUES ('user', 'app'), ('other', 'app'), ('foreign', 'elsewhere');
    CREATE TABLE app_user_usage_limits (id text PRIMARY KEY, app_user_id text REFERENCES app_users(id), usage_item_id text, limit_value bigint CHECK(limit_value >= 0), created_at timestamptz, updated_at timestamptz, UNIQUE(app_user_id, usage_item_id));
    CREATE TABLE usage_counters (id text PRIMARY KEY, app_user_id text, usage_item_id text, period_start timestamptz, period_end timestamptz, used bigint NOT NULL DEFAULT 0, limit_value bigint, created_at timestamptz, updated_at timestamptz, UNIQUE(app_user_id, usage_item_id, period_start));
    CREATE TABLE usage_records (id text PRIMARY KEY, app_user_id text, usage_item_id text, counter_id text, amount bigint, used_after bigint, charged_units bigint DEFAULT 0, idempotency_key text UNIQUE, metadata jsonb, created_at timestamptz);
    CREATE TABLE audit_logs (id text PRIMARY KEY, application_id text, actor_type text, actor_id text CHECK(actor_id <> 'reject-audit'), action text, entity_type text, entity_id text, before jsonb, after jsonb, conversation_id text, created_at timestamptz);
  `;
  for (const statement of ddl.split(";").filter(value => value.trim())) await db.execute(sql.raw(statement));
});
beforeEach(async () => {
  settings.resetPolicy = "never";
  await db.execute(sql`TRUNCATE app_user_usage_limits, usage_counters, usage_records, audit_logs`);
});
afterAll(async () => {
  const { testClient } = await import("@/lib/db") as unknown as { testClient: { close(): Promise<void> } };
  await testClient.close();
});

it("changes an existing user's allowance immediately, preserves usage and isolates other users", async () => {
  expect(await recordUsage({ ...owner, amount: 4, idempotencyKey: "first" })).toMatchObject({ allowed: true, used: 4 });
  await updateUserUsageLimit({ ...base, mode: "custom", limitValue: 5 });
  expect(await recordUsage({ ...owner, amount: 2, idempotencyKey: "blocked" })).toMatchObject({ allowed: false, limit: 5, used: 4 });
  expect(await getUsageStatus(owner)).toMatchObject([{ used: 4, limit: 5, remaining: 1 }]);
  expect(await getUsageStatus({ ...owner, appUserId: "other" })).toMatchObject([{ used: 0, limit: 10 }]);
  await updateUserUsageLimit({ ...base, mode: "custom", limitValue: 20 });
  expect(await recordUsage({ ...owner, amount: 8, idempotencyKey: "raised" })).toMatchObject({ allowed: true, used: 12, limit: 20 });
  const audits = await db.select().from(auditLogs);
  expect(audits).toHaveLength(2);
  expect(audits[1]).toMatchObject({ entityId: "user", before: { limitValue: 5 }, after: { limitValue: 20 } });
});

it("supports zero, unlimited, and removing the override without resetting usage", async () => {
  await updateUserUsageLimit({ ...base, mode: "custom", limitValue: 0 });
  expect(await recordUsage({ ...owner, amount: 1, idempotencyKey: "zero" })).toMatchObject({ allowed: false, limit: 0 });
  await updateUserUsageLimit({ ...base, mode: "unlimited" });
  expect(await recordUsage({ ...owner, amount: 100, idempotencyKey: "unlimited" })).toMatchObject({ allowed: true, limit: null });
  await updateUserUsageLimit({ ...base, mode: "default" });
  expect(await db.select().from(appUserUsageLimits)).toEqual([]);
  expect(await getUsageStatus(owner)).toMatchObject([{ used: 100, limit: 10, remaining: 0 }]);
});

it("keeps the override when a new usage period opens", async () => {
  settings.resetPolicy = "calendar_period";
  await updateUserUsageLimit({ ...base, mode: "custom", limitValue: 5 });
  await recordUsage({ ...owner, now: new Date("2026-11-06T12:00:00Z"), amount: 5, idempotencyKey: "today" });
  expect(await recordUsage({ ...owner, now: new Date("2026-11-07T12:00:00Z"), amount: 5, idempotencyKey: "tomorrow" }))
    .toMatchObject({ allowed: true, used: 5, limit: 5, remaining: 0 });
  expect(await getUsageStatus({ ...owner, now: new Date("2026-11-07T12:00:00Z") }))
    .toMatchObject([{ used: 5, limit: 5, remaining: 0 }]);
});

it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined])("rejects invalid custom limits: %s", async (limitValue) => {
  await expect(updateUserUsageLimit({ ...base, mode: "custom", limitValue })).rejects.toThrow("non-negative integer");
  expect(await db.select().from(appUserUsageLimits)).toEqual([]);
});

it.each([
  { appUserId: "foreign" }, { usageItemId: "foreign" }, { mode: "invalid" },
])("rejects foreign entities and invalid modes: %j", async (overrides) => {
  await expect(updateUserUsageLimit({ ...base, mode: "custom", limitValue: 5, ...overrides })).rejects.toThrow();
  expect(await db.select().from(appUserUsageLimits)).toEqual([]);
});

it("rolls back the override when auditing fails", async () => {
  await expect(updateUserUsageLimit({ ...base, mode: "custom", limitValue: 5, actor: { type: "user", id: "reject-audit" } })).rejects.toThrow();
  expect(await db.select().from(appUserUsageLimits)).toEqual([]);
});
