/**
 * Pick the allowance that applies to one subscription status.
 *
 * Older entitlement snapshots predate `trialLimitValue`; falling back to the
 * regular value keeps those already-purchased plans behaving exactly as they
 * did before trial-specific allowances existed. A present null remains an
 * explicit unlimited allowance.
 */
export function usageLimitForSubscriptionStatus(
  entitlement: {
    limitValue: number | null;
    trialLimitValue?: number | null;
  },
  status: string,
): number | null {
  if (status === "trialing" && entitlement.trialLimitValue !== undefined) {
    return entitlement.trialLimitValue;
  }
  return entitlement.limitValue;
}
