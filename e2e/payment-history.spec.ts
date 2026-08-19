import {
  expect,
  request as createRequest,
  test,
  type Browser,
} from "@playwright/test";
import {
  E2E_API_KEY,
  E2E_APPLICATION_ID,
  E2E_BASE_URL,
  E2E_SANDBOX_API_KEY,
  E2E_SECRET,
  E2E_UNIT_ID,
} from "./fixtures";

test("a test user can page through Stripe invoices and open one", async ({
  browser,
}) => {
  const api = await createRequest.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: {
      "X-Api-Key": E2E_SANDBOX_API_KEY,
      "X-E2E-Secret": E2E_SECRET,
    },
  });

  try {
    const userResponse = await api.post("/api/e2e/test-users", {
      data: { displayName: "Invoice reader" },
    });
    expect(userResponse.ok()).toBe(true);
    const user = (await userResponse.json()) as {
      rxlabUserId: string;
      sessionToken: string;
    };

    const topupResponse = await api.post("/api/e2e/topups", {
      data: {
        key: "invoice_history_points",
        name: "Invoice history points",
        unitId: E2E_UNIT_ID,
        amount: 100,
        priceAmountCents: 500,
        eligibility: { type: "standalone" },
      },
    });
    expect(topupResponse.ok()).toBe(true);
    const topup = (await topupResponse.json()) as { id: string };

    // Starting checkout creates the Stripe customer whose invoice history the
    // storefront resolves. The fake Stripe service supplies deterministic pages.
    const checkout = await api.post("/api/v1/checkout", {
      data: {
        kind: "topup",
        topupId: topup.id,
        rxlabUserId: user.rxlabUserId,
      },
    });
    expect(checkout.ok()).toBe(true);

    const invoicesResponse = await api.get("/api/v1/invoices", {
      params: { rxlabUserId: user.rxlabUserId },
    });
    expect(invoicesResponse.ok()).toBe(true);
    const invoices = (await invoicesResponse.json()) as {
      invoices: {
        id: string;
        number: string;
        status: string;
        amountCents: number;
        hostedInvoiceUrl: string;
        invoicePdfUrl: string;
      }[];
      pagination: {
        hasMore: boolean;
        firstCursor: string;
        lastCursor: string;
      };
    };
    expect(invoices.invoices).toHaveLength(10);
    expect(invoices.invoices[0]).toMatchObject({
      id: "in_e2e_01",
      number: "TEST-01",
      status: "paid",
      amountCents: 1_000,
      hostedInvoiceUrl: "https://invoice.stripe.test/in_e2e_01",
      invoicePdfUrl: "https://invoice.stripe.test/in_e2e_01.pdf",
    });
    expect(invoices.pagination).toEqual({
      hasMore: true,
      firstCursor: "in_e2e_01",
      lastCursor: "in_e2e_10",
    });

    const nextInvoicesResponse = await api.get("/api/v1/invoices", {
      params: {
        rxlabUserId: user.rxlabUserId,
        after: invoices.pagination.lastCursor,
      },
    });
    expect(nextInvoicesResponse.ok()).toBe(true);
    await expect(nextInvoicesResponse.json()).resolves.toMatchObject({
      invoices: [{ id: "in_e2e_11" }, { id: "in_e2e_12" }],
      pagination: {
        hasMore: false,
        firstCursor: "in_e2e_11",
        lastCursor: "in_e2e_12",
      },
    });

    const productionInvoices = await api.get("/api/v1/invoices", {
      headers: { "X-Api-Key": E2E_API_KEY },
      params: { rxlabUserId: user.rxlabUserId },
    });
    expect(productionInvoices.ok()).toBe(true);
    await expect(productionInvoices.json()).resolves.toEqual({
      invoices: [],
      pagination: {
        hasMore: false,
        firstCursor: null,
        lastCursor: null,
      },
    });

    const context = await signedInAs(browser, user.sessionToken);
    const page = await context.newPage();
    await page.goto(`/test/${E2E_APPLICATION_ID}/payments`);

    await expect(page.getByRole("heading", { name: "Payment history" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Payments" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("TEST-01", { exact: true })).toBeVisible();
    await expect(page.getByText("TEST-10", { exact: true })).toBeVisible();
    await expect(page.getByText("TEST-11", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View invoice" }).first()).toHaveAttribute(
      "href",
      "https://invoice.stripe.test/in_e2e_01",
    );

    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    await expect(page.getByText("TEST-11", { exact: true })).toBeVisible();
    await expect(page.getByText("TEST-12", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Next" })).toHaveCount(0);

    await page.getByRole("link", { name: "Previous" }).click();
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
    await expect(page.getByText("TEST-01", { exact: true })).toBeVisible();
    await context.close();
  } finally {
    await api.dispose();
  }
});

async function signedInAs(browser: Browser, sessionToken: string) {
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
