import {
  expect,
  request as createRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  E2E_API_KEY,
  E2E_BASE_URL,
  E2E_PLAN_ID,
  E2E_PLAN_USER,
  E2E_SANDBOX_API_KEY,
  E2E_SECRET,
  E2E_STANDALONE_USER,
  E2E_UNIT_ID,
} from "./fixtures";

test.describe.serial("app-scoped coupons", () => {
  let api: APIRequestContext;
  let sandboxApi: APIRequestContext;
  let topupId: string;

  test.beforeAll(async () => {
    api = await createRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "X-Api-Key": E2E_API_KEY,
        "X-E2E-Secret": E2E_SECRET,
      },
    });
    sandboxApi = await createRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "X-Api-Key": E2E_SANDBOX_API_KEY,
        "X-E2E-Secret": E2E_SECRET,
      },
    });
  });

  test.afterAll(async () => {
    await Promise.all([api.dispose(), sandboxApi.dispose()]);
  });

  test("creates an active code with target, audience, cap, and usage restrictions", async () => {
    const topup = await api.post("/api/e2e/topups", {
      data: {
        key: "coupon_points",
        name: "Coupon points",
        unitId: E2E_UNIT_ID,
        amount: 1_000,
        priceAmountCents: 500,
        eligibility: { type: "standalone" },
      },
    });
    expect(topup.ok()).toBe(true);
    topupId = ((await topup.json()) as { id: string }).id;

    const coupon = await api.post("/api/e2e/coupons", {
      data: {
        code: "PLAY25",
        name: "Playwright 25%",
        discountType: "percent",
        percentBasisPoints: 2_500,
        maxDiscountCents: 100,
        appliesTo: "selected",
        topupProductIds: [topupId],
        restrictToUsers: true,
        appUserIds: ["e2e-standalone-app-user"],
        maxRedemptions: 1,
        maxRedemptionsPerUser: 1,
      },
    });
    expect(coupon.ok()).toBe(true);
    await expect(coupon.json()).resolves.toMatchObject({
      code: "PLAY25",
      status: "active",
      restrictToUsers: true,
    });
  });

  test("previews the same capped discount and rejects another user and target", async () => {
    const valid = await validate(api, {
      rxlabUserId: E2E_STANDALONE_USER,
      code: "play25",
      topupId,
    });
    expect(valid.ok()).toBe(true);
    await expect(valid.json()).resolves.toMatchObject({
      valid: true,
      code: "PLAY25",
      discountCents: 100,
      totalCents: 400,
      capped: true,
      blockers: [],
    });

    const wrongUser = await validate(api, {
      rxlabUserId: E2E_PLAN_USER,
      code: "PLAY25",
      topupId,
    });
    await expect(wrongUser.json()).resolves.toMatchObject({
      valid: false,
      blockers: expect.arrayContaining(["user_not_allowed"]),
    });

    const wrongTarget = await validate(api, {
      rxlabUserId: E2E_STANDALONE_USER,
      code: "PLAY25",
      planId: E2E_PLAN_ID,
    });
    await expect(wrongTarget.json()).resolves.toMatchObject({
      valid: false,
      blockers: expect.arrayContaining(["not_applicable"]),
    });
  });

  test("applies the app coupon to Checkout and atomically holds its only use", async () => {
    const checkout = await api.post("/api/v1/checkout", {
      data: {
        kind: "topup",
        topupId,
        rxlabUserId: E2E_STANDALONE_USER,
        couponCode: "PLAY25",
      },
    });
    expect(checkout.ok()).toBe(true);
    await expect(checkout.json()).resolves.toMatchObject({
      checkoutUrl: expect.stringContaining("checkout.stripe.test"),
      purchaseId: expect.any(String),
      discount: { code: "PLAY25", discountCents: 100 },
    });

    const second = await api.post("/api/v1/checkout", {
      data: {
        kind: "topup",
        topupId,
        rxlabUserId: E2E_STANDALONE_USER,
        couponCode: "PLAY25",
      },
    });
    expect(second.status()).toBe(422);
    await expect(second.json()).resolves.toMatchObject({
      error: "coupon_not_applicable",
      blockers: expect.arrayContaining(["fully_redeemed", "user_limit_reached"]),
    });
  });

  test("uses a test user's persisted clock for scheduled coupon windows", async () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const redeemBy = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
    const coupon = await api.post("/api/e2e/coupons", {
      data: {
        code: "FUTURE20",
        name: "Future 20%",
        discountType: "percent",
        percentBasisPoints: 2_000,
        appliesTo: "selected",
        topupProductIds: [topupId],
        startsAt,
        redeemBy,
      },
    });
    expect(coupon.ok()).toBe(true);

    const realTime = await validate(api, {
      rxlabUserId: E2E_STANDALONE_USER,
      code: "FUTURE20",
      topupId,
    });
    await expect(realTime.json()).resolves.toMatchObject({
      valid: false,
      blockers: expect.arrayContaining(["not_started"]),
    });

    const user = await sandboxApi.post("/api/e2e/test-users", {
      data: {
        displayName: "Future coupon user",
        clockOffsetMs: 2 * 24 * 60 * 60_000,
      },
    });
    expect(user.ok()).toBe(true);
    const { rxlabUserId } = (await user.json()) as { rxlabUserId: string };

    const futureTime = await validate(sandboxApi, {
      rxlabUserId,
      code: "FUTURE20",
      topupId,
    });
    await expect(futureTime.json()).resolves.toMatchObject({
      valid: true,
      code: "FUTURE20",
      blockers: [],
    });

    const expiredUser = await sandboxApi.post("/api/e2e/test-users", {
      data: {
        displayName: "Expired coupon user",
        clockOffsetMs: 4 * 24 * 60 * 60_000,
      },
    });
    expect(expiredUser.ok()).toBe(true);
    const expiredRxlabUserId = (
      (await expiredUser.json()) as { rxlabUserId: string }
    ).rxlabUserId;

    const expired = await validate(sandboxApi, {
      rxlabUserId: expiredRxlabUserId,
      code: "FUTURE20",
      topupId,
    });
    await expect(expired.json()).resolves.toMatchObject({
      valid: false,
      blockers: expect.arrayContaining(["expired"]),
    });
  });
});

function validate(
  api: APIRequestContext,
  data: {
    rxlabUserId: string;
    code: string;
    planId?: string;
    topupId?: string;
  },
) {
  return api.post("/api/v1/coupons/validate", { data });
}
