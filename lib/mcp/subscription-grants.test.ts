import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown, access: vi.fn() }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/console/session", () => ({
  requireConsoleUser: async () => ({ id: "admin" }),
  requireApplicationAccess: state.access,
}));
vi.mock("@/lib/rxlab/oauth-clients", () => ({
  listAllOAuthClients: async () => [{ id: "app", name: "App" }],
}));
import { seal } from "./oauth";
import { callTool, toolCatalog } from "./tools";
import { grantSubscriptionAction } from "@/app/actions/subscriptions";

const pg = new PGlite();
const db = drizzle(pg, { schema });
state.db = db;
const input = { appUserId: "sandbox-user", environment: "sandbox", planId: "plan", periodDays: 30, reason: "Support credit" };
const now = new Date();
function grant(scopes = ["subscriptions:write"]) {
  return { userId: "admin", applicationIds: ["app"], scopes, upstreamToken: seal("test") } as schema.McpGrant;
}
function form(patch: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...input, applicationId: "app", operationId: "dashboard-grant", ...patch })) data.set(key, String(value));
  return data;
}
beforeAll(async () => {
  process.env.AUTH_SECRET = "test-grants-secret";
  for (const file of readdirSync("drizzle").filter((file) => file.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  }
}, 30000);
beforeEach(async () => {
  state.access.mockReset();
  await pg.exec("TRUNCATE applications CASCADE");
  await db.insert(schema.applications).values({ id: "app", name: "App", createdAt: now, updatedAt: now });
  await db.insert(schema.appUsers).values(["sandbox", "production"].map((environment) => ({
    id: `${environment}-user`, applicationId: "app", rxlabUserId: "same-person",
    environment: environment as "sandbox" | "production", createdAt: now, updatedAt: now,
  })));
  await db.insert(schema.plans).values({ id: "plan", applicationId: "app", key: "pro", name: "Pro", billingInterval: "month", priceAmountCents: 1000, status: "active", createdAt: now, updatedAt: now });
});
afterAll(async () => { await pg.close(); });

it("exposes the grant only with write scope and requires explicit approval and environment", async () => {
  expect(toolCatalog(grant(["subscriptions:read"])).map((tool) => tool.name)).not.toContain("grantComplimentarySubscription");
  expect(toolCatalog(grant()).map((tool) => tool.name)).toContain("grantComplimentarySubscription");
  await expect(callTool(grant(["subscriptions:read"]), "grantComplimentarySubscription", {})).rejects.toMatchObject({ code: "insufficient_scope" });
  await expect(callTool(grant(), "grantComplimentarySubscription", { applicationId: "app", input })).rejects.toThrow();
  await expect(callTool(grant(), "grantComplimentarySubscription", { applicationId: "app", confirmed: true, input: { ...input, environment: undefined } })).rejects.toThrow();
  await expect(callTool(grant(), "grantComplimentarySubscription", { applicationId: "other", confirmed: true, input })).rejects.toMatchObject({ code: "access_denied" });
  expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
});
it.each(["sandbox", "production"])("MCP grants only the selected %s user and refuses a conflicting grant", async (environment) => {
  const args = { applicationId: "app", confirmed: true, input: { ...input, appUserId: `${environment}-user`, environment } };
  expect(await callTool(grant(), "grantComplimentarySubscription", args)).toMatchObject({ ok: true, result: { environment, subscription: { billingProvider: "complimentary", cancelAtPeriodEnd: true } } });
  expect(await callTool(grant(), "grantComplimentarySubscription", args)).toMatchObject({ ok: false });
  const rows = await db.select().from(schema.subscriptions);
  expect(rows).toHaveLength(1);
  expect(rows[0].appUserId).toBe(`${environment}-user`);
  expect(rows[0].currentPeriodEnd!.getTime() - rows[0].currentPeriodStart!.getTime()).toBe(30 * 86400000);
});
it("rejects mismatched environments through dashboard and MCP", async () => {
  expect(await grantSubscriptionAction({}, form({ environment: "production" }))).toMatchObject({ error: expect.stringContaining("not production") });
  expect(await callTool(grant(), "grantComplimentarySubscription", { applicationId: "app", confirmed: true, input: { ...input, environment: "production" } })).toMatchObject({ ok: false });
  expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
});
it("authorizes dashboard grants, validates duration, and safely replays a submitted form", async () => {
  expect(await grantSubscriptionAction({}, form({ periodDays: "1.5" }))).toHaveProperty("error");
  expect(await grantSubscriptionAction({}, form())).toHaveProperty("success");
  expect(await grantSubscriptionAction({}, form())).toHaveProperty("success");
  expect(state.access).toHaveBeenCalledWith("app");
  expect(await db.select().from(schema.subscriptions)).toHaveLength(1);
});
it("rejects dashboard submissions when application access is denied", async () => {
  const error = new Error("Denied");
  error.name = "ApplicationAccessError";
  state.access.mockRejectedValue(error);
  expect(await grantSubscriptionAction({}, form())).toEqual({ error: "Denied" });
  expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
});
