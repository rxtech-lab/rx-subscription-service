export type ChangeTiming = "immediate" | "next_period";
type PricePlan = { priceAmountCents: number; billingInterval: string; intervalCount: number };

/** Compare equivalent recurring prices; payment-free plans have a zero price. */
export function isPlanDowngrade(current: PricePlan, target: PricePlan) {
  const months = (plan: PricePlan) => (plan.billingInterval === "year" ? 12 : plan.billingInterval === "quarter" ? 3 : 1) * plan.intervalCount;
  return target.priceAmountCents * months(current) < current.priceAmountCents * months(target);
}

export function assertChangeTiming(current: PricePlan, target: PricePlan, timing: ChangeTiming) {
  if (timing === "immediate" && isPlanDowngrade(current, target)) {
    throw new Error("Downgrades must start at the next billing period");
  }
}
