import { expect, test } from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_DEFAULT_PLAN_API_KEY,
  E2E_DEFAULT_PLAN_APPLICATION_ID,
  E2E_DEFAULT_PLAN_ID,
  E2E_DEFAULT_PLAN_PAID_ID,
  E2E_SECRET,
} from "./fixtures";

const headers = {
  "Content-Type": "application/json",
  "X-Api-Key": E2E_DEFAULT_PLAN_API_KEY,
};

test("automatically subscribes a user to the free default plan exactly once", async ({
  request,
}) => {
  const rxlabUserId = `free-default-${crypto.randomUUID()}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
      headers,
      params: { rxlabUserId },
    });
    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      plans: [
        {
          planId: E2E_DEFAULT_PLAN_ID,
          status: "active",
          billingProvider: "internal",
        },
      ],
      features: { free_access: "enabled" },
      balances: [
        {
          unit: "free_points",
          amount: 100,
          available: 100,
        },
      ],
      usage: [
        {
          key: "free_actions",
          limit: 5,
          remaining: 5,
        },
      ],
    });
  }
});

test("a paid plan replaces the automatic free plan in the same group", async ({
  request,
}) => {
  const rxlabUserId = `free-upgrade-${crypto.randomUUID()}`;
  const initial = await request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
    headers,
    params: { rxlabUserId },
  });
  expect(initial.ok()).toBe(true);

  const upgrade = await request.post(`${E2E_BASE_URL}/api/e2e/subscriptions`, {
    headers: { ...headers, "X-E2E-Secret": E2E_SECRET },
    data: { rxlabUserId, planId: E2E_DEFAULT_PLAN_PAID_ID },
  });
  expect(upgrade.ok()).toBe(true);

  const body = await upgrade.json();
  expect(body.entitlements.plans).toEqual([
    expect.objectContaining({
      planId: E2E_DEFAULT_PLAN_PAID_ID,
      status: "active",
      billingProvider: "stripe",
    }),
  ]);
});

test("the plan setting is visible and automatic plans do not offer checkout", async ({
  browser,
  request,
}) => {
  const catalog = await request.get(`${E2E_BASE_URL}/api/v1/catalog`, {
    headers,
    params: { rxlabUserId: `free-catalog-${crypto.randomUUID()}` },
  });
  expect(catalog.ok()).toBe(true);
  await expect(catalog.json()).resolves.toMatchObject({
    plans: expect.arrayContaining([
      expect.objectContaining({
        id: E2E_DEFAULT_PLAN_ID,
        priceAmountCents: 0,
        autoSubscribe: true,
        purchaseOptions: [],
      }),
    ]),
  });

  const checkout = await request.post(`${E2E_BASE_URL}/api/v1/checkout`, {
    headers,
    data: {
      kind: "plan",
      rxlabUserId: `free-checkout-${crypto.randomUUID()}`,
      planId: E2E_DEFAULT_PLAN_ID,
    },
  });
  expect(checkout.status()).toBe(400);
  await expect(checkout.json()).resolves.toMatchObject({
    error: "invalid_request",
    error_description:
      "plan is assigned automatically and does not require checkout",
  });

  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET },
  });
  const page = await context.newPage();
  await page.goto(`/apps/${E2E_DEFAULT_PLAN_APPLICATION_ID}/plans`);
  const row = page.getByRole("row").filter({ hasText: "Free" });
  await expect(row.getByText("auto-enroll", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Actions for Free" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Subscribe users automatically" }),
  ).toBeChecked();
  await context.close();
});

test("rejects automatic subscription on a paid plan", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET },
  });
  const page = await context.newPage();
  await page.goto(`/apps/${E2E_DEFAULT_PLAN_APPLICATION_ID}/plans`);
  await page.getByRole("button", { name: "New plan" }).click();

  const dialog = page.getByRole("dialog", { name: "Create a plan" });
  await dialog.getByLabel("Key").fill(`invalid-${crypto.randomUUID().slice(0, 8)}`);
  await dialog.getByLabel("Name").fill("Invalid paid default");
  await dialog.getByLabel("Plan group").fill("secondary");
  await dialog.getByLabel("Price").fill("5.00");
  await dialog
    .getByRole("checkbox", { name: "Subscribe users automatically" })
    .check();
  await dialog.getByRole("button", { name: "Create plan" }).click();

  await expect(dialog).toContainText(
    "an automatically subscribed plan must be free",
  );
  await context.close();
});

test("allows only one automatic plan in each group", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET },
  });
  const page = await context.newPage();
  await page.goto(`/apps/${E2E_DEFAULT_PLAN_APPLICATION_ID}/plans`);
  await page.getByRole("button", { name: "New plan" }).click();

  const dialog = page.getByRole("dialog", { name: "Create a plan" });
  await dialog.getByLabel("Key").fill(`duplicate-${crypto.randomUUID().slice(0, 8)}`);
  await dialog.getByLabel("Name").fill("Another free plan");
  await dialog.getByLabel("Plan group").fill("primary");
  await dialog.getByLabel("Price").fill("0");
  await dialog
    .getByRole("checkbox", { name: "Subscribe users automatically" })
    .check();
  await dialog.getByRole("button", { name: "Create plan" }).click();

  await expect(dialog).toContainText(
    '"Free" already subscribes users automatically in plan group "primary"',
  );
  await context.close();
});
