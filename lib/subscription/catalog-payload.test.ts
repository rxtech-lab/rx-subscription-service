import { describe, expect, it } from "vitest";
import type { Plan } from "@/lib/db/schema";
import type { StoreProductMappingWithPrice } from "@/lib/iap/configuration";
import {
  appleMappingsByPlan,
  catalogPlatformForRequest,
  planPayload,
  purchaseOptions,
  resolveCatalogPlatform,
  storePrice,
} from "./catalog-payload";

const PLAN = {
  id: "plan_1",
  key: "pro",
  name: "Pro",
  description: null,
  planGroup: "default",
  billingInterval: "month",
  intervalCount: 1,
  priceAmountCents: 999,
  currency: "usd",
  trialDays: 7,
} as Plan;

function mapping(
  overrides: Partial<StoreProductMappingWithPrice> = {},
): StoreProductMappingWithPrice {
  return {
    id: "map_1",
    applicationId: "app_1",
    provider: "apple_app_store",
    productId: "com.rxlab.app.pro.monthly",
    productType: "auto_renewable_subscription",
    planId: PLAN.id,
    topupProductId: null,
    priceAmountCents: 1_299,
    currency: "usd",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const ENABLED = { enabled: true };

describe("resolveCatalogPlatform", () => {
  it("accepts the App Store spellings and defaults everything else to web", () => {
    expect(resolveCatalogPlatform("ios")).toBe("ios");
    expect(resolveCatalogPlatform("Apple")).toBe("ios");
    expect(resolveCatalogPlatform(" apple_app_store ")).toBe("ios");
    expect(resolveCatalogPlatform("android")).toBe("web");
    expect(resolveCatalogPlatform(null)).toBe("web");
  });
});

describe("catalogPlatformForRequest", () => {
  const ask = (init: { url?: string; headers?: Record<string, string> } = {}) =>
    catalogPlatformForRequest(
      new Request(init.url ?? "https://rxargo.test/api/v1/catalog", {
        headers: init.headers,
      }),
    );

  it("prices a native StoreKit client from the App Store without being asked", () => {
    expect(
      ask({ headers: { "user-agent": "MyApp/1.2 CFNetwork/1494.0.7 Darwin/23.4.0" } }),
    ).toBe("ios");
  });

  it("keeps mobile Safari on web prices, since it checks out through Stripe", () => {
    expect(
      ask({
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1",
        },
      }),
    ).toBe("web");
  });

  it("defaults to web for a server-side or unidentified caller", () => {
    expect(ask()).toBe("web");
    expect(ask({ headers: { "user-agent": "curl/8.4.0" } })).toBe("web");
  });

  it("lets a client name its platform outright", () => {
    expect(ask({ headers: { "x-platform": "ios" } })).toBe("ios");
    expect(
      ask({
        headers: { "x-platform": "web", "user-agent": "MyApp/1.2 CFNetwork/1494.0.7" },
      }),
    ).toBe("web");
  });

  it("lets the query string overrule both", () => {
    expect(
      ask({
        url: "https://rxargo.test/api/v1/catalog?platform=ios",
        headers: { "user-agent": "Mozilla/5.0", "x-platform": "web" },
      }),
    ).toBe("ios");
    expect(
      ask({
        url: "https://rxargo.test/api/v1/catalog?platform=web",
        headers: { "user-agent": "MyApp/1.2 CFNetwork/1494.0.7" },
      }),
    ).toBe("web");
  });
});

describe("storePrice", () => {
  const local = { priceAmountCents: 999, currency: "usd" };

  it("uses the store price when the mapping carries one", () => {
    expect(storePrice(mapping(), local)).toEqual({
      priceAmountCents: 1_299,
      currency: "usd",
    });
  });

  it("falls back to the local price when the mapping has none", () => {
    expect(storePrice(mapping({ priceAmountCents: null, currency: null }), local)).toEqual(
      local,
    );
    expect(storePrice(undefined, local)).toEqual(local);
  });

  it("keeps a free store price rather than reading 0 as unset", () => {
    expect(
      storePrice(mapping({ priceAmountCents: 0 }), local).priceAmountCents,
    ).toBe(0);
  });
});

describe("purchaseOptions", () => {
  const local = { priceAmountCents: 999, currency: "usd" };

  it("prices each provider separately", () => {
    expect(
      purchaseOptions({ local, appleIntegration: ENABLED, apple: mapping() }),
    ).toEqual([
      { provider: "stripe", flow: "checkout", priceAmountCents: 999, currency: "usd" },
      {
        provider: "apple_app_store",
        flow: "storekit",
        productId: "com.rxlab.app.pro.monthly",
        productType: "auto_renewable_subscription",
        priceAmountCents: 1_299,
        currency: "usd",
      },
    ]);
  });

  it("omits StoreKit while the integration is disabled", () => {
    expect(
      purchaseOptions({
        local,
        appleIntegration: { enabled: false },
        apple: mapping(),
      }),
    ).toHaveLength(1);
  });
});

describe("planPayload", () => {
  const byPlan = appleMappingsByPlan([mapping()]);

  it("quotes the local price on web and the App Store price on ios", () => {
    expect(planPayload(PLAN, ENABLED, byPlan).priceAmountCents).toBe(999);
    expect(planPayload(PLAN, ENABLED, byPlan, "ios").priceAmountCents).toBe(1_299);
  });

  it("quotes the local price on ios when nothing overrides it", () => {
    const unpriced = appleMappingsByPlan([
      mapping({ priceAmountCents: null, currency: null }),
    ]);
    expect(planPayload(PLAN, ENABLED, unpriced, "ios").priceAmountCents).toBe(999);
    expect(planPayload(PLAN, ENABLED, new Map(), "ios").priceAmountCents).toBe(999);
  });

  it("ignores the store price while the integration is disabled", () => {
    expect(
      planPayload(PLAN, { enabled: false }, byPlan, "ios").priceAmountCents,
    ).toBe(999);
  });
});
