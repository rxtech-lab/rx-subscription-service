import "server-only";
import type { Plan, StoreProductMapping } from "@/lib/db/schema";
import type { CatalogProduct } from "@/lib/paywall/export";

/**
 * The plan as `GET /api/v1/catalog` describes it. Shared with the paywall
 * export so a product card in a paywall carries exactly the fields — and the
 * same StoreKit product id — the app would get from the catalog.
 */

interface AppleIntegrationLike {
  enabled: boolean;
}

export function appleMappingsByPlan(
  mappings: StoreProductMapping[],
): Map<string, StoreProductMapping> {
  return new Map(
    mappings
      .filter((mapping) => mapping.provider === "apple_app_store" && mapping.planId)
      .map((mapping) => [mapping.planId!, mapping]),
  );
}

export function planPayload(
  plan: Plan,
  appleIntegration: AppleIntegrationLike | null,
  appleByPlan: Map<string, StoreProductMapping>,
): CatalogProduct {
  const apple = appleByPlan.get(plan.id);
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    description: plan.description,
    planGroup: plan.planGroup,
    billingInterval: plan.billingInterval,
    intervalCount: plan.intervalCount,
    priceAmountCents: plan.priceAmountCents,
    currency: plan.currency,
    trialDays: plan.trialDays,
    purchaseOptions: [
      { provider: "stripe", flow: "checkout" },
      ...(appleIntegration?.enabled && apple
        ? [
            {
              provider: "apple_app_store",
              flow: "storekit",
              productId: apple.productId,
              productType: apple.productType,
            },
          ]
        : []),
    ],
  };
}
