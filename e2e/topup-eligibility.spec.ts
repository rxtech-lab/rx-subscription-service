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
  E2E_ROLE_ID,
  E2E_ROLE_KEY,
  E2E_SECRET,
  E2E_STANDALONE_USER,
  E2E_UNIT_ID,
} from "./fixtures";

test.describe.serial("topup eligibility", () => {
  let api: APIRequestContext;
  let standaloneTopupId: string;
  let planTopupId: string;
  let roleTopupId: string;

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

  test("creates standalone, plan-linked, and role-linked topups", async () => {
    const standalone = await createTopup(api, {
      key: "standalone_points",
      name: "Standalone points",
      eligibility: { type: "standalone" },
    });
    expect(standalone.eligibilityRule).toBeNull();
    standaloneTopupId = standalone.id;

    const plan = await createTopup(api, {
      key: "plan_points",
      name: "Plan points",
      eligibility: { type: "plan", planId: E2E_PLAN_ID },
    });
    expect(plan.eligibilityRule).toMatchObject({
      ruleType: "requires_active_plan",
      planId: E2E_PLAN_ID,
      roleId: null,
    });
    planTopupId = plan.id;

    const role = await createTopup(api, {
      key: "role_points",
      name: "Role points",
      eligibility: { type: "role", roleId: E2E_ROLE_ID },
    });
    expect(role.eligibilityRule).toMatchObject({
      ruleType: "requires_role",
      planId: null,
      roleId: E2E_ROLE_ID,
    });
    roleTopupId = role.id;
  });

  test("blocks a plan-linked topup until the user subscribes", async () => {
    const response = await checkout(api, planTopupId, E2E_PLAN_USER);
    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "not_eligible",
      blockedBy: [
        {
          ruleType: "requires_active_plan",
          planId: E2E_PLAN_ID,
          roleId: null,
        },
      ],
    });
  });

  test("assigns the plan role and unlocks plan- and role-linked topups", async () => {
    const subscribe = await api.post("/api/e2e/subscriptions", {
      data: { rxlabUserId: E2E_PLAN_USER, planId: E2E_PLAN_ID },
    });
    expect(subscribe.ok()).toBe(true);
    await expect(subscribe.json()).resolves.toMatchObject({
      subscription: { planId: E2E_PLAN_ID, status: "active" },
      entitlements: { roleKeys: [E2E_ROLE_KEY] },
    });

    const entitlements = await api.get("/api/v1/entitlements", {
      params: { rxlabUserId: E2E_PLAN_USER },
    });
    expect(entitlements.ok()).toBe(true);
    await expect(entitlements.json()).resolves.toMatchObject({
      roles: [E2E_ROLE_KEY],
      plans: [{ planId: E2E_PLAN_ID, status: "active" }],
    });

    for (const topupId of [planTopupId, roleTopupId]) {
      const response = await checkout(api, topupId, E2E_PLAN_USER);
      expect(response.ok()).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        checkoutUrl: expect.stringContaining("checkout.stripe.test"),
        purchaseId: expect.any(String),
      });
    }
  });

  test("allows a standalone topup without a subscription", async () => {
    const catalog = await api.get("/api/v1/catalog", {
      params: { rxlabUserId: E2E_STANDALONE_USER },
    });
    expect(catalog.ok()).toBe(true);
    const catalogBody = (await catalog.json()) as {
      topups: { id: string; eligible: boolean }[];
    };
    expect(
      catalogBody.topups.find((topup) => topup.id === standaloneTopupId),
    ).toMatchObject({ eligible: true });
    expect(
      catalogBody.topups.find((topup) => topup.id === planTopupId),
    ).toMatchObject({ eligible: false });

    const response = await checkout(api, standaloneTopupId, E2E_STANDALONE_USER);
    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      checkoutUrl: expect.stringContaining("checkout.stripe.test"),
      purchaseId: expect.any(String),
    });
  });
});

async function createTopup(
  api: APIRequestContext,
  input: {
    key: string;
    name: string;
    eligibility:
      | { type: "standalone" }
      | { type: "plan"; planId: string }
      | { type: "role"; roleId: string };
  },
) {
  const response = await api.post("/api/e2e/topups", {
    data: {
      ...input,
      unitId: E2E_UNIT_ID,
      amount: 1_000,
      priceAmountCents: 500,
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    id: string;
    eligibilityRule: {
      ruleType: string;
      planId: string | null;
      roleId: string | null;
    } | null;
  };
}

function checkout(api: APIRequestContext, topupId: string, rxlabUserId: string) {
  return api.post("/api/v1/checkout", {
    data: { kind: "topup", topupId, rxlabUserId },
  });
}
