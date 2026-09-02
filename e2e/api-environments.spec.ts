import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import {
  E2E_API_KEY,
  E2E_APPLICATION_ID,
  E2E_BASE_URL,
  E2E_PLAN_ID,
  E2E_PERMISSION_KEY,
  E2E_ROLE_KEY,
  E2E_SANDBOX_API_KEY,
  E2E_SANDBOX_WEBHOOK_SECRET,
  E2E_SECRET,
  E2E_UNIT_ID,
  E2E_USAGE_ITEM_ID,
  E2E_XCODE_API_KEY,
} from "./fixtures";

const headers = (apiKey: string) => ({
  "Content-Type": "application/json",
  "X-Api-Key": apiKey,
});

test("Xcode, sandbox, and production keys isolate the same external user", async ({
  request,
}) => {
  const rxlabUserId = `environment-${crypto.randomUUID()}`;

  const [xcodeResponse, sandboxResponse, productionResponse] = await Promise.all([
    request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
      headers: headers(E2E_XCODE_API_KEY),
      params: { rxlabUserId },
    }),
    request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
      headers: headers(E2E_SANDBOX_API_KEY),
      params: { rxlabUserId },
    }),
    request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
      headers: headers(E2E_API_KEY),
      params: { rxlabUserId },
    }),
  ]);
  expect(xcodeResponse.ok()).toBe(true);
  expect(productionResponse.ok()).toBe(true);
  expect(sandboxResponse.ok()).toBe(true);

  const [xcode, sandbox, production] = await Promise.all([
    xcodeResponse.json(),
    sandboxResponse.json(),
    productionResponse.json(),
  ]);
  expect(xcode.user.rxlabUserId).toBe(rxlabUserId);
  expect(production.user.rxlabUserId).toBe(rxlabUserId);
  expect(sandbox.user.rxlabUserId).toBe(rxlabUserId);
  expect(xcode.user.id).not.toBe(sandbox.user.id);
  expect(xcode.user.id).not.toBe(production.user.id);
  expect(production.user.id).not.toBe(sandbox.user.id);

  const idempotencyKey = `same-operation-${crypto.randomUUID()}`;
  const mutation = {
    rxlabUserId,
    unit: "points",
    amount: 25,
    operation: "credit",
    description: "Environment isolation check",
    idempotencyKey,
  };
  const [xcodeCredit, sandboxCredit, productionCredit] = await Promise.all([
    request.post(`${E2E_BASE_URL}/api/v1/balances`, {
      headers: headers(E2E_XCODE_API_KEY),
      data: mutation,
    }),
    request.post(`${E2E_BASE_URL}/api/v1/balances`, {
      headers: headers(E2E_SANDBOX_API_KEY),
      data: mutation,
    }),
    request.post(`${E2E_BASE_URL}/api/v1/balances`, {
      headers: headers(E2E_API_KEY),
      data: mutation,
    }),
  ]);
  expect(xcodeCredit.ok()).toBe(true);
  expect(productionCredit.ok()).toBe(true);
  expect(sandboxCredit.ok()).toBe(true);
  const [xcodeEntry, sandboxEntry, productionEntry] = await Promise.all([
    xcodeCredit.json(),
    sandboxCredit.json(),
    productionCredit.json(),
  ]);
  expect(xcodeEntry.entryId).not.toBe(sandboxEntry.entryId);
  expect(xcodeEntry.entryId).not.toBe(productionEntry.entryId);
  expect(productionEntry.entryId).not.toBe(sandboxEntry.entryId);
});

