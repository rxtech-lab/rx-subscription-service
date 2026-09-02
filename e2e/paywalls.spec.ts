import { expect, test } from "@playwright/test";
import {
  E2E_API_KEY,
  E2E_APPLICATION_ID,
  E2E_BASE_URL,
  E2E_SECRET,
} from "./fixtures";

const apiHeaders = { "X-Api-Key": E2E_API_KEY };

test("a paywall is designed, published, assigned, and served to the app", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET },
  });
  const page = await context.newPage();
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  const name = `Onboarding ${Date.now()}`;

  // Nothing is served until a published template is assigned.
  const before = await request.get(`${E2E_BASE_URL}/api/v1/paywall`, { headers: apiHeaders });
  expect(before.status()).toBe(404);
  expect((await before.json()).error).toBe("paywall_not_configured");

  // Create from the shared library.
  await page.goto("/paywalls");
  await page.getByRole("button", { name: "New paywall" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Template").selectOption("classic");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/paywalls\/[0-9a-f-]{36}$/);
  const editorUrl = page.url();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText(/Draft v1 · Never published/)).toBeVisible();

  // Edit a Text node through the inspector; the phone follows.
  const phone = page.getByTestId("paywall-phone");
  await expect(phone).toHaveAttribute("data-device-preset", "mobile");
  await expect(phone.getByText("Unlock everything")).toBeVisible();

  // The same document can be checked at each supported responsive width.
  for (const preset of ["Android", "Foldable", "iPad", "macOS", "iPhone"]) {
    await page.getByRole("button", { name: preset, exact: true }).click();
    await expect(page.getByRole("button", { name: preset, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
  await expect(phone).toHaveAttribute("data-device-preset", "mobile");

  // Android uses Material You and can diverge from the default iPhone design.
  await page.getByRole("button", { name: "Android", exact: true }).click();
  await expect(phone).toHaveAttribute("data-platform-style", "material-you");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("button", { name: "Blue palette" }).click();
  await expect(page.getByRole("button", { name: "Blue palette" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.getByRole("treeitem", { name: /Unlock everything/ }).click();
  await page.getByLabel(/^Text \*/).fill("Android-only offer");
  await expect(phone.getByText("Android-only offer")).toBeVisible();

  await page.getByRole("button", { name: "iPhone", exact: true }).click();
  await expect(phone).toHaveAttribute("data-device-preset", "mobile");
  await expect(phone.getByText("Unlock everything")).toBeVisible();
  await page.getByRole("treeitem", { name: /Unlock everything/ }).click();
  const textField = page.getByLabel(/^Text \*/);
  await expect(textField).toHaveValue("Unlock everything");
  await textField.fill("Go Pro today");
  await expect(phone.getByText("Go Pro today")).toBeVisible();

  // One field edit is one undo step, and redo brings it back.
  await page.getByText("Layers", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(phone.getByText("Unlock everything")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(phone.getByText("Go Pro today")).toBeVisible();

  // Adding a node from the layers palette selects it.
  const pageRow = page.getByRole("treeitem", { name: /VStack/ }).first();
  const headlineRow = page.getByRole("treeitem", { name: /Go Pro today/ });
  const headlineTop = await headlineRow.evaluate((element) => element.getBoundingClientRect().top);
  await pageRow.hover();
  const addButton = pageRow.getByRole("button", { name: /^Add inside/ });
  await addButton.click();
  await expect(addButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menu", { name: "Add node" })).toBeVisible();
  expect(await headlineRow.evaluate((element) => element.getBoundingClientRect().top)).toBe(
    headlineTop,
  );
  await page.getByRole("menuitem", { name: "Badge" }).click();
  await expect(phone.getByText("Most popular")).toBeVisible();

  // Right-clicking a layer opens the shared node menu; copy takes the subtree.
  const nodeMenu = page.getByTestId("paywall-node-menu");
  await page.getByRole("treeitem", { name: /Most popular/ }).click({ button: "right" });
  await expect(nodeMenu).toBeVisible();
  await nodeMenu.getByRole("menuitem", { name: "Copy", exact: true }).click();
  await expect(nodeMenu).toBeHidden();

  // Pasting onto a leaf lands the copy right after it.
  await page.getByRole("treeitem", { name: /Go Pro today/ }).click({ button: "right" });
  await nodeMenu.getByRole("menuitem", { name: /^Paste after/ }).click();
  await expect(phone.getByText("Most popular")).toHaveCount(2);

  // The canvas offers the same menu, over the same handlers.
  await phone.getByText("Most popular").first().click({ button: "right" });
  await nodeMenu.getByRole("menuitem", { name: "Delete" }).click();
  await expect(phone.getByText("Most popular")).toHaveCount(1);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText(/Draft v2 · Never published/)).toBeVisible();

  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Version 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Current draft", { exact: true })).toBeVisible();
  const version2Preview = page.getByLabel("Version 2 iPhone screenshot preview");
  const version1Preview = page.getByLabel("Version 1 iPhone screenshot preview");
  await expect(version2Preview).toBeVisible();
  await expect(version1Preview).toBeVisible();
  await expect(version2Preview.getByText("Go Pro today")).toBeVisible();
  await expect(version1Preview.getByText("Unlock everything")).toBeVisible();

  // Still a draft: the API has nothing to serve.
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/^Version 2 published\./)).toBeVisible();
  await expect(page.getByText(/Draft v2 · Published v2/)).toBeVisible();

  // Assign it to the application.
  await page.goto(`/apps/${E2E_APPLICATION_ID}/paywall`);
  await page.getByLabel("Template").selectOption({ label: `${name} · Published` });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Paywall assigned.")).toBeVisible();
  await expect(page.getByTestId("paywall-phone").getByText("Go Pro today")).toBeVisible();
  // The preview uses this application's real plans.
  await expect(page.getByTestId("paywall-phone").getByText("$19.00")).toBeVisible();

  // The app fetches the published tree with products filled in.
  const after = await request.get(`${E2E_BASE_URL}/api/v1/paywall`, { headers: apiHeaders });
  expect(after.ok()).toBe(true);
  const body = await after.json();
  expect(body.name).toBe(name);
  expect(body.designVersion).toBe(2);
  expect(body.spec.version).toBe(1);
  expect(body.spec.root.type).toBe("ScrollView");
  expect(body.spec.materialYou).toEqual({ seedColor: "#0061A4" });
  expect(JSON.stringify(body.spec.deviceLayouts.android)).toContain("Android-only offer");
  const lists: { products: { key: string; priceLabel: string }[]; highlightedProductId: string | null }[] = [];
  const visit = (node: { type: string; children?: unknown[] } & Record<string, unknown>) => {
    if (node.type === "ProductList") lists.push(node as never);
    for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
  };
  visit(body.spec.root);
  expect(lists).toHaveLength(1);
  const pro = lists[0].products.find((product) => product.key === "pro");
  expect(pro?.priceLabel).toBe("$19.00");
  expect(lists[0].highlightedProductId).toBeTruthy();
  const texts = JSON.stringify(body.spec);
  expect(texts).toContain("Go Pro today");
  expect(texts).toContain("Most popular");

  // A prior design can be restored without rolling back the published app.
  await page.goto(editorUrl);
  await page.getByRole("treeitem", { name: /Go Pro today/ }).click();
  await page.getByLabel(/^Text \*/).fill("Temporary title");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft v3 · Published v2/)).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Restore version 1" }).click();
  await expect(page.getByText("Version 1 restored as version 4.")).toBeVisible();
  await expect(phone.getByText("Unlock everything")).toBeVisible();
  await expect(page.getByText(/Draft v4 · Published v2/)).toBeVisible();

  const stillPublished = await request.get(`${E2E_BASE_URL}/api/v1/paywall`, {
    headers: apiHeaders,
  });
  expect(stillPublished.ok()).toBe(true);
  const stillPublishedBody = await stillPublished.json();
  expect(stillPublishedBody.designVersion).toBe(2);
  expect(JSON.stringify(stillPublishedBody.spec)).toContain("Go Pro today");

  expect(pageErrors).toEqual([]);
  await context.close();
});
