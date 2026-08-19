import { expect, test } from "@playwright/test";
import {
  E2E_API_KEY,
  E2E_BASE_URL,
  E2E_SANDBOX_API_KEY,
} from "./fixtures";

const headers = (apiKey: string) => ({
  "Content-Type": "application/json",
  "X-Api-Key": apiKey,
});

test("sandbox and production keys isolate the same external user", async ({
  request,
}) => {
  const rxlabUserId = `environment-${crypto.randomUUID()}`;

  const [productionResponse, sandboxResponse] = await Promise.all([
    request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
      headers: headers(E2E_API_KEY),
      params: { rxlabUserId },
    }),
    request.get(`${E2E_BASE_URL}/api/v1/entitlements`, {
      headers: headers(E2E_SANDBOX_API_KEY),
      params: { rxlabUserId },
    }),
  ]);
  expect(productionResponse.ok()).toBe(true);
  expect(sandboxResponse.ok()).toBe(true);

  const production = await productionResponse.json();
  const sandbox = await sandboxResponse.json();
  expect(production.user.rxlabUserId).toBe(rxlabUserId);
  expect(sandbox.user.rxlabUserId).toBe(rxlabUserId);
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
  const [productionCredit, sandboxCredit] = await Promise.all([
    request.post(`${E2E_BASE_URL}/api/v1/balances`, {
      headers: headers(E2E_API_KEY),
      data: mutation,
    }),
    request.post(`${E2E_BASE_URL}/api/v1/balances`, {
      headers: headers(E2E_SANDBOX_API_KEY),
      data: mutation,
    }),
  ]);
  expect(productionCredit.ok()).toBe(true);
  expect(sandboxCredit.ok()).toBe(true);
  expect((await productionCredit.json()).entryId).not.toBe(
    (await sandboxCredit.json()).entryId,
  );
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
