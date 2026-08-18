/**
 * Seed a demo application with a full configuration, and print an API key.
 *
 * Useful for exercising the `/api/v1` surface without going through the console.
 * Talks to libSQL directly rather than through `lib/db`, which is server-only.
 *
 *   bun run scripts/seed-demo.ts
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../lib/db/schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

const id = () => crypto.randomUUID();
const now = new Date();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function main() {
  const applicationId = "demo-app";

  await db
    .insert(schema.applications)
    .values({
      id: applicationId,
      name: "Demo App",
      description: "Seeded by scripts/seed-demo.ts",
      status: "active",
      defaultCurrency: "usd",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const unitId = id();
  await db
    .insert(schema.balanceUnits)
    .values({
      id: unitId,
      applicationId,
      key: "points",
      name: "Points",
      symbol: "pts",
      precision: 0,
      kind: "points",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  // 1000 points for $1.50 → 150 cents * 1e9 / 1000 = 150,000,000 nano-cents each.
  await db
    .insert(schema.pointRates)
    .values({
      id: id(),
      applicationId,
      unitId,
      currency: "usd",
      nanoMinorPerUnit: Math.round((150 * 1_000_000_000) / 1000),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  // Blocks at 3 per day so the limit is easy to hit from a shell.
  const usageItemId = id();
  await db
    .insert(schema.usageItems)
    .values({
      id: usageItemId,
      applicationId,
      key: "api_calls",
      name: "API calls",
      valueType: "counter",
      resetPolicy: "calendar_period",
      resetIntervalCount: 1,
      resetIntervalUnit: "day",
      defaultLimit: 3,
      overagePolicy: "block",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const roleId = id();
  await db
    .insert(schema.subscriptionRoles)
    .values({
      id: roleId,
      applicationId,
      key: "pro",
      title: "Pro subscriber",
      isDefault: false,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const freeRoleId = id();
  await db
    .insert(schema.subscriptionRoles)
    .values({
      id: freeRoleId,
      applicationId,
      key: "free",
      title: "Free user",
      isDefault: true,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const permissionId = id();
  await db
    .insert(schema.permissions)
    .values({
      id: permissionId,
      applicationId,
      key: "read:a",
      title: "Read articles",
      supportsAll: true,
      supportsIds: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.rolePermissions)
    .values({
      id: id(),
      roleId,
      permissionId,
      scope: "all",
      targetIds: [],
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  // The free role only reaches two specific articles — the `read:a:id1,id2` form.
  await db
    .insert(schema.rolePermissions)
    .values({
      id: id(),
      roleId: freeRoleId,
      permissionId,
      scope: "selected",
      targetIds: ["a1", "a2"],
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const planId = id();
  await db
    .insert(schema.plans)
    .values({
      id: planId,
      applicationId,
      key: "pro",
      name: "Pro",
      description: "Everything, monthly",
      billingInterval: "month",
      intervalCount: 1,
      priceAmountCents: 1900,
      currency: "usd",
      trialDays: 14,
      status: "active",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.planEntitlements)
    .values([
      {
        id: id(),
        planId,
        kind: "role",
        roleId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        planId,
        kind: "usage_limit",
        usageItemId,
        limitValue: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        planId,
        kind: "balance_grant",
        unitId,
        amount: 10_000,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();

  const topupId = id();
  await db
    .insert(schema.topupProducts)
    .values({
      id: topupId,
      applicationId,
      key: "points_5000",
      name: "5,000 points",
      unitId,
      amount: 5000,
      priceAmountCents: 750,
      currency: "usd",
      status: "active",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  // Gate it, so the catalog reports this pack as locked for a free user.
  await db
    .insert(schema.topupEligibilityRules)
    .values({
      id: id(),
      topupProductId: topupId,
      ruleType: "requires_active_plan",
      planId,
      createdAt: now,
    })
    .onConflictDoNothing();

  const secret = `rxs_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  await db.insert(schema.applicationApiKeys).values({
    id: id(),
    applicationId,
    name: "demo seed key",
    keyPrefix: secret.slice(0, 12),
    hashedKey: await sha256(secret),
    createdAt: now,
  });

  console.log(
    JSON.stringify(
      { applicationId, planId, topupId, unitId, usageItemId, apiKey: secret },
      null,
      2,
    ),
  );
}

await main();
