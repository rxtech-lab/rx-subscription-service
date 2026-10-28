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
vi.mock("@/lib/testing/automation", () => ({ scheduleAutomaticTestRuns: vi.fn() }));
import { deleteBalanceUnitAction } from "@/app/actions/catalog";

const pg = new PGlite();
const db = drizzle(pg, { schema });
state.db = db;
const now = new Date();
function form(applicationId = "app") {
  const data = new FormData();
  data.set("applicationId", applicationId);
  data.set("unitId", "points");
  return data;
}
beforeAll(async () => {
  for (const file of readdirSync("drizzle").filter((file) => file.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  }
}, 30000);
beforeEach(async () => {
  state.access.mockReset();
  await pg.exec("TRUNCATE applications CASCADE");
  await db.insert(schema.applications).values({ id: "app", name: "App", createdAt: now, updatedAt: now });
  await db.insert(schema.balanceUnits).values({ id: "points", applicationId: "app", key: "points", name: "Points", createdAt: now, updatedAt: now });
});
afterAll(async () => { await pg.close(); });

it("deletes an unused unit and records the audit", async () => {
  expect(await deleteBalanceUnitAction({}, form())).toEqual({ success: "Unit deleted." });
  expect(await db.select().from(schema.balanceUnits)).toHaveLength(0);
  expect(await db.select().from(schema.auditLogs)).toMatchObject([{ action: "balance_unit.delete", entityId: "points" }]);
});

it.each(["primary", "bonus"])("returns an actionable error for a unit used as a %s topup grant", async (kind) => {
  await db.insert(schema.balanceUnits).values({ id: "gold", applicationId: "app", key: "gold", name: "Gold", createdAt: now, updatedAt: now });
  await db.insert(schema.topupProducts).values({
    id: "pack", applicationId: "app", key: "pack", name: "Pack",
    unitId: kind === "primary" ? "points" : "gold", amount: 100, priceAmountCents: 100,
    createdAt: now, updatedAt: now,
  });
  if (kind === "bonus") {
    await db.insert(schema.topupProductGrants).values({ id: "bonus", topupProductId: "pack", unitId: "points", amount: 10, createdAt: now });
  }
  expect(await deleteBalanceUnitAction({}, form())).toEqual({ error: expect.stringContaining("Remove those references") });
  expect(await db.select().from(schema.balanceUnits)).toHaveLength(2);
  expect(await db.select().from(schema.topupProducts)).toHaveLength(1);
  expect(await db.select().from(schema.auditLogs)).toHaveLength(0);
});

it("does not delete another application's unit", async () => {
  expect(await deleteBalanceUnitAction({}, form("other"))).toHaveProperty("error");
  expect(await db.select().from(schema.balanceUnits)).toHaveLength(1);
});

it("returns denied access without deleting the unit", async () => {
  const error = new Error("Denied");
  error.name = "ApplicationAccessError";
  state.access.mockRejectedValue(error);
  expect(await deleteBalanceUnitAction({}, form())).toEqual({ error: "Denied" });
  expect(await db.select().from(schema.balanceUnits)).toHaveLength(1);
});
