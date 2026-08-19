import { expect, test } from "@playwright/test";
import {
  E2E_APPLICATION_ID,
  E2E_BASE_URL,
  E2E_SECRET,
} from "./fixtures";

test("the first assistant message keeps a short transcript pinned without a render loop", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET },
  });
  const page = await context.newPage();
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/api/ai/chat", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "stubbed_assistant" }),
    });
  });

  await page.goto(`/apps/${E2E_APPLICATION_ID}`);
  await page.getByRole("button", { name: "Open subscription assistant" }).click();
  await page.getByPlaceholder("Ask the agent…").fill("Hello from Playwright");
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/api/ai/chat") && candidate.status() === 500,
  );
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Hello from Playwright", { exact: true })).toBeVisible();
  await response;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(pageErrors).toEqual([]);

  await context.close();
});
