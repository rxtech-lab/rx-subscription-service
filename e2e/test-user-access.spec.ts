import {
  expect,
  request as createRequest,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import {
  E2E_APPLICATION_ID,
  E2E_BASE_URL,
  E2E_DAILY_ITEM_NAME,
  E2E_PERMISSION_KEY,
  E2E_ROLE_ID,
  E2E_ROLE_KEY,
  E2E_SANDBOX_API_KEY,
  E2E_SECRET,
  E2E_USAGE_ITEM_ID,
} from "./fixtures";

/**
 * Roles and usage limits on a test user, exercised the way an admin would: hand
 * the user a role and an allowance, then act as that user in the test app —
 * enter the permission-gated section, spend into the limit, and raise it.
 */
test.describe.serial("test user roles and usage limits", () => {
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await createRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "X-Api-Key": E2E_SANDBOX_API_KEY,
        "X-E2E-Secret": E2E_SECRET,
      },
    });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test("a directly granted role opens the permission-gated section", async ({
    browser,
  }) => {
    const withoutRole = await createTestUser(api, { displayName: "No role" });
    const withRole = await createTestUser(api, {
      displayName: "Role holder",
      roleIds: [E2E_ROLE_ID],
    });

    const locked = await signedInAs(browser, withoutRole.sessionToken);
    const lockedPage = await locked.newPage();
    await lockedPage.goto(`/test/${E2E_APPLICATION_ID}/gated`);
    await expect(lockedPage.getByText("Locked")).toBeVisible();
    await expect(
      lockedPage.locator("code", { hasText: E2E_PERMISSION_KEY }),
    ).toBeVisible();
    await locked.close();

    // The role was granted with no plan and no payment behind it, and still
    // resolves into the permission that guards the section.
    const unlocked = await signedInAs(browser, withRole.sessionToken);
    const unlockedPage = await unlocked.newPage();
    await unlockedPage.goto(`/test/${E2E_APPLICATION_ID}/gated`);
    await expect(unlockedPage.getByText("You are in")).toBeVisible();
    await unlocked.close();

    const entitlements = await api.get("/api/v1/entitlements", {
      params: { rxlabUserId: withRole.rxlabUserId },
    });
    expect(entitlements.ok()).toBe(true);
    await expect(entitlements.json()).resolves.toMatchObject({
      roles: [E2E_ROLE_KEY],
      permissions: [`${E2E_PERMISSION_KEY}:all`],
      plans: [],
    });
  });

  test("usage is blocked at the limit and allowed again once it is raised", async ({
    browser,
  }) => {
    const user = await createTestUser(api, {
      displayName: "Metered",
      usageLimit: { usageItemId: E2E_USAGE_ITEM_ID, limitValue: 1 },
    });

    const context = await signedInAs(browser, user.sessionToken);
    const page = await context.newPage();
    await page.goto(`/test/${E2E_APPLICATION_ID}`);
    const row = page.getByRole("row", { name: /API calls/ });

    await row.getByRole("button", { name: "Use 1" }).click();
    await expect(page.getByRole("status")).toHaveText("Recorded 1 unit of usage.");

    await row.getByRole("button", { name: "Use 1" }).click();
    await expect(page.getByRole("status")).toContainText("Blocked");

    await row.getByRole("button", { name: /Raise limit/ }).click();
    await expect(page.getByRole("status")).toContainText("Limit raised by 10");

    // Set the step once, then spend it — and it survives a reload.
    await row.getByRole("button", { name: "Set amount" }).click();
    await page.getByRole("spinbutton", { name: /Amount per click/ }).fill("4");
    await page.getByRole("button", { name: "Save" }).click();
    await row.getByRole("button", { name: "Use 4" }).click();
    await expect(page.getByRole("status")).toHaveText("Recorded 4 units of usage.");
    await expect(row.getByRole("button", { name: "Use 4" })).toBeVisible();

    // The raised limit is the user's own: 1 from the override, plus 10.
    await expect(usageFor(api, user.rxlabUserId, "api_calls")).resolves.toMatchObject({
      used: 5,
      limit: 11,
      remaining: 6,
    });

    // Reset clears the period's counter without touching the raised limit.
    await row.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByRole("status")).toContainText("Usage reset to zero");
    await expect(row.getByRole("cell", { name: /^0 \/ 11/ })).toBeVisible();
    await context.close();

    await expect(usageFor(api, user.rxlabUserId, "api_calls")).resolves.toMatchObject({
      used: 0,
      limit: 11,
      remaining: 11,
    });
  });

  test("a daily allowance rolls over once the clock passes its window", async ({
    browser,
  }) => {
    const user = await createTestUser(api, { displayName: "Time traveller" });
    const context = await signedInAs(browser, user.sessionToken);
    const page = await context.newPage();
    await page.goto(`/test/${E2E_APPLICATION_ID}`);
    const row = page.getByRole("row", { name: new RegExp(E2E_DAILY_ITEM_NAME) });

    // The daily item allows one call, and the window opens on first use.
    await row.getByRole("button", { name: "Use 1" }).click();
    await expect(page.getByRole("status")).toHaveText("Recorded 1 unit of usage.");
    await row.getByRole("button", { name: "Use 1" }).click();
    await expect(page.getByRole("status")).toContainText("Blocked");

    // Nothing resets counters on a schedule — passing the window is what does
    // it, so moving this user's clock a day forward is the whole test.
    await page.getByRole("button", { name: "+1 day" }).click();
    await expect(page.getByRole("status")).toContainText("Clock moved");
    await expect(page.getByText("1 day ahead")).toBeVisible();
    await expect(row.getByRole("cell", { name: /^0 \/ 1/ })).toBeVisible();

    await row.getByRole("button", { name: "Use 1" }).click();
    await expect(page.getByRole("status")).toHaveText("Recorded 1 unit of usage.");

    // The clock belongs to the user, not to the browser: the API reads the same
    // rolled-over window.
    await expect(
      usageFor(api, user.rxlabUserId, "daily_calls"),
    ).resolves.toMatchObject({ used: 1, limit: 1, remaining: 0 });

    await page.getByRole("button", { name: "Back to real time" }).click();
    await expect(page.getByRole("status")).toContainText("Back on real time");
    await expect(page.getByText("real time", { exact: true })).toBeVisible();
    await context.close();
  });
});

/** One metered item's status, as the application would read it back. */
async function usageFor(
  api: APIRequestContext,
  rxlabUserId: string,
  key: string,
) {
  const response = await api.get("/api/v1/usage", { params: { rxlabUserId } });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    usage: { key: string; used: number; limit: number; remaining: number }[];
  };
  return body.usage.find((item) => item.key === key);
}

async function createTestUser(
  api: APIRequestContext,
  input: {
    displayName: string;
    roleIds?: string[];
    usageLimit?: { usageItemId: string; limitValue: number | null };
  },
) {
  const response = await api.post("/api/e2e/test-users", { data: input });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    appUserId: string;
    rxlabUserId: string;
    sessionToken: string;
  };
}

/** A browser holding the storefront session cookie for one test user. */
async function signedInAs(
  browser: Browser,
  sessionToken: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  await context.addCookies([
    {
      name: "rx_test_session",
      value: sessionToken,
      url: `${E2E_BASE_URL}/test`,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return context;
}
