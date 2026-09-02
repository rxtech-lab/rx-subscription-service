import "server-only";
import { getAppleIntegration, listStoreProductMappings } from "@/lib/iap/configuration";
import { appleMappingsByPlan, planPayload } from "@/lib/subscription/catalog-payload";
import { listPlans } from "@/lib/subscription/plans";
import type { CatalogProduct } from "./export";

/** The active plans of one application, shaped like the catalog endpoint's. */
export async function productsForApplication(applicationId: string): Promise<CatalogProduct[]> {
  const [plans, appleIntegration, mappings] = await Promise.all([
    listPlans(applicationId),
    getAppleIntegration(applicationId),
    listStoreProductMappings(applicationId),
  ]);
  const appleByPlan = appleMappingsByPlan(mappings);
  return plans
    .filter((plan) => plan.status === "active")
    .map((plan) => planPayload(plan, appleIntegration, appleByPlan));
}
