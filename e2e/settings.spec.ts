import { expect, test } from "@playwright/test";
import { E2E_APPLICATION_ID, E2E_SECRET } from "./fixtures";

test.use({ extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET } });

test("settings separates edits into dialogs on desktop and mobile", async ({ page }, testInfo) => {
  await page.goto(`/apps/${E2E_APPLICATION_ID}/settings`);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("Link to another app")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit application link" }).click();
  await expect(page.getByRole("dialog", { name: "Shared subscriptions" })).toBeVisible();
  await expect(page.getByLabel("Link to another app")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Edit application link" })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("settings-general.png"), fullPage: true });

  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "Automation" }).click();
  await page.getByRole("button", { name: "Edit automation" }).click();
  const checkbox = page.getByRole("checkbox", { name: "Run all test suites after configuration changes" });
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await page.getByRole("button", { name: "Save automation", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Automatic runs enabled", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Automatic runs enabled", { exact: true })).toBeVisible();

  await nav.getByRole("link", { name: "App Store", exact: true }).click();
  await expect(page.getByText("Notifications V2 URL")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Edit App Store settings" }).click();
  await expect(page.getByLabel("Bundle ID", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-app-store-dialog-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await nav.getByRole("link", { name: "API keys", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create API key" })).toBeVisible();
  await expect(page.locator("pre")).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings-api-keys-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Create API key" }).click();
  await expect(page.getByRole("dialog", { name: "Create an API key" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
