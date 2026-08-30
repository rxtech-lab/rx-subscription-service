import {
  expect,
  request as createRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_POINTS_USAGE_ITEM_ID,
  E2E_SANDBOX_API_KEY,
  E2E_SECOND_PLAN_ID,
  E2E_SECRET,
} from "./fixtures";

test.describe.serial("trial usage allowance", () => {
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

  test("applies and enforces trial credits when an operation key is reused for another user", async () => {
    const first = await createTrialUser(api, "First Plus trial");
    const second = await createTrialUser(api, "Second Plus trial");
    const operationKey = "plus-trial-initial-credits";

    const firstUsage = await record(api, first.rxlabUserId, 1_000, operationKey);
    expect(firstUsage.ok()).toBe(true);
    await expect(firstUsage.json()).resolves.toMatchObject({
      allowed: true,
      used: 1_000,
      limit: 1_000,
      remaining: 0,
      duplicate: false,
    });

    // A caller's natural operation id can repeat for another user. It must not
    // replay the first user's row or leave this user's counter at zero.
    const secondUsage = await record(api, second.rxlabUserId, 1_000, operationKey);
    expect(secondUsage.ok()).toBe(true);
    await expect(secondUsage.json()).resolves.toMatchObject({
      allowed: true,
      used: 1_000,
      limit: 1_000,
      remaining: 0,
      duplicate: false,
    });

    const status = await api.get("/api/v1/usage", {
      params: { rxlabUserId: second.rxlabUserId },
    });
    expect(status.ok()).toBe(true);
    await expect(status.json()).resolves.toMatchObject({
      usage: expect.arrayContaining([
        expect.objectContaining({
          key: "pts",
          used: 1_000,
          limit: 1_000,
          remaining: 0,
        }),
      ]),
    });

    const overLimit = await record(
      api,
      second.rxlabUserId,
      1,
      "plus-trial-over-limit",
    );
    expect(overLimit.status()).toBe(402);
    await expect(overLimit.json()).resolves.toMatchObject({
      allowed: false,
      reason: "limit_exceeded",
      used: 1_000,
      limit: 1_000,
      remaining: 0,
    });
  });
});

async function createTrialUser(api: APIRequestContext, displayName: string) {
  const created = await api.post("/api/e2e/test-users", { data: { displayName } });
  expect(created.ok()).toBe(true);
  const user = (await created.json()) as { rxlabUserId: string };

  const subscribed = await api.post("/api/e2e/subscriptions", {
    data: {
      rxlabUserId: user.rxlabUserId,
      planId: E2E_SECOND_PLAN_ID,
      status: "trialing",
    },
  });
  expect(subscribed.ok()).toBe(true);
  await expect(subscribed.json()).resolves.toMatchObject({
    subscription: { status: "trialing" },
    entitlements: {
      usageLimits: { [E2E_POINTS_USAGE_ITEM_ID]: 1_000 },
    },
  });
  return user;
}

function record(
  api: APIRequestContext,
  rxlabUserId: string,
  amount: number,
  idempotencyKey: string,
) {
  return api.post("/api/v1/usage", {
    data: { rxlabUserId, item: "pts", amount, idempotencyKey },
  });
}
