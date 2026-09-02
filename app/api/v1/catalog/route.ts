import {
  apiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
  resolveRequestUser,
} from "@/lib/api/context";
import {
  appleMappingsByPlan,
  appleMappingsByTopup,
  catalogPlatformForRequest,
  planPayload,
  platformPrice,
  purchaseOptions,
} from "@/lib/subscription/catalog-payload";
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
 *
 * Prices follow the platform that asked: a StoreKit client is quoted App Store
 * prices without passing anything, and `?platform=` or an `X-Platform` header
 * overrides that. Every response also lists each purchase option's own price.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "catalog.read");
    const applicationId = context.application.id;
    const url = new URL(request.url);
    const rxlabUserId = url.searchParams.get("rxlabUserId");
    const platform = catalogPlatformForRequest(request);

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
    const appleByTopup = appleMappingsByTopup(storeMappings);

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
      const apple = appleByTopup.get(topup.id);
      const local = {
        priceAmountCents: topup.priceAmountCents,
        currency: topup.currency,
      };
      topupPayload.push({
        id: topup.id,
        key: topup.key,
        name: topup.name,
        description: topup.description,
        unit: unitsById.get(topup.unitId)?.key ?? null,
        amount: topup.amount,
        ...platformPrice({ local, platform, appleIntegration, apple }),
        eligible: eligibility?.eligible ?? null,
        blockedBy: eligibility?.failed ?? null,
        purchaseOptions: purchaseOptions({ local, appleIntegration, apple }),
      });
    }

    return Response.json(
      {
        // Named so a client can tell which store's prices it is holding —
        // detection is automatic, and a misprice should be visible, not silent.
        platform,
        plans: activePlans.map((plan) =>
          planPayload(plan, appleIntegration, appleByPlan, platform),
        ),
        topups: topupPayload,
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
