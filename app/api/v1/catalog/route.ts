import {
  apiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
  resolveRequestUser,
} from "@/lib/api/context";
import { appleMappingsByPlan, planPayload } from "@/lib/subscription/catalog-payload";
import { listPlans } from "@/lib/subscription/plans";
import { checkTopupEligibility, listTopupProducts } from "@/lib/subscription/topups";
import { listBalanceUnits } from "@/lib/subscription/units";
import {
  getAppleIntegration,
  listStoreProductMappings,
} from "@/lib/iap/configuration";

/**
 * The purchasable catalog. When a user is supplied, each topup carries its
 * eligibility verdict so the app can render a locked pack with a reason instead
 * of failing at checkout.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "catalog.read");
    const applicationId = context.application.id;
    const url = new URL(request.url);
    const rxlabUserId = url.searchParams.get("rxlabUserId");

    const [plans, topups, units, appleIntegration, storeMappings] = await Promise.all([
      listPlans(applicationId),
      listTopupProducts(applicationId),
      listBalanceUnits(applicationId),
      getAppleIntegration(applicationId),
      listStoreProductMappings(applicationId),
    ]);
    const unitsById = new Map(units.map((unit) => [unit.id, unit]));

    const activePlans = plans.filter((plan) => plan.status === "active");
    const activeTopups = topups.filter((topup) => topup.status === "active");
    const appleByPlan = appleMappingsByPlan(storeMappings);
    const appleByTopup = new Map(
      storeMappings
        .filter(
          (mapping) => mapping.provider === "apple_app_store" && mapping.topupProductId,
        )
        .map((mapping) => [mapping.topupProductId!, mapping]),
    );

    // A publishable key always has a user, so eligibility is computed whether
    // or not the client bothered to name one.
    const user =
      rxlabUserId || context.user
        ? await resolveRequestUser(context, { rxlabUserId: rxlabUserId ?? undefined })
        : null;

    const topupPayload = [];
    for (const topup of activeTopups) {
      const eligibility = user
        ? await checkTopupEligibility({
            applicationId,
            topupId: topup.id,
            appUserId: user.id,
          })
        : null;
      topupPayload.push({
        id: topup.id,
        key: topup.key,
        name: topup.name,
        description: topup.description,
        unit: unitsById.get(topup.unitId)?.key ?? null,
        amount: topup.amount,
        priceAmountCents: topup.priceAmountCents,
        currency: topup.currency,
        eligible: eligibility?.eligible ?? null,
        blockedBy: eligibility?.failed ?? null,
        purchaseOptions: [
          { provider: "stripe", flow: "checkout" },
          ...(appleIntegration?.enabled && appleByTopup.has(topup.id)
            ? [
                {
                  provider: "apple_app_store",
                  flow: "storekit",
                  productId: appleByTopup.get(topup.id)!.productId,
                  productType: appleByTopup.get(topup.id)!.productType,
                },
              ]
            : []),
        ],
      });
    }

    return Response.json(
      {
        plans: activePlans.map((plan) =>
          planPayload(plan, appleIntegration, appleByPlan),
        ),
        topups: topupPayload,
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
