import {
  expect,
  request as createRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  E2E_ADDON_PLAN_ID,
  E2E_API_KEY,
  E2E_APPLICATION_ID,
  E2E_BASE_URL,
  E2E_PLAN_ID,
  E2E_SECOND_PLAN_ID,
  E2E_SECRET,
} from "./fixtures";

test.describe.serial("plan groups", () => {
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await createRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "X-Api-Key": E2E_API_KEY,
        "X-E2E-Secret": E2E_SECRET,
      },
    });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test("rejects repeat and same-group plans but permits a different group", async () => {
    const rxlabUserId = `plan-group-${crypto.randomUUID()}`;
    const grant = await api.post("/api/e2e/subscriptions", {
      data: { rxlabUserId, planId: E2E_PLAN_ID },
    });
    expect(grant.ok()).toBe(true);

    const samePlan = await api.post("/api/v1/checkout", {
      data: { kind: "plan", rxlabUserId, planId: E2E_PLAN_ID },
    });
    expect(samePlan.status()).toBe(400);
    await expect(samePlan.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: expect.stringContaining("already has the \"Pro\" plan"),
    });

    const sameGroup = await api.post("/api/v1/checkout", {
      data: { kind: "plan", rxlabUserId, planId: E2E_SECOND_PLAN_ID },
    });
    expect(sameGroup.status()).toBe(400);
    await expect(sameGroup.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: expect.stringContaining('plan group "default"'),
    });

    const differentGroup = await api.post("/api/v1/checkout", {
      data: { kind: "plan", rxlabUserId, planId: E2E_ADDON_PLAN_ID },
    });
    expect(differentGroup.ok()).toBe(true);
    await expect(differentGroup.json()).resolves.toMatchObject({
      checkoutUrl: expect.any(String),
      sessionId: expect.any(String),
    });

    const grantDifferentGroup = await api.post("/api/e2e/subscriptions", {
      data: { rxlabUserId, planId: E2E_ADDON_PLAN_ID },
    });
    expect(grantDifferentGroup.ok()).toBe(true);

    const repeatDifferentGroup = await api.post("/api/v1/checkout", {
      data: { kind: "plan", rxlabUserId, planId: E2E_ADDON_PLAN_ID },
    });
    expect(repeatDifferentGroup.status()).toBe(400);
    await expect(repeatDifferentGroup.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: expect.stringContaining('already has the "Add-on" plan'),
    });
  });

  test("edits a plan group in the console", async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET },
    });
    const page = await context.newPage();

    await page.goto(`${E2E_BASE_URL}/apps/${E2E_APPLICATION_ID}/plans`);
    const row = page.getByRole("row").filter({ hasText: "Add-on" });
    await row.getByRole("button", { name: "Actions for Add-on" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Edit Add-on" });
    await dialog.getByLabel("Plan group").fill("benefits");
    await dialog.getByRole("button", { name: "Save plan" }).click();

    await expect(dialog).not.toBeVisible();
    await expect(row).toContainText("benefits");
    await context.close();
  });
});
