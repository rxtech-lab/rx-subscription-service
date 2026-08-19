import {
  expect,
  request as createRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  E2E_API_KEY,
  E2E_BASE_URL,
  E2E_SECRET,
  E2E_UNIT_ID,
} from "./fixtures";

test.describe.serial("balance reservations", () => {
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

  test("a concurrent retry attaches to one hold", async () => {
    const rxlabUserId = "reservation-idempotency-user";
    await credit(api, rxlabUserId, 100, "idempotency-credit");
    const body = {
      rxlabUserId,
      unit: "points",
      amount: 60,
      idempotencyKey: "same-reserve",
      description: "One operation",
    };

    const [left, right] = await Promise.all([
      api.post("/api/v1/balances/reserve", { data: body }),
      api.post("/api/v1/balances/reserve", { data: body }),
    ]);
    expect(left.ok()).toBe(true);
    expect(right.ok()).toBe(true);
    const results = (await Promise.all([left.json(), right.json()])) as Array<{
      reservationId: string;
      available: number;
      duplicate: boolean;
    }>;
    expect(new Set(results.map((result) => result.reservationId)).size).toBe(1);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(results.map((result) => result.available)).toEqual([40, 40]);

    const recovered = await api.get(
      "/api/v1/balances/reservations?idempotencyKey=same-reserve",
    );
    expect(recovered.ok()).toBe(true);
    await expect(recovered.json()).resolves.toMatchObject({
      reservation: {
        reservationId: results[0].reservationId,
        rxlabUserId,
        unit: "points",
        initialAmount: 60,
        remainingReserved: 60,
        status: "open",
      },
    });

    const balance = await api.get(
      `/api/v1/balances?rxlabUserId=${rxlabUserId}`,
    );
    await expect(balance.json()).resolves.toMatchObject({
      balances: [{ unit: "points", amount: 100, available: 40 }],
    });

    const conflict = await api.post("/api/v1/balances/reserve", {
      data: { ...body, amount: 61 },
    });
    expect(conflict.status()).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: "idempotency_conflict",
    });
  });

  test("two holds racing the last credit cannot oversubscribe", async () => {
    const rxlabUserId = "reservation-race-user";
    await credit(api, rxlabUserId, 100, "race-credit");
    const reserve = (idempotencyKey: string) =>
      api.post("/api/v1/balances/reserve", {
        data: {
          rxlabUserId,
          unit: "points",
          amount: 100,
          idempotencyKey,
        },
      });

    const responses = await Promise.all([reserve("race-a"), reserve("race-b")]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    const failure = responses.find((response) => response.status() === 409);
    expect(failure).toBeDefined();
    await expect(failure!.json()).resolves.toMatchObject({
      error: "insufficient_balance",
      available: 0,
      required: 100,
    });
  });

  test("settles incrementally, renews, deduplicates, and closes on final", async () => {
    const rxlabUserId = "reservation-partial-user";
    await credit(api, rxlabUserId, 100, "partial-credit");
    const reserved = await reserve(api, {
      rxlabUserId,
      amount: 80,
      idempotencyKey: "partial-reserve",
      expiresInSeconds: 2,
    });
    const originalExpiry = Date.parse(reserved.expiresAt);

    await new Promise((resolve) => setTimeout(resolve, 25));
    const first = await api.post(
      `/api/v1/balances/reservations/${reserved.reservationId}/settle`,
      {
        data: {
          amount: 30,
          idempotencyKey: "provider-call-1",
          description: "First model call",
          metadata: { model: "test-model" },
        },
      },
    );
    expect(first.ok()).toBe(true);
    const firstResult = (await first.json()) as {
      entryId: string;
      settledAmount: number;
      remainingReserved: number;
      status: string;
      expiresAt: string;
      duplicate: boolean;
    };
    expect(firstResult).toMatchObject({
      settledAmount: 30,
      remainingReserved: 50,
      status: "open",
      duplicate: false,
    });
    expect(Date.parse(firstResult.expiresAt)).toBeGreaterThan(originalExpiry);

    const duplicate = await api.post(
      `/api/v1/balances/reservations/${reserved.reservationId}/settle`,
      { data: { amount: 30, idempotencyKey: "provider-call-1", description: "First model call", metadata: { model: "test-model" } } },
    );
    await expect(duplicate.json()).resolves.toMatchObject({
      entryId: firstResult.entryId,
      settledAmount: 30,
      remainingReserved: 50,
      duplicate: true,
    });

    const increased = await api.post(
      `/api/v1/balances/reservations/${reserved.reservationId}/increase`,
      { data: { amount: 20, idempotencyKey: "estimate-increase" } },
    );
    await expect(increased.json()).resolves.toMatchObject({
      amount: 70,
      available: 0,
      status: "open",
      duplicate: false,
    });

    const final = await api.post(
      `/api/v1/balances/reservations/${reserved.reservationId}/settle`,
      { data: { amount: 20, final: true, idempotencyKey: "provider-call-final" } },
    );
    await expect(final.json()).resolves.toMatchObject({
      operationRequestedAmount: 20,
      operationSettledAmount: 20,
      requestedAmount: 50,
      settledAmount: 50,
      shortfallAmount: 0,
      remainingReserved: 0,
      balanceAfter: 50,
      status: "closed",
    });

    const ledger = await api.get(
      `/api/v1/balances/ledger?rxlabUserId=${rxlabUserId}&unit=points&page=1&pageSize=10`,
    );
    expect(ledger.ok()).toBe(true);
    const history = (await ledger.json()) as {
      entries: Array<{ kind: string; delta: number; unit: string }>;
      total: number;
      pageCount: number;
    };
    expect(history.entries.filter((entry) => entry.kind === "usage")).toHaveLength(2);
    expect(history.entries.map((entry) => entry.delta)).toEqual([-20, -30, 100]);
    expect(history.entries.every((entry) => entry.unit === "points")).toBe(true);
    expect(history).toMatchObject({ total: 3, pageCount: 1 });
  });

  test("an expired hold supports a distinguishable capped late charge and release", async () => {
    const rxlabUserId = "reservation-expiry-user";
    await credit(api, rxlabUserId, 40, "expiry-credit");
    const reserved = await reserve(api, {
      rxlabUserId,
      amount: 30,
      idempotencyKey: "expiry-reserve",
      expiresInSeconds: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const late = await api.post(
      `/api/v1/balances/reservations/${reserved.reservationId}/settle`,
      { data: { amount: 50, idempotencyKey: "late-provider-cost" } },
    );
    expect(late.ok()).toBe(true);
    await expect(late.json()).resolves.toMatchObject({
      operationRequestedAmount: 50,
      operationSettledAmount: 40,
      operationShortfallAmount: 10,
      requestedAmount: 50,
      settledAmount: 40,
      shortfallAmount: 10,
      remainingReserved: 0,
      balanceAfter: 0,
      status: "expired",
    });

    const release = await api.post(
      `/api/v1/balances/reservations/${reserved.reservationId}/release`,
      { data: { idempotencyKey: "late-release", reason: "operation ended" } },
    );
    await expect(release.json()).resolves.toMatchObject({
      released: false,
      releasedAmount: 0,
      status: "expired",
    });

    const missing = await api.post(
      "/api/v1/balances/reservations/not-a-reservation/settle",
      { data: { amount: 1, idempotencyKey: "missing-reservation" } },
    );
    expect(missing.status()).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: "reservation_not_found",
    });
  });
});

