import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import { E2E_DATABASE_URL, E2E_SECRET } from "./fixtures";

/**
 * Catalog ordering and the console's topup status filter, on an application of
 * their own so neither assertion can be disturbed by another spec's seed data.
 *
 * Every row here is seeded with a `sortOrder` that runs *against* its price:
 * the catalog is only proving it sorts by price if the cheapest item is also
 * the one configured to come last.
 */
const APP = "e2e-catalog-order-app";
const UNIT = "e2e-catalog-order-unit";
const API_KEY = `rxs_production_catalogorder${"0".repeat(50)}`;
const headers = { "X-Api-Key": API_KEY, "X-E2E-Secret": E2E_SECRET };

const client = postgres(E2E_DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });

const TOPUPS = [
  { id: "e2e-order-topup-large", key: "large", name: "Large pack", priceAmountCents: 4_999, status: "active", sortOrder: 0 },
  { id: "e2e-order-topup-small", key: "small", name: "Small pack", priceAmountCents: 499, status: "active", sortOrder: 1 },
  { id: "e2e-order-topup-medium", key: "medium", name: "Medium pack", priceAmountCents: 1_999, status: "active", sortOrder: 2 },
  { id: "e2e-order-topup-draft", key: "draft", name: "Draft pack", priceAmountCents: 99, status: "draft", sortOrder: 3 },
  { id: "e2e-order-topup-archived", key: "archived", name: "Archived pack", priceAmountCents: 1, status: "archived", sortOrder: 4 },
] as const;

const PLANS = [
  { id: "e2e-order-plan-yearly", key: "yearly", name: "Yearly plan", priceAmountCents: 9_999, sortOrder: 0 },
  { id: "e2e-order-plan-free", key: "free", name: "Free plan", priceAmountCents: 0, sortOrder: 1 },
  { id: "e2e-order-plan-monthly", key: "monthly", name: "Monthly plan", priceAmountCents: 999, sortOrder: 2 },
] as const;

test.beforeAll(async () => {
  const now = new Date();
  await db.insert(schema.applications).values({
    id: APP, name: "Catalog ordering", createdAt: now, updatedAt: now,
  });
  await db.insert(schema.applicationApiKeys).values({
    id: `${APP}-production`, applicationId: APP, environment: "production",
    name: "Catalog ordering test", keyPrefix: API_KEY.slice(0, 20),
    hashedKey: createHash("sha256").update(API_KEY).digest("hex"), createdAt: now,
  });
  await db.insert(schema.balanceUnits).values({
    id: UNIT, applicationId: APP, key: "points", name: "Points",
    createdAt: now, updatedAt: now,
  });
  await db.insert(schema.topupProducts).values(
    TOPUPS.map((topup) => ({
      ...topup, applicationId: APP, unitId: UNIT, amount: 100,
      createdAt: now, updatedAt: now,
    })),
  );
  await db.insert(schema.plans).values(
    PLANS.map((plan) => ({
      ...plan, applicationId: APP, billingInterval: "month" as const,
      planGroup: plan.key, status: "active" as const, createdAt: now, updatedAt: now,
    })),
  );
});

test.afterAll(async () => {
  await db.delete(schema.applications).where(eq(schema.applications.id, APP));
  await client.end();
});

test("the catalog returns plans and topups cheapest first", async ({ request }) => {
  const response = await request.get("/api/v1/catalog", { headers });
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as {
    plans: { key: string; priceAmountCents: number }[];
    topups: { key: string; priceAmountCents: number }[];
  };

  // Seeded sort order is large, small, medium — price order is the opposite.
  expect(body.topups.map((topup) => topup.key)).toEqual(["small", "medium", "large"]);
  expect(body.plans.map((plan) => plan.key)).toEqual(["free", "monthly", "yearly"]);

  for (const list of [body.plans, body.topups]) {
    const prices = list.map((item) => item.priceAmountCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  }
});

test("the console topups page filters by status from the URL", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET },
  });
  const page = await context.newPage();
  try {
    const rows = page.locator("tbody tr");

    await page.goto(`/apps/${APP}/topups`);
    await expect(page.getByRole("link", { name: "All 5" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(rows).toHaveCount(TOPUPS.length);

    await page.getByRole("link", { name: "Active 3" }).click();
    await expect(page).toHaveURL(new RegExp(`/apps/${APP}/topups\\?tab=active$`));
    await expect(rows).toHaveCount(3);
    await expect(page.getByText("Archived pack")).toHaveCount(0);
    await expect(page.getByText("Draft pack")).toHaveCount(0);

    await page.getByRole("link", { name: "Archived 1" }).click();
    await expect(page).toHaveURL(new RegExp(`/apps/${APP}/topups\\?tab=archived$`));
    await expect(rows).toHaveCount(1);
    await expect(page.getByText("Archived pack")).toBeVisible();

    // The filter lives in the URL, so a deep link opens already filtered.
    await page.goto(`/apps/${APP}/topups?tab=active`);
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Active 3" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  } finally {
    await context.close();
  }
});
