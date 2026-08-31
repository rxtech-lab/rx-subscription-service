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

/**
 * Pick the balance grant that applies to one subscription status.
 *
 * Both null database values and missing fields in older entitlement snapshots
 * inherit the regular amount. Zero is intentionally preserved so a plan can
 * grant no stored units during its trial.
 */
export function balanceAmountForSubscriptionStatus(
  entitlement: {
    amount: number | null;
    trialAmount?: number | null;
  },
  status: string,
): number | null {
  if (status === "trialing" && typeof entitlement.trialAmount === "number") {
    return entitlement.trialAmount;
  }
  return entitlement.amount;
}
