import { createHash } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import { TEMPLATES } from "../lib/paywall/templates";
import {
  E2E_DATABASE_URL, E2E_DEFAULT_PLAN_API_KEY, E2E_DEFAULT_PLAN_APPLICATION_ID,
  E2E_DEFAULT_PLAN_ID, E2E_DEFAULT_PLAN_PAID_ID, E2E_DEFAULT_PLAN_UNIT_ID, E2E_SECRET,
} from "./fixtures";

const SOURCE = "e2e-linked-app";
const SECOND = "e2e-linked-chain-app";
const TARGET = E2E_DEFAULT_PLAN_APPLICATION_ID;
const sourceKey = (environment = "production") => `rxs_${environment}_linked${"0".repeat(58)}`;
const chainKey = `rxs_production_linkedchain${"0".repeat(52)}`;
const headers = (key: string) => ({ "X-Api-Key": key });
const client = postgres(E2E_DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });
const topupId = "e2e-linked-topup";
const paywallId = "e2e-linked-paywall";

async function body(response: APIResponse) {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test.beforeAll(async () => {
  const now = new Date();
  await db.insert(schema.applications).values([SOURCE, SECOND].map((id) => ({
    id, name: id === SOURCE ? "Linked mobile app" : "Linked web app", createdAt: now, updatedAt: now,
  })));
  await db.insert(schema.applicationApiKeys).values([
    ...schema.API_ENVIRONMENTS.map((environment) => ({ id: `${SOURCE}-${environment}`, applicationId: SOURCE, environment, secret: sourceKey(environment) })),
    { id: `${SECOND}-production`, applicationId: SECOND, environment: "production" as const, secret: chainKey },
  ].map(({ secret, ...key }) => ({
    ...key, name: "Application link test", keyPrefix: secret.slice(0, 20),
    hashedKey: createHash("sha256").update(secret).digest("hex"), createdAt: now,
  })));
  await db.insert(schema.topupProducts).values({
    id: topupId, applicationId: TARGET, key: "linked_topup", name: "Shared points",
    unitId: E2E_DEFAULT_PLAN_UNIT_ID, amount: 10, priceAmountCents: 100, status: "active",
    createdAt: now, updatedAt: now,
  });
  const spec = TEMPLATES.classic.build();
  await db.insert(schema.paywalls).values({
    id: paywallId, name: "Application link paywall", draftSpec: spec, publishedSpec: spec,
    createdAt: now, updatedAt: now, publishedAt: now,
  });
  await db.insert(schema.paywallVersions).values({
    id: `${paywallId}-v1`, paywallId, version: 1, spec, source: "published",
    actorType: "system", createdAt: now, publishedAt: now,
  });
  await db.update(schema.applications).set({ paywallId }).where(eq(schema.applications.id, TARGET));
  await db.insert(schema.appleStoreIntegrations).values({
    id: "e2e-linked-apple", applicationId: TARGET, bundleId: "com.rxlab.e2e.linked",
    appAppleId: 987654321, enabled: true, createdAt: now, updatedAt: now,
  });
});

test.afterAll(async () => {
  await db.update(schema.applications).set({ linkedApplicationId: null })
    .where(inArray(schema.applications.id, [SOURCE, SECOND, TARGET]));
  await db.delete(schema.applications).where(inArray(schema.applications.id, [SOURCE, SECOND]));
  await db.delete(schema.topupProducts).where(eq(schema.topupProducts.id, topupId));
  await db.delete(schema.paywalls).where(eq(schema.paywalls.id, paywallId));
  await db.delete(schema.appleStoreIntegrations).where(eq(schema.appleStoreIntegrations.id, "e2e-linked-apple"));
  await client.end();
});

test("links in settings, shares live API data and writes, and restores local data on unlink", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setExtraHTTPHeaders({ "X-E2E-Secret": E2E_SECRET });
  const sourceHeaders = headers(sourceKey());
  const targetHeaders = headers(E2E_DEFAULT_PLAN_API_KEY);
  const rxlabUserId = `linked-${crypto.randomUUID()}`;
  const params = { rxlabUserId };
  const seriesParams = {
    ...params,
    from: new Date(Date.now() - 86_400_000).toISOString(),
    to: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const original = await body(await request.get("/api/v1/entitlements", { headers: sourceHeaders, params }));
  expect(original.defaultPlans).toEqual([]);

  const sourceCard = page.getByRole("link").filter({
    has: page.getByRole("heading", { name: "Linked mobile app", exact: true }),
  });
  const targetCard = page.getByRole("link").filter({
    has: page.getByRole("heading", { name: "Default Plan App", exact: true }),
  });
  await page.goto("/");
  await expect(sourceCard).toBeVisible();
  await expect(sourceCard).not.toContainText("Linked to");

  await page.goto(`/apps/${SOURCE}/settings`);
  const picker = page.getByLabel("Link to another app", { exact: false });
  await expect(picker).toHaveValue("");
  await expect(picker.locator(`option[value="${SOURCE}"]`)).toHaveCount(0);
  await picker.selectOption(TARGET);
  await page.getByRole("button", { name: "Save application link" }).click();
  await expect(page.getByRole("link", { name: "Manage shared subscriptions in Default Plan App" })).toBeVisible();
  await page.reload();
  await expect(picker).toHaveValue(TARGET);
  await expect(page.getByRole("link", { name: "Manage shared subscriptions in Default Plan App" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("linked-application-settings.png"), fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: "All applications", exact: true }).last().click();
  await expect(sourceCard).toContainText("Linked to Default Plan App");
  await expect(sourceCard).toContainText("Shared subscriptions and paywall");
  await expect(targetCard).toContainText("Shared with Linked mobile app");
  await page.getByRole("searchbox", { name: "Search applications" }).fill("Default Plan App");
  await expect(sourceCard).toBeVisible();
  await expect(targetCard).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.locator('section[aria-labelledby="applications-heading"]').screenshot({
    path: testInfo.outputPath("application-list-links.png"), caret: "initial",
  });

  const catalog = await body(await request.get("/api/v1/catalog", { headers: sourceHeaders }));
  expect(catalog).toEqual(await body(await request.get("/api/v1/catalog", { headers: targetHeaders })));
  expect(catalog.plans).toEqual(expect.arrayContaining([expect.objectContaining({ id: E2E_DEFAULT_PLAN_ID })]));
  expect(catalog.topups).toEqual(expect.arrayContaining([expect.objectContaining({ id: topupId, name: "Shared points" })]));
  await db.update(schema.topupProducts).set({ name: "Updated shared points" }).where(eq(schema.topupProducts.id, topupId));
  const updated = await body(await request.get("/api/v1/catalog", { headers: sourceHeaders }));
  expect(updated.topups).toEqual(expect.arrayContaining([expect.objectContaining({ id: topupId, name: "Updated shared points" })]));

  const shared = await body(await request.get("/api/v1/entitlements", { headers: sourceHeaders, params }));
  const target = await body(await request.get("/api/v1/entitlements", { headers: targetHeaders, params }));
  expect(shared).toEqual(target);
  expect(shared.user.id).not.toBe(original.user.id);
  expect(shared.defaultPlans).toEqual([expect.objectContaining({ planId: E2E_DEFAULT_PLAN_ID })]);
  expect(shared.balances).toEqual([expect.objectContaining({ unit: "free_points", amount: 100 })]);

  const debit = { rxlabUserId, unit: "free_points", amount: 10, operation: "debit", idempotencyKey: `linked-debit-${crypto.randomUUID()}` };
  const firstDebit = await body(await request.post("/api/v1/balances", { headers: sourceHeaders, data: debit }));
  const retryDebit = await body(await request.post("/api/v1/balances", { headers: targetHeaders, data: debit }));
  expect(retryDebit).toMatchObject({ entryId: firstDebit.entryId, duplicate: true, balanceAfter: 90 });

  const usage = { rxlabUserId, item: "free_actions", amount: 1, idempotencyKey: `linked-usage-${crypto.randomUUID()}` };
  await body(await request.post("/api/v1/usage", { headers: sourceHeaders, data: usage }));
  await body(await request.post("/api/v1/usage", { headers: targetHeaders, data: usage }));
  const sharedUsage = await body(await request.get("/api/v1/usage", { headers: targetHeaders, params }));
  expect(sharedUsage.usage).toEqual([expect.objectContaining({ key: "free_actions", used: 1 })]);

  const reservation = await body(await request.post("/api/v1/balances/reserve", {
    headers: sourceHeaders, data: { rxlabUserId, unit: "free_points", amount: 20, idempotencyKey: `linked-reserve-${crypto.randomUUID()}` },
  }));
  const reservationPath = `/api/v1/balances/reservations/${reservation.reservationId}`;
  await body(await request.get(reservationPath, { headers: targetHeaders }));
  expect((await request.get(reservationPath, { headers: headers(sourceKey("sandbox")) })).status()).toBe(404);
  await body(await request.post(`${reservationPath}/release`, {
    headers: targetHeaders, data: { idempotencyKey: `linked-release-${crypto.randomUUID()}` },
  }));

  for (const environment of ["xcode", "sandbox"]) {
    const isolated = await body(await request.get("/api/v1/entitlements", { headers: headers(sourceKey(environment)), params }));
    expect(isolated.user.id).not.toBe(shared.user.id);
    expect(isolated.balances).toEqual([expect.objectContaining({ amount: 100 })]);
    expect(isolated.usage).toEqual([expect.objectContaining({ used: 0 })]);
  }
  for (const endpoint of ["balances", "purchases", "invoices", "balances/ledger", "balances/consumption", "usage/statistics", "paywall"]) {
    const left = await body(await request.get(`/api/v1/${endpoint}`, { headers: sourceHeaders, params: seriesParams }));
    const right = await body(await request.get(`/api/v1/${endpoint}`, { headers: targetHeaders, params: seriesParams }));
    expect(left).toEqual(right);
  }
  const accountToken = await body(await request.post("/api/v1/iap/apple/account-token", { headers: sourceHeaders, data: params }));
  expect(await body(await request.post("/api/v1/iap/apple/account-token", { headers: targetHeaders, data: params }))).toEqual(accountToken);
  await body(await request.post("/api/v1/checkout", {
    headers: sourceHeaders, data: { ...params, kind: "topup", topupId },
  }));
  const [purchase] = await db.select().from(schema.purchases).where(eq(schema.purchases.appUserId, shared.user.id));
  expect(purchase).toMatchObject({ applicationId: TARGET, topupProductId: topupId });
  await body(await request.post("/api/e2e/subscriptions", {
    headers: { ...targetHeaders, "X-E2E-Secret": E2E_SECRET },
    data: { ...params, planId: E2E_DEFAULT_PLAN_PAID_ID },
  }));
  const subscribed = await body(await request.get("/api/v1/entitlements", { headers: sourceHeaders, params }));
  expect(subscribed.plans).toEqual([expect.objectContaining({ planId: E2E_DEFAULT_PLAN_PAID_ID, status: "active" })]);
  expect(subscribed).toEqual(await body(await request.get("/api/v1/entitlements", { headers: targetHeaders, params })));

  // A second app may link through the first; the target picker prevents cycles.
  await page.goto(`/apps/${SECOND}/settings`);
  await picker.selectOption(SOURCE);
  await page.getByRole("button", { name: "Save application link" }).click();
  await expect(page.getByRole("link", { name: "Manage shared subscriptions in Default Plan App" })).toBeVisible();
  expect((await body(await request.get("/api/v1/entitlements", { headers: headers(chainKey), params }))).user.id).toBe(shared.user.id);
  await page.getByRole("link", { name: "All applications", exact: true }).last().click();
  const chainCard = page.getByRole("link").filter({
    has: page.getByRole("heading", { name: "Linked web app", exact: true }),
  });
  await expect(chainCard).toContainText("Linked to Linked mobile app");
  await expect(chainCard).toContainText("Uses Default Plan App's subscriptions and paywall");
  await expect(targetCard).toContainText("Shared with Linked mobile app, Linked web app");
  await page.goto(`/apps/${TARGET}/settings`);
  await expect(picker.locator(`option[value="${SOURCE}"]`)).toHaveCount(0);
  await expect(picker.locator(`option[value="${SECOND}"]`)).toHaveCount(0);

  // A disabled data owner must fail closed for every alias.
  await db.update(schema.applications).set({ status: "disabled" }).where(eq(schema.applications.id, TARGET));
  try {
    const disabled = await request.get("/api/v1/catalog", { headers: sourceHeaders });
    expect(disabled.status()).toBe(403);
    expect(await disabled.json()).toMatchObject({ error: "application_disabled" });
  } finally {
    await db.update(schema.applications).set({ status: "active" }).where(eq(schema.applications.id, TARGET));
  }

  await page.goto(`/apps/${SOURCE}/settings`);
  await picker.selectOption("");
  await page.getByRole("button", { name: "Save application link" }).click();
  await expect(page.getByRole("link", { name: "Manage shared subscriptions in Default Plan App" })).not.toBeVisible();
  await page.reload();
  await expect(picker).toHaveValue("");
  await page.getByRole("link", { name: "All applications", exact: true }).last().click();
  await expect(sourceCard).not.toContainText("Linked to");
  await expect(sourceCard).toContainText("Shared with Linked web app");
  await expect(targetCard).not.toContainText("Shared with");
  expect(await body(await request.get("/api/v1/entitlements", { headers: sourceHeaders, params }))).toEqual(original);
  expect((await body(await request.get("/api/v1/entitlements", { headers: targetHeaders, params }))).user.id).toBe(shared.user.id);
  const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.applicationId, SOURCE));
  expect(audit.filter((entry) => entry.action === "application.link.update").map((entry) => entry.after)).toEqual([
    { linkedApplicationId: TARGET }, { linkedApplicationId: null },
  ]);
});

