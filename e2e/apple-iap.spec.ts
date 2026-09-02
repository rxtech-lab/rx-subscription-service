import {
  expect,
  request as createRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  E2E_API_KEY,
  E2E_BASE_URL,
  E2E_ONE_TIME_PLAN_ID,
  E2E_PLAN_ID,
  E2E_SANDBOX_API_KEY,
  E2E_SECRET,
  E2E_SECOND_PLAN_ID,
  E2E_UNIT_ID,
  E2E_XCODE_API_KEY,
} from "./fixtures";

const PRODUCT_ID = "com.rxlab.e2e.points100";
const USER_ID = "e2e-apple-user";

function signed(value: unknown) {
  return `e2e.${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}

test.describe.serial("Apple StoreKit fulfillment", () => {
  let admin: APIRequestContext;
  let api: APIRequestContext;
  let xcodeApi: APIRequestContext;
  let topupId: string;
  let accountToken: string;
  let purchasePayload: Record<string, unknown>;

  test.beforeAll(async () => {
    admin = await createRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: { "X-Api-Key": E2E_API_KEY, "X-E2E-Secret": E2E_SECRET },
    });
    api = await createRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "X-Api-Key": E2E_SANDBOX_API_KEY,
        "X-E2E-Secret": E2E_SECRET,
      },
    });
    xcodeApi = await createRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "X-Api-Key": E2E_XCODE_API_KEY,
        "X-E2E-Secret": E2E_SECRET,
      },
    });
  });

  test.afterAll(async () => {
    await Promise.all([admin.dispose(), api.dispose(), xcodeApi.dispose()]);
  });

  test("configures a consumable and returns a stable sandbox account token", async () => {
    const topup = await admin.post("/api/e2e/topups", {
      data: {
        key: "apple_points_100",
        name: "Apple points",
        unitId: E2E_UNIT_ID,
        amount: 100,
        priceAmountCents: 99,
        eligibility: { type: "standalone" },
      },
    });
    expect(topup.ok()).toBe(true);
    topupId = ((await topup.json()) as { id: string }).id;

    const configured = await admin.post("/api/e2e/apple/configure", {
      data: {
        productId: PRODUCT_ID,
        topupProductId: topupId,
        // Apple sells this pack from a pricier tier than Stripe does.
        priceAmountCents: 129,
        currency: "usd",
      },
    });
    expect(configured.ok()).toBe(true);

    const first = await api.post("/api/v1/iap/apple/account-token", {
      data: { rxlabUserId: USER_ID },
    });
    expect(first.ok()).toBe(true);
    accountToken = ((await first.json()) as { appAccountToken: string }).appAccountToken;
    expect(accountToken).toMatch(/^[0-9a-f-]{36}$/);
    const second = await api.post("/api/v1/iap/apple/account-token", {
      data: { rxlabUserId: USER_ID },
    });
    await expect(second.json()).resolves.toMatchObject({
      appAccountToken: accountToken,
      environment: "sandbox",
    });
    const consented = await api.put("/api/v1/iap/apple/consumption-consent", {
      data: { rxlabUserId: USER_ID, consented: true },
    });
    await expect(consented.json()).resolves.toMatchObject({ consented: true });
    const withdrawn = await api.put("/api/v1/iap/apple/consumption-consent", {
      data: { rxlabUserId: USER_ID, consented: false },
    });
    await expect(withdrawn.json()).resolves.toMatchObject({ consented: false });
  });

  test("fulfills an Xcode StoreKit transaction in the isolated Xcode environment", async () => {
    const tokenResponse = await xcodeApi.post("/api/v1/iap/apple/account-token", {
      data: { rxlabUserId: USER_ID },
    });
    expect(tokenResponse.ok()).toBe(true);
    const tokenBody = (await tokenResponse.json()) as {
      appAccountToken: string;
      environment: string;
    };
    expect(tokenBody.environment).toBe("xcode");

    const transaction = signed({
      transactionId: "apple-e2e-xcode-transaction-1",
      originalTransactionId: "apple-e2e-xcode-transaction-1",
      bundleId: "com.rxlab.e2e",
      productId: PRODUCT_ID,
      purchaseDate: Date.now(),
      originalPurchaseDate: Date.now(),
      quantity: 1,
      type: "Consumable",
      appAccountToken: tokenBody.appAccountToken,
      signedDate: Date.now(),
      environment: "Xcode",
      currency: "USD",
      price: 1290,
    });
    const fulfilled = await xcodeApi.post("/api/v1/iap/apple/transactions", {
      data: { rxlabUserId: USER_ID, signedTransaction: transaction },
    });
    expect(fulfilled.ok()).toBe(true);
    await expect(fulfilled.json()).resolves.toMatchObject({
      processed: "new",
      transaction: { environment: "xcode", quantity: 1 },
      purchase: { billingProvider: "apple_app_store", unitsGranted: 100 },
    });

    const [xcodeEntitlements, sandboxEntitlements] = await Promise.all([
      xcodeApi.get("/api/v1/entitlements", { params: { rxlabUserId: USER_ID } }),
      api.get("/api/v1/entitlements", { params: { rxlabUserId: USER_ID } }),
    ]);
    const xcodeBody = await xcodeEntitlements.json();
    const sandboxBody = await sandboxEntitlements.json();
    expect(xcodeBody.user.id).not.toBe(sandboxBody.user.id);
    expect(xcodeBody.balances).toEqual([
      expect.objectContaining({ unit: "points", amount: 100 }),
    ]);
    expect(sandboxBody.balances).toEqual([]);
  });

  test("publishes StoreKit purchase options and fulfills quantity once", async () => {
    const catalog = await api.get("/api/v1/catalog", {
      params: { rxlabUserId: USER_ID },
    });
    const catalogBody = (await catalog.json()) as {
      topups: { id: string; priceAmountCents: number; purchaseOptions: unknown[] }[];
    };
    expect(catalogBody.topups.find((topup) => topup.id === topupId)).toMatchObject({
      // The default platform is the web, so the local price is quoted...
      priceAmountCents: 99,
      purchaseOptions: expect.arrayContaining([
        { provider: "stripe", flow: "checkout", priceAmountCents: 99, currency: "usd" },
        {
          provider: "apple_app_store",
          flow: "storekit",
          productId: PRODUCT_ID,
          productType: "consumable",
          // ...while the StoreKit option always carries the App Store price.
          priceAmountCents: 129,
          currency: "usd",
        },
      ]),
    });

    const iosCatalog = await api.get("/api/v1/catalog", {
      params: { rxlabUserId: USER_ID, platform: "ios" },
    });
    const iosBody = (await iosCatalog.json()) as {
      platform: string;
      topups: { id: string; priceAmountCents: number; currency: string }[];
    };
    expect(iosBody.platform).toBe("ios");
    expect(iosBody.topups.find((topup) => topup.id === topupId)).toMatchObject({
      priceAmountCents: 129,
      currency: "usd",
    });

    // A StoreKit client asks for nothing: URLSession's own user agent is enough
    // to be quoted App Store prices.
    const nativeCatalog = await api.get("/api/v1/catalog", {
      params: { rxlabUserId: USER_ID },
      headers: { "User-Agent": "RxE2E/1.0 CFNetwork/1494.0.7 Darwin/23.4.0" },
    });
    const nativeBody = (await nativeCatalog.json()) as {
      platform: string;
      topups: { id: string; priceAmountCents: number }[];
    };
    expect(nativeBody.platform).toBe("ios");
    expect(nativeBody.topups.find((topup) => topup.id === topupId)).toMatchObject({
      priceAmountCents: 129,
    });

    purchasePayload = {
      transactionId: "apple-e2e-transaction-1",
      originalTransactionId: "apple-e2e-transaction-1",
      bundleId: "com.rxlab.e2e",
      productId: PRODUCT_ID,
      purchaseDate: Date.now(),
      originalPurchaseDate: Date.now(),
      quantity: 2,
      type: "Consumable",
      appAccountToken: accountToken,
      signedDate: Date.now(),
      environment: "Sandbox",
      currency: "USD",
      price: 1980,
    };
    const payload = signed(purchasePayload);
    const first = await api.post("/api/v1/iap/apple/transactions", {
      data: { rxlabUserId: USER_ID, signedTransaction: payload },
    });
    expect(first.ok()).toBe(true);
    await expect(first.json()).resolves.toMatchObject({
      processed: "new",
      transaction: { quantity: 2, priceMilliunits: 1980, currency: "usd" },
      purchase: { billingProvider: "apple_app_store", unitsGranted: 200 },
    });

    const duplicate = await api.post("/api/v1/iap/apple/transactions", {
      data: { rxlabUserId: USER_ID, signedTransaction: payload },
    });
    expect(duplicate.ok()).toBe(true);
    await expect(duplicate.json()).resolves.toMatchObject({
      processed: "already_complete",
    });

    const balances = await api.get("/api/v1/balances", {
      params: { rxlabUserId: USER_ID },
    });
    await expect(balances.json()).resolves.toMatchObject({
      balances: [{ unit: "points", amount: 200 }],
    });
  });

  test("processes refund and refund reversal notifications idempotently", async () => {
    const notification = (
      type: "REFUND" | "REFUND_REVERSED",
      uuid: string,
      percentage = 100_000,
    ) =>
      signed({
        notificationType: type,
        notificationUUID: uuid,
        version: "2.0",
        signedDate: Date.now(),
        data: {
          environment: "Sandbox",
          bundleId: "com.rxlab.e2e",
          appAppleId: 123456789,
          signedTransactionInfo: signed({
            ...purchasePayload,
            signedDate: Date.now(),
            revocationDate: Date.now(),
            revocationPercentage: percentage,
          }),
        },
      });

    const partial = await api.post("/api/apple/notifications/e2e-app", {
      data: {
        signedPayload: notification("REFUND", "apple-partial-refund-event-1", 50_000),
      },
    });
    expect(partial.status()).toBe(200);
    const afterPartialRefund = await api.get("/api/v1/balances", {
      params: { rxlabUserId: USER_ID },
    });
    await expect(afterPartialRefund.json()).resolves.toMatchObject({
      balances: [{ unit: "points", amount: 100 }],
    });

    const refunded = await api.post("/api/apple/notifications/e2e-app", {
      data: { signedPayload: notification("REFUND", "apple-refund-event-1") },
    });
    expect(refunded.status()).toBe(200);
    const afterRefund = await api.get("/api/v1/balances", {
      params: { rxlabUserId: USER_ID },
    });
    await expect(afterRefund.json()).resolves.toMatchObject({
      balances: [{ unit: "points", amount: 0 }],
    });

    const replay = await api.post("/api/apple/notifications/e2e-app", {
      data: { signedPayload: notification("REFUND", "apple-refund-event-1") },
    });
    expect(replay.status()).toBe(200);

    const restored = await api.post("/api/apple/notifications/e2e-app", {
      data: {
        signedPayload: notification(
          "REFUND_REVERSED",
          "apple-refund-reversed-event-1",
        ),
      },
    });
    expect(restored.status()).toBe(200);
    const afterReversal = await api.get("/api/v1/balances", {
      params: { rxlabUserId: USER_ID },
    });
    await expect(afterReversal.json()).resolves.toMatchObject({
      balances: [{ unit: "points", amount: 200 }],
    });
  });

  test("snapshots a non-consumable plan and removes/restores it on refund", async () => {
    const productId = "com.rxlab.e2e.lifetime";
    const configured = await admin.post("/api/e2e/apple/configure", {
      data: { productId, planId: E2E_ONE_TIME_PLAN_ID },
    });
    expect(configured.ok()).toBe(true);
    const oneTimeTransaction = {
      transactionId: "apple-e2e-one-time-1",
      originalTransactionId: "apple-e2e-one-time-1",
      bundleId: "com.rxlab.e2e",
      productId,
      purchaseDate: Date.now(),
      originalPurchaseDate: Date.now(),
      quantity: 1,
      type: "Non-Consumable",
      appAccountToken: accountToken,
      signedDate: Date.now(),
      environment: "Sandbox",
      currency: "USD",
      price: 49_000,
    };
    const purchase = await api.post("/api/v1/iap/apple/transactions", {
      data: { rxlabUserId: USER_ID, signedTransaction: signed(oneTimeTransaction) },
    });
    expect(purchase.ok()).toBe(true);
    const entitled = await api.get("/api/v1/entitlements", {
      params: { rxlabUserId: USER_ID },
    });
    await expect(entitled.json()).resolves.toMatchObject({
      plans: [
        {
          planId: E2E_ONE_TIME_PLAN_ID,
          purchaseId: expect.any(String),
          billingProvider: "apple_app_store",
        },
      ],
      balances: [{ unit: "points", amount: 250 }],
    });

    const revoked = signed({
      ...oneTimeTransaction,
      signedDate: Date.now(),
      revocationDate: Date.now(),
      revocationPercentage: 100_000,
    });
    const notification = (type: "REFUND" | "REFUND_REVERSED", uuid: string) =>
      signed({
        notificationType: type,
        notificationUUID: uuid,
        version: "2.0",
        signedDate: Date.now(),
        data: {
          environment: "Sandbox",
          bundleId: "com.rxlab.e2e",
          signedTransactionInfo: revoked,
        },
      });
    expect(
      (
        await api.post("/api/apple/notifications/e2e-app", {
          data: { signedPayload: notification("REFUND", "apple-plan-refund-1") },
        })
      ).ok(),
    ).toBe(true);
    const refunded = await api.get("/api/v1/entitlements", {
      params: { rxlabUserId: USER_ID },
    });
    await expect(refunded.json()).resolves.toMatchObject({
      plans: [],
      balances: [{ unit: "points", amount: 200 }],
    });

    expect(
      (
        await api.post("/api/apple/notifications/e2e-app", {
          data: {
            signedPayload: notification(
              "REFUND_REVERSED",
              "apple-plan-refund-reversal-1",
            ),
          },
        })
      ).ok(),
    ).toBe(true);
    const restored = await api.get("/api/v1/entitlements", {
      params: { rxlabUserId: USER_ID },
    });
    await expect(restored.json()).resolves.toMatchObject({
      plans: [{ planId: E2E_ONE_TIME_PLAN_ID }],
      balances: [{ unit: "points", amount: 250 }],
    });
  });

  test("reconciles subscription grace, retry, cancellation, upgrade, downgrade, and expiry", async () => {
    const proProduct = "com.rxlab.e2e.pro";
    const plusProduct = "com.rxlab.e2e.plus";
    for (const [productId, planId] of [
      [proProduct, E2E_PLAN_ID],
      [plusProduct, E2E_SECOND_PLAN_ID],
    ]) {
      const configured = await admin.post("/api/e2e/apple/configure", {
        data: { productId, planId },
      });
      expect(configured.ok()).toBe(true);
    }

    const originalTransactionId = "apple-e2e-subscription-original";
    const base = Date.now();
    const transaction = (input: {
      id: string;
      productId: string;
      purchasedAt: number;
    }) => ({
      transactionId: input.id,
      originalTransactionId,
      bundleId: "com.rxlab.e2e",
      productId: input.productId,
      purchaseDate: input.purchasedAt,
      originalPurchaseDate: base,
      expiresDate: input.purchasedAt + 30 * 24 * 60 * 60_000,
      quantity: 1,
      type: "Auto-Renewable Subscription",
      appAccountToken: accountToken,
      signedDate: input.purchasedAt,
      environment: "Sandbox",
      currency: "USD",
      price: 19_000,
    });
    const initial = transaction({ id: "apple-e2e-sub-1", productId: proProduct, purchasedAt: base });
    const purchase = await api.post("/api/v1/iap/apple/transactions", {
      data: { rxlabUserId: USER_ID, signedTransaction: signed(initial) },
    });
    expect(purchase.ok()).toBe(true);

    let notificationSequence = 0;
    const notify = async (input: {
      type: string;
      status: number;
      transaction: Record<string, unknown>;
      autoRenewStatus?: number;
      autoRenewProductId?: string;
      gracePeriodExpiresDate?: number;
    }) => {
      notificationSequence += 1;
      const stateSignedAt = base + notificationSequence * 1_000;
      const signedRenewalInfo = signed({
        originalTransactionId,
        productId: input.transaction.productId,
        autoRenewProductId:
          input.autoRenewProductId ?? input.transaction.productId,
        autoRenewStatus: input.autoRenewStatus ?? 1,
        gracePeriodExpiresDate: input.gracePeriodExpiresDate,
        signedDate: stateSignedAt,
        environment: "Sandbox",
        appAccountToken: accountToken,
      });
      const response = await api.post("/api/apple/notifications/e2e-app", {
        data: {
          signedPayload: signed({
            notificationType: input.type,
            notificationUUID: `apple-sub-event-${notificationSequence}`,
            version: "2.0",
            signedDate: stateSignedAt,
            data: {
              environment: "Sandbox",
              bundleId: "com.rxlab.e2e",
              status: input.status,
              signedTransactionInfo: signed(input.transaction),
              signedRenewalInfo,
            },
          }),
        },
      });
      expect(response.ok()).toBe(true);
    };
    const plans = async () => {
      const response = await api.get("/api/v1/entitlements", {
        params: { rxlabUserId: USER_ID },
      });
      return ((await response.json()) as {
        plans: { planId: string; status: string; cancelAtPeriodEnd: boolean }[];
      }).plans;
    };

    await notify({
      type: "DID_FAIL_TO_RENEW",
      status: 4,
      transaction: initial,
      gracePeriodExpiresDate: base + 7 * 24 * 60 * 60_000,
    });
    expect(await plans()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planId: E2E_PLAN_ID, status: "active", cancelAtPeriodEnd: false }),
      ]),
    );
    await notify({ type: "DID_FAIL_TO_RENEW", status: 3, transaction: initial });
    expect(await plans()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planId: E2E_PLAN_ID, status: "past_due", cancelAtPeriodEnd: false }),
      ]),
    );
    await notify({
      type: "DID_CHANGE_RENEWAL_STATUS",
      status: 1,
      transaction: initial,
      autoRenewStatus: 0,
    });
    expect(await plans()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planId: E2E_PLAN_ID, status: "active", cancelAtPeriodEnd: true }),
      ]),
    );

    const upgrade = transaction({
      id: "apple-e2e-sub-upgrade",
      productId: plusProduct,
      purchasedAt: base + 10_000,
    });
    await notify({ type: "DID_RENEW", status: 1, transaction: upgrade });
    expect(await plans()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planId: E2E_SECOND_PLAN_ID, status: "active", cancelAtPeriodEnd: false }),
      ]),
    );
    await notify({
      type: "DID_CHANGE_RENEWAL_PREF",
      status: 1,
      transaction: upgrade,
      autoRenewProductId: proProduct,
    });
    expect(await plans()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planId: E2E_SECOND_PLAN_ID, status: "active", cancelAtPeriodEnd: false }),
      ]),
    );

    const downgrade = transaction({
      id: "apple-e2e-sub-downgrade",
      productId: proProduct,
      purchasedAt: base + 20_000,
    });
    await notify({ type: "DID_RENEW", status: 1, transaction: downgrade });
    expect(await plans()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planId: E2E_PLAN_ID, status: "active", cancelAtPeriodEnd: false }),
      ]),
    );
    await notify({ type: "EXPIRED", status: 2, transaction: downgrade });
    expect((await plans()).map((plan) => plan.planId)).not.toContain(E2E_PLAN_ID);
  });
});
