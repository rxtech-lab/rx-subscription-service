import { expect, test } from "@playwright/test";
import { E2E_SECRET } from "./fixtures";

for (const [label, path] of [["Paywalls", "/paywalls"], ["Settings", "/settings"]]) {
test(`console navigation stays mounted while ${label} loads`, async ({ page }) => {
  await page.setExtraHTTPHeaders({ "X-E2E-Secret": E2E_SECRET });
  await page.route("**/*", async (route) => {
    if (route.request().headers()["next-router-prefetch"]) await route.abort();
    else await route.continue();
  });
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Console sections" });
  await expect(navigation).toBeVisible();
  const original = await navigation.elementHandle();


    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let intercepted!: () => void;
    const pending = new Promise<void>((resolve) => { intercepted = resolve; });
    await page.route((url) => url.pathname === path && url.searchParams.has("_rsc"), async (route) => {
      intercepted();
      await gate;
      await route.continue();
    });
    try {
      await navigation.getByRole("link", { name: label }).click();
      await pending;
      await expect(navigation).toBeVisible();
      expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    } finally {
      release();
    }
    await expect(navigation.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main h1")).toBeVisible();
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    await page.unrouteAll({ behavior: "wait" });
});
}
