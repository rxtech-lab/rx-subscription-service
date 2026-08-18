import { readdir, rm, readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../lib/db/schema";
import {
  E2E_API_KEY,
  E2E_APPLICATION_ID,
  E2E_DAILY_ITEM_ID,
  E2E_DAILY_ITEM_NAME,
  E2E_DATABASE_URL,
  E2E_PERMISSION_ID,
  E2E_PERMISSION_KEY,
  E2E_PLAN_ID,
  E2E_PLAN_USER,
  E2E_ROLE_ID,
  E2E_ROLE_KEY,
  E2E_STANDALONE_USER,
  E2E_UNIT_ID,
  E2E_USAGE_DEFAULT_LIMIT,
  E2E_USAGE_ITEM_ID,
} from "./fixtures";

const databaseUrl = process.env.TURSO_DATABASE_URL ?? E2E_DATABASE_URL;
if (databaseUrl !== E2E_DATABASE_URL) {
  throw new Error("Playwright may only reset its dedicated /tmp database");
}

const databasePath = databaseUrl.slice("file:".length);
await Promise.all(
  [databasePath, `${databasePath}-shm`, `${databasePath}-wal`].map((path) =>
    rm(path, { force: true }),
  ),
);

const client = createClient({ url: databaseUrl });

// Every migration, in order — the schema the app runs against is the sum of
// them, so pinning this to the first one leaves the suite testing a database
// that no environment actually has.
const migrationsDir = new URL("../drizzle/", import.meta.url);
const migrations = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();
for (const file of migrations) {
  await client.executeMultiple(
    await readFile(new URL(file, migrationsDir), "utf8"),
  );
}

const db = drizzle(client, { schema });
const now = new Date();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

await db.insert(schema.applications).values({
  id: E2E_APPLICATION_ID,
  name: "Playwright App",
  status: "active",
  defaultCurrency: "usd",
  createdAt: now,
  updatedAt: now,
});

await db.insert(schema.applicationApiKeys).values({
  id: "e2e-api-key",
  applicationId: E2E_APPLICATION_ID,
  name: "Playwright",
  keyPrefix: E2E_API_KEY.slice(0, 12),
  hashedKey: await sha256(E2E_API_KEY),
  createdAt: now,
});

await db.insert(schema.balanceUnits).values({
  id: E2E_UNIT_ID,
  applicationId: E2E_APPLICATION_ID,
  key: "points",
  name: "Points",
  symbol: "pts",
  precision: 0,
  kind: "points",
  createdAt: now,
  updatedAt: now,
});

await db.insert(schema.subscriptionRoles).values({
  id: E2E_ROLE_ID,
  applicationId: E2E_APPLICATION_ID,
  key: E2E_ROLE_KEY,
  title: "Pro subscriber",
  isDefault: false,
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
});

await db.insert(schema.permissions).values({
  id: E2E_PERMISSION_ID,
  applicationId: E2E_APPLICATION_ID,
  key: E2E_PERMISSION_KEY,
  title: "Read reports",
  supportsAll: true,
  supportsIds: true,
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
});

await db.insert(schema.rolePermissions).values({
  id: "e2e-pro-role-permission",
  roleId: E2E_ROLE_ID,
  permissionId: E2E_PERMISSION_ID,
  scope: "all",
  targetIds: [],
  createdAt: now,
  updatedAt: now,
});

await db.insert(schema.usageItems).values([
  {
    id: E2E_USAGE_ITEM_ID,
    applicationId: E2E_APPLICATION_ID,
    key: "api_calls",
    name: "API calls",
    valueType: "counter",
    resetPolicy: "never",
    defaultLimit: E2E_USAGE_DEFAULT_LIMIT,
    overagePolicy: "block",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: E2E_DAILY_ITEM_ID,
    applicationId: E2E_APPLICATION_ID,
    key: "daily_calls",
    name: E2E_DAILY_ITEM_NAME,
    valueType: "counter",
    // Rolling rather than calendar-aligned, so the window starts at first use
    // and a test never lands near a midnight boundary by accident.
    resetPolicy: "rolling_window",
    resetIntervalCount: 1,
    resetIntervalUnit: "day",
    defaultLimit: 1,
    overagePolicy: "block",
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  },
]);

await db.insert(schema.plans).values({
  id: E2E_PLAN_ID,
  applicationId: E2E_APPLICATION_ID,
  key: "pro",
  name: "Pro",
  billingInterval: "month",
  intervalCount: 1,
  priceAmountCents: 1_900,
  currency: "usd",
  trialDays: 0,
  status: "active",
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
});

await db.insert(schema.planEntitlements).values({
  id: "e2e-pro-role-grant",
  planId: E2E_PLAN_ID,
  kind: "role",
  roleId: E2E_ROLE_ID,
  createdAt: now,
  updatedAt: now,
});

await db.insert(schema.appUsers).values([
  {
    id: "e2e-plan-app-user",
    applicationId: E2E_APPLICATION_ID,
    rxlabUserId: E2E_PLAN_USER,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "e2e-standalone-app-user",
    applicationId: E2E_APPLICATION_ID,
    rxlabUserId: E2E_STANDALONE_USER,
    createdAt: now,
    updatedAt: now,
  },
]);

await db.insert(schema.stripeCustomers).values([
  {
    id: "e2e-plan-customer-row",
    appUserId: "e2e-plan-app-user",
    stripeCustomerId: "cus_e2e_plan",
    createdAt: now,
  },
  {
    id: "e2e-standalone-customer-row",
    appUserId: "e2e-standalone-app-user",
    stripeCustomerId: "cus_e2e_standalone",
    createdAt: now,
  },
]);

client.close();
