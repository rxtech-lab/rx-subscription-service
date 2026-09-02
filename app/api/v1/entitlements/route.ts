import {
  apiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
  resolveRequestUser,
} from "@/lib/api/context";
import { resolveEntitlements } from "@/lib/subscription/entitlements";
import { getBalances } from "@/lib/subscription/users";
import { getUsageStatus } from "@/lib/subscription/usage";

/**
 * Everything an application needs to gate a feature in one call: the active
 * plans, subscription roles, serialized permission expressions, balances, and
 * every usage item with its remaining allowance and reset time.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "entitlements.read");
    const url = new URL(request.url);
    const user = await resolveRequestUser(context, {
      rxlabUserId: url.searchParams.get("rxlabUserId") ?? undefined,
      email: url.searchParams.get("email"),
    });

    const applicationId = context.application.id;
    const [entitlements, balances, usage] = await Promise.all([
      resolveEntitlements({ applicationId, appUserId: user.id }),
      getBalances(user.id),
      getUsageStatus({ applicationId, appUserId: user.id }),
    ]);

    return Response.json(
      {
        user: {
          id: user.id,
          rxlabUserId: user.rxlabUserId,
          level: user.level,
          levelKey: user.levelKey,
        },
        plans: entitlements.plans,
        roles: entitlements.roleKeys,
        permissions: entitlements.permissions,
        features: entitlements.features,
        balances: balances.map((balance) => ({
          unit: balance.unitKey,
          name: balance.unitName,
          symbol: balance.symbol,
          precision: balance.precision,
          amount: balance.amount,
          available: balance.amount - balance.reserved,
        })),
        usage: usage.map((item) => ({
          key: item.key,
          name: item.name,
          used: item.used,
          limit: item.limit,
          remaining: item.remaining,
          resetsAt: item.resetsAt,
          resetPolicy: item.resetPolicy,
        })),
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