test("the dashboard switches an external user between production and sandbox data", async ({
  browser,
  request,
}) => {
  const rxlabUserId = `dashboard-environment-${crypto.randomUUID()}`;
  const sandboxHeaders = {
    ...headers(E2E_SANDBOX_API_KEY),
    "X-E2E-Secret": E2E_SECRET,
  };

  const productionResponse = await request.get(
    `${E2E_BASE_URL}/api/v1/entitlements`,
    {
      headers: headers(E2E_API_KEY),
      params: { rxlabUserId },
    },
  );
  expect(productionResponse.ok()).toBe(true);
  const production = (await productionResponse.json()) as { user: { id: string } };

  const subscription = await request.post(
    `${E2E_BASE_URL}/api/e2e/subscriptions`,
    {
      headers: sandboxHeaders,
      data: { rxlabUserId, planId: E2E_PLAN_ID },
    },
  );
  expect(subscription.ok()).toBe(true);

  const credit = await request.post(`${E2E_BASE_URL}/api/v1/balances`, {
    headers: sandboxHeaders,
    data: {
      rxlabUserId,
      unit: "points",
      amount: 137,
      operation: "credit",
      description: "Sandbox dashboard credit",
      idempotencyKey: `dashboard-credit-${crypto.randomUUID()}`,
    },
  });
  expect(credit.ok()).toBe(true);

  const usage = await request.post(`${E2E_BASE_URL}/api/v1/usage`, {
    headers: sandboxHeaders,
    data: {
      rxlabUserId,
      item: "api_calls",
      amount: 1,
      idempotencyKey: `dashboard-usage-${crypto.randomUUID()}`,
    },
  });
  expect(usage.ok()).toBe(true);

  const topupResponse = await request.post(`${E2E_BASE_URL}/api/e2e/topups`, {
    headers: sandboxHeaders,
    data: {
      key: `dashboard_points_${crypto.randomUUID().replaceAll("-", "")}`,
      name: "Dashboard points",
      unitId: E2E_UNIT_ID,
      amount: 100,
      priceAmountCents: 500,
      eligibility: { type: "standalone" },
    },
  });
  expect(topupResponse.ok()).toBe(true);
  const topup = (await topupResponse.json()) as { id: string };

  const checkout = await request.post(`${E2E_BASE_URL}/api/v1/checkout`, {
    headers: sandboxHeaders,
    data: { rxlabUserId, kind: "topup", topupId: topup.id },
  });
  expect(checkout.ok()).toBe(true);

  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET },
  });
  const page = await context.newPage();
  await page.goto(
    `/apps/${E2E_APPLICATION_ID}/users/${production.user.id}`,
  );

  const environment = page.getByRole("group", { name: "Data environment" });
  await expect(
    environment.getByRole("link", { name: "Production" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No balances", { exact: true })).toBeVisible();
  await expect(page.getByText("No subscriptions", { exact: true })).toBeVisible();
  await expect(page.getByText("No payments", { exact: true })).toBeVisible();

  await environment.getByRole("link", { name: "Sandbox" }).click();
  await expect(page).toHaveURL(/environment=sandbox/);
  await expect(
    page
      .getByRole("group", { name: "Data environment" })
      .getByRole("link", { name: "Sandbox" }),
  ).toHaveAttribute("aria-current", "page");

  const balanceRow = page.getByRole("row", { name: "Points 137 137" });
  await expect(balanceRow.getByRole("cell").nth(1)).toHaveText("137");
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "API calls" }) })
      .getByRole("cell")
      .nth(1),
  ).toHaveText("1 / 1");
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "Pro", exact: true }) }),
  ).toBeVisible();
  await expect(page.getByText("TEST-01", { exact: true })).toBeVisible();
  await expect(page.getByText("+137 points", { exact: true })).toBeVisible();

  await context.close();
});

test("reservation ids cannot cross environment boundaries", async ({ request }) => {
  const rxlabUserId = `reservation-environment-${crypto.randomUUID()}`;
  const sandboxHeaders = headers(E2E_SANDBOX_API_KEY);

  const credit = await request.post(`${E2E_BASE_URL}/api/v1/balances`, {
    headers: sandboxHeaders,
    data: {
      rxlabUserId,
      unit: "points",
      amount: 50,
      operation: "credit",
      description: "Sandbox balance",
      idempotencyKey: `credit-${crypto.randomUUID()}`,
    },
  });
  expect(credit.ok()).toBe(true);

  const reserved = await request.post(
    `${E2E_BASE_URL}/api/v1/balances/reserve`,
    {
      headers: sandboxHeaders,
      data: {
        rxlabUserId,
        unit: "points",
        amount: 10,
        idempotencyKey: `reserve-${crypto.randomUUID()}`,
      },
    },
  );
  expect(reserved.ok()).toBe(true);
  const { reservationId } = await reserved.json();

  const sandboxRead = await request.get(
    `${E2E_BASE_URL}/api/v1/balances/reservations/${reservationId}`,
    { headers: sandboxHeaders },
  );
  expect(sandboxRead.ok()).toBe(true);

  const productionRead = await request.get(
    `${E2E_BASE_URL}/api/v1/balances/reservations/${reservationId}`,
    { headers: headers(E2E_API_KEY) },
  );
  expect(productionRead.status()).toBe(404);
  await expect(productionRead.json()).resolves.toMatchObject({
    error: "reservation_not_found",
  });
});