test("concurrent reciprocal links cannot create a cycle", async ({ browser }) => {
  await db.update(schema.applications).set({ linkedApplicationId: null })
    .where(inArray(schema.applications.id, [SOURCE, SECOND]));
  const linkAuditCount = async () => {
    const audits = await db.select().from(schema.auditLogs)
      .where(inArray(schema.auditLogs.applicationId, [SOURCE, SECOND]));
    return audits.filter((entry) => entry.action === "application.link.update").length;
  };
  const initialAuditCount = await linkAuditCount();
  const context = await browser.newContext({ extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET } });
  try {
    const left = await context.newPage();
    const right = await context.newPage();
    await Promise.all([left.goto(`/apps/${SOURCE}/settings`), right.goto(`/apps/${SECOND}/settings`)]);
    await left.getByLabel("Link to another app", { exact: false }).selectOption(SECOND);
    await right.getByLabel("Link to another app", { exact: false }).selectOption(SOURCE);
    await Promise.all([
      left.getByRole("button", { name: "Save application link" }).click(),
      right.getByRole("button", { name: "Save application link" }).click(),
    ]);
    // Both forms were prepared from the old graph. One must reject after the
    // first transaction commits, regardless of which request acquired the lock.
    await expect.poll(linkAuditCount).toBe(initialAuditCount + 1);
    await expect.poll(async () => [
      await left.getByText("Application links cannot form a circle.", { exact: true }).count(),
      await right.getByText("Application links cannot form a circle.", { exact: true }).count(),
    ].some((count) => count > 0)).toBe(true);
    const rows = await db.select().from(schema.applications)
      .where(inArray(schema.applications.id, [SOURCE, SECOND]));
    expect(rows.filter((row) => row.linkedApplicationId !== null)).toHaveLength(1);
  } finally {
    await context.close();
  }
});