async function credit(
  api: APIRequestContext,
  rxlabUserId: string,
  amount: number,
  idempotencyKey: string,
) {
  const response = await api.post("/api/v1/balances", {
    data: {
      rxlabUserId,
      unit: "points",
      amount,
      operation: "credit",
      description: "Test credit",
      idempotencyKey,
    },
  });
  expect(response.ok()).toBe(true);
}

async function reserve(
  api: APIRequestContext,
  input: {
    rxlabUserId: string;
    amount: number;
    idempotencyKey: string;
    expiresInSeconds?: number;
  },
) {
  const response = await api.post("/api/v1/balances/reserve", {
    data: { unit: "points", ...input },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    reservationId: string;
    expiresAt: string;
  };
}

test("purchase history is app-user scoped and uses persisted receipt fields", async ({
  request,
}) => {
  const rxlabUserId = "purchase-history-api-user";
  const topup = await request.post("/api/e2e/topups", {
    data: {
      key: "purchase_history_api_points",
      name: "Purchase history API points",
      unitId: E2E_UNIT_ID,
      amount: 1_000,
      priceAmountCents: 130,
      eligibility: { type: "standalone" },
    },
    headers: {
      "X-E2E-Secret": E2E_SECRET,
      "X-Api-Key": E2E_API_KEY,
    },
  });
  expect(topup.ok()).toBe(true);
  const { id: topupId } = (await topup.json()) as { id: string };

  const checkout = await request.post("/api/v1/checkout", {
    data: { kind: "topup", topupId, rxlabUserId },
    headers: { "X-Api-Key": E2E_API_KEY },
  });
  expect(checkout.ok()).toBe(true);

  const purchases = await request.get(
    `/api/v1/purchases?rxlabUserId=${rxlabUserId}&page=1&pageSize=10`,
    { headers: { "X-Api-Key": E2E_API_KEY } },
  );
  expect(purchases.ok()).toBe(true);
  await expect(purchases.json()).resolves.toMatchObject({
    purchases: [
      {
        kind: "topup",
        status: "pending",
        unit: "points",
        unitsGranted: 0,
        amountCents: 130,
        currency: "usd",
        hostedInvoiceUrl: null,
        invoicePdfUrl: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 10,
    pageCount: 1,
  });
});
