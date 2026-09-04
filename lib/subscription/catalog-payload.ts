import "server-only";
import type { Plan } from "@/lib/db/schema";
import type { StoreProductMappingWithPrice } from "@/lib/iap/configuration";
import type { CatalogProduct, PurchaseOption } from "@/lib/paywall/export";

/**
 * The plan as `GET /api/v1/catalog` describes it. Shared with the paywall
 * export so a product card in a paywall carries exactly the fields — and the
 * same StoreKit product id — the app would get from the catalog.
 */

interface AppleIntegrationLike {
  enabled: boolean;
}

/**
 * Which store's price a catalog read should quote. A plan may cost one thing
 * through Stripe and another in the App Store, so the caller says where the
 * user is buying and every price in the response follows.
 */
export const CATALOG_PLATFORMS = ["web", "ios"] as const;
export type CatalogPlatform = (typeof CATALOG_PLATFORMS)[number];

/** `?platform=` on the catalog and paywall endpoints. Unknown values are web. */
export function resolveCatalogPlatform(
  value: string | null | undefined,
): CatalogPlatform {
  const platform = value?.trim().toLowerCase();
  if (platform === "ios" || platform === "apple" || platform === "apple_app_store") {
    return "ios";
  }
  return "web";
}

/**
 * A native Apple client: URLSession stamps every request it makes with its
 * CFNetwork and Darwin versions. Browsers never send that, and every browser —
 * Safari on an iPhone included — sends `Mozilla/`.
 */
const APPLE_NATIVE_USER_AGENT = /CFNetwork\/|Darwin\/|\biOS\b|iPhone|iPad|iPod/i;
const BROWSER_USER_AGENT = /Mozilla\//i;

/**
 * Which store's prices this request should be quoted.
 *
 * An app rarely wants to think about this, so a StoreKit client gets App Store
 * prices without asking: `?platform=` wins when present, then an explicit
 * `X-Platform` header, and otherwise the user agent decides. Only a *native*
 * Apple client counts — Safari on an iPhone buys through Stripe Checkout at the
 * Stripe price, so quoting it App Store prices would misprice the very purchase
 * it is about to make.
 */
export function catalogPlatformForRequest(request: Request): CatalogPlatform {
  const explicit = new URL(request.url).searchParams.get("platform");
  if (explicit?.trim()) return resolveCatalogPlatform(explicit);

  const header = request.headers.get("x-platform");
  if (header?.trim()) return resolveCatalogPlatform(header);

  const userAgent = request.headers.get("user-agent") ?? "";
  if (BROWSER_USER_AGENT.test(userAgent)) return "web";
  return APPLE_NATIVE_USER_AGENT.test(userAgent) ? "ios" : "web";
}

export function appleMappingsByPlan(
  mappings: StoreProductMappingWithPrice[],
): Map<string, StoreProductMappingWithPrice> {
  return new Map(
    mappings
      .filter((mapping) => mapping.provider === "apple_app_store" && mapping.planId)
      .map((mapping) => [mapping.planId!, mapping]),
  );
}

export function appleMappingsByTopup(
  mappings: StoreProductMappingWithPrice[],
): Map<string, StoreProductMappingWithPrice> {
  return new Map(
    mappings
      .filter(
        (mapping) => mapping.provider === "apple_app_store" && mapping.topupProductId,
      )
      .map((mapping) => [mapping.topupProductId!, mapping]),
  );
}

export interface CatalogPrice {
  priceAmountCents: number;
  currency: string;
}

/** The store price when one is configured, otherwise the local catalog price. */
export function storePrice(
  mapping: StoreProductMappingWithPrice | undefined | null,
  local: CatalogPrice,
): CatalogPrice {
  if (mapping?.priceAmountCents === null || mapping?.priceAmountCents === undefined) {
    return { priceAmountCents: local.priceAmountCents, currency: local.currency };
  }
  return {
    priceAmountCents: mapping.priceAmountCents,
    currency: mapping.currency ?? local.currency,
  };
}

/**
 * Every way this item can be bought, each carrying the price that way costs.
 * StoreKit still shows Apple's own localized string; these are the numbers the
 * catalog, the paywall, and reporting agree on.
 */
export function purchaseOptions(input: {
  local: CatalogPrice;
  appleIntegration: AppleIntegrationLike | null;
  apple: StoreProductMappingWithPrice | undefined;
}): PurchaseOption[] {
  const options: PurchaseOption[] = [
    {
      provider: "stripe",
      flow: "checkout",
      priceAmountCents: input.local.priceAmountCents,
      currency: input.local.currency,
    },
  ];
  if (input.appleIntegration?.enabled && input.apple) {
    options.push({
      provider: "apple_app_store",
      flow: "storekit",
      productId: input.apple.productId,
      productType: input.apple.productType,
      ...storePrice(input.apple, input.local),
    });
  }
  return options;
}

/** The price a given platform quotes for an item. */
export function platformPrice(input: {
  local: CatalogPrice;
  platform: CatalogPlatform;
  appleIntegration: AppleIntegrationLike | null;
  apple: StoreProductMappingWithPrice | undefined;
}): CatalogPrice {
  if (input.platform === "ios" && input.appleIntegration?.enabled) {
    return storePrice(input.apple, input.local);
  }
  return input.local;
}

export function planPayload(
  plan: Plan,
  appleIntegration: AppleIntegrationLike | null,
  appleByPlan: Map<string, StoreProductMappingWithPrice>,
  platform: CatalogPlatform = "web",
): CatalogProduct {
  const apple = appleByPlan.get(plan.id);
  const local = {
    priceAmountCents: plan.priceAmountCents,
    currency: plan.currency,
  };
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    description: plan.description,
    planGroup: plan.planGroup,
    billingInterval: plan.billingInterval,
    intervalCount: plan.intervalCount,
    ...platformPrice({ local, platform, appleIntegration, apple }),
    trialDays: plan.trialDays,
    autoSubscribe: plan.autoSubscribe,
    purchaseOptions: plan.autoSubscribe
      ? []
      : purchaseOptions({ local, appleIntegration, apple }),
  };
}
