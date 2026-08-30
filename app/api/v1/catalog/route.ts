import {
  apiError,
  authenticateApiRequest,
  noStore,
  resolveRequestUser,
} from "@/lib/api/context";
import { listPlans } from "@/lib/subscription/plans";
import { checkTopupEligibility, listTopupProducts } from "@/lib/subscription/topups";
import { listBalanceUnits } from "@/lib/subscription/units";

/**
 * The purchasable catalog. When a user is supplied, each topup carries its
 * eligibility verdict so the app can render a locked pack with a reason instead
 * of failing at checkout.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const applicationId = context.application.id;
    const url = new URL(request.url);
    const rxlabUserId = url.searchParams.get("rxlabUserId");

    const [plans, topups, units] = await Promise.all([
      listPlans(applicationId),
      listTopupProducts(applicationId),
      listBalanceUnits(applicationId),
    ]);
    const unitsById = new Map(units.map((unit) => [unit.id, unit]));

    const activePlans = plans.filter((plan) => plan.status === "active");
    const activeTopups = topups.filter((topup) => topup.status === "active");

    const user = rxlabUserId
      ? await resolveRequestUser(context, { rxlabUserId })
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
      });
    }

    return Response.json(
      {
        plans: activePlans.map((plan) => ({
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
        })),
        topups: topupPayload,
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