test("sandbox checkout and webhook populate public account reads", async ({
  request,
}) => {
  const rxlabUserId = `sandbox-account-${crypto.randomUUID()}`;
  const sandboxHeaders = {
    ...headers(E2E_SANDBOX_API_KEY),
    "X-E2E-Secret": E2E_SECRET,
  };

  const subscribe = await request.post(
    `${E2E_BASE_URL}/api/e2e/subscriptions`,
    {
      headers: sandboxHeaders,
      data: { rxlabUserId, planId: E2E_PLAN_ID },
    },
  );
  expect(subscribe.ok()).toBe(true);

  const usage = await request.post(`${E2E_BASE_URL}/api/v1/usage`, {
    headers: sandboxHeaders,
    data: {
      rxlabUserId,
      item: "api_calls",
      amount: 1,
      idempotencyKey: `sandbox-usage-${crypto.randomUUID()}`,
    },
  });
  expect(usage.ok()).toBe(true);

  const topupResponse = await request.post(`${E2E_BASE_URL}/api/e2e/topups`, {
    headers: sandboxHeaders,
    data: {
      key: `sandbox_points_${crypto.randomUUID().replaceAll("-", "")}`,
      name: "Sandbox points",
      unitId: E2E_UNIT_ID,
      amount: 125,
      priceAmountCents: 500,
      eligibility: { type: "standalone" },
    },
  });
  expect(topupResponse.ok()).toBe(true);
  const topup = (await topupResponse.json()) as { id: string };

  const checkoutResponse = await request.post(
    `${E2E_BASE_URL}/api/v1/checkout`,
    {
      headers: sandboxHeaders,
      data: { rxlabUserId, kind: "topup", topupId: topup.id },
    },
  );
  expect(checkoutResponse.ok()).toBe(true);
  const checkout = (await checkoutResponse.json()) as {
    purchaseId: string;
    sessionId: string;
  };

  const event = JSON.stringify({
    id: `evt_sandbox_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1_000),
    data: {
      object: {
        id: checkout.sessionId,
        object: "checkout.session",
        client_reference_id: checkout.purchaseId,
        invoice: null,
        metadata: {
          applicationId: E2E_APPLICATION_ID,
          kind: "topup",
          purchaseId: checkout.purchaseId,
          topupProductId: topup.id,
        },
        mode: "payment",
        payment_intent: null,
        payment_status: "paid",
        status: "complete",
        total_details: { amount_discount: 0 },
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: event,
    secret: E2E_SANDBOX_WEBHOOK_SECRET,
  });
  const webhook = await request.post(
    `${E2E_BASE_URL}/api/stripe/webhook/sandbox`,
    {
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": signature,
      },
      data: event,
    },
  );
  expect(webhook.ok()).toBe(true);

  const [
    entitlementsResponse,
    balancesResponse,
    ledgerResponse,
    usageResponse,
    purchasesResponse,
  ] = await Promise.all([
    request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
      headers: sandboxHeaders,
      params: { rxlabUserId },
    }),
    request.get(`${E2E_BASE_URL}/api/v1/balances`, {
      headers: sandboxHeaders,
      params: { rxlabUserId },
    }),
    request.get(`${E2E_BASE_URL}/api/v1/balances/ledger`, {
      headers: sandboxHeaders,
      params: { rxlabUserId, unit: "points" },
    }),
    request.get(`${E2E_BASE_URL}/api/v1/usage`, {
      headers: sandboxHeaders,
      params: { rxlabUserId },
    }),
    request.get(`${E2E_BASE_URL}/api/v1/purchases`, {
      headers: sandboxHeaders,
      params: { rxlabUserId },
    }),
  ]);
  for (const response of [
    entitlementsResponse,
    balancesResponse,
    ledgerResponse,
    usageResponse,
    purchasesResponse,
  ]) {
    expect(response.ok()).toBe(true);
  }

  const entitlements = (await entitlementsResponse.json()) as {
    usage: { key: string; used: number; remaining: number }[];
  };
  expect(entitlements).toMatchObject({
    plans: [{ planId: E2E_PLAN_ID, status: "active" }],
    roles: [E2E_ROLE_KEY],
    permissions: [`${E2E_PERMISSION_KEY}:all`],
    balances: [{ unit: "points", amount: 125, available: 125 }],
  });
  expect(entitlements.usage).toContainEqual(
    expect.objectContaining({ key: "api_calls", used: 1, remaining: 0 }),
  );
  await expect(balancesResponse.json()).resolves.toMatchObject({
    balances: [{ unit: "points", amount: 125, available: 125 }],
  });
  await expect(ledgerResponse.json()).resolves.toMatchObject({
    entries: [{ kind: "topup", delta: 125, balanceAfter: 125 }],
  });
  const usageStatus = (await usageResponse.json()) as {
    usage: { itemId: string; key: string; used: number }[];
  };
  expect(usageStatus.usage).toContainEqual(
    expect.objectContaining({
      itemId: E2E_USAGE_ITEM_ID,
      key: "api_calls",
      used: 1,
    }),
  );
  await expect(purchasesResponse.json()).resolves.toMatchObject({
    purchases: [
      {
        id: checkout.purchaseId,
        kind: "topup",
        status: "paid",
        unit: "points",
        unitsGranted: 125,
      },
    ],
  });

  const portal = await request.post(`${E2E_BASE_URL}/api/v1/checkout`, {
    headers: sandboxHeaders,
    data: { rxlabUserId, kind: "portal" },
  });
  expect(portal.ok()).toBe(true);
  await expect(portal.json()).resolves.toEqual({
    url: "https://billing.stripe.test/sandbox",
  });

  const production = await request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
    headers: headers(E2E_API_KEY),
    params: { rxlabUserId },
  });
  expect(production.ok()).toBe(true);
  const productionEntitlements = (await production.json()) as {
    usage: { key: string; used: number }[];
  };
  expect(productionEntitlements).toMatchObject({
    plans: [],
    roles: [],
    permissions: [],
    balances: [],
  });
  expect(productionEntitlements.usage).toContainEqual(
    expect.objectContaining({ key: "api_calls", used: 0 }),
  );
});
