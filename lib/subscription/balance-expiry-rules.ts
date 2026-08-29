import type { BalanceExpiryPolicy } from "@/lib/db/schema";

/**
 * When a grant's units stop being spendable.
 *
 * Pure date arithmetic, deliberately separated from the database so the four
 * policies can be tested without a balance, a subscription, or a clock.
 */

export interface ExpiryPolicyInput {
  policy: BalanceExpiryPolicy;
  months: number | null;
  /** When the units were granted. */
  grantedAt: Date;
  /** End of the billing period the grant belongs to, when there is one. */
  periodEnd?: Date | null;
}

/**
 * Add whole months in UTC, clamping to the last day of the target month.
 *
 * `Date.UTC` would roll 31 January + 1 month over into 3 March; a balance that
 * expires on a date the user never sees is a support ticket, so the overflow is
 * pulled back to 28/29 February instead.
 */
export function addMonthsUtc(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const target = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/**
 * The instant a lot expires, or null for "not yet knowable" / "never".
 *
 * `after_plan_end` returns null here on purpose: the subscription has not ended
 * when the grant is made, so the lot is opened without an expiry and stamped by
 * `stampLotsForPlanEnd` once `endedAt` exists. Treating that null as "never"
 * would be wrong, which is why the policy is stored on the lot too.
 */
export function resolveExpiresAt(input: ExpiryPolicyInput): Date | null {
  switch (input.policy) {
    case "never":
      return null;

    case "period_end":
      // A grant outside any billing window (a one-time plan, or a subscription
      // Stripe reported without a period) has no period to expire at the end
      // of, so it behaves as `never` rather than expiring immediately.
      return input.periodEnd ?? null;

    case "duration":
      if (!input.months) return null;
      return addMonthsUtc(input.grantedAt, input.months);

    case "after_plan_end":
      return null;
  }
}

/** The instant an `after_plan_end` lot expires, once the plan has ended. */
export function resolveExpiresAfterPlanEnd(
  endedAt: Date,
  months: number | null,
): Date | null {
  if (!months) return null;
  return addMonthsUtc(endedAt, months);
}

/** Does this policy need `balanceExpiryMonths` to mean anything? */
export function policyRequiresMonths(policy: BalanceExpiryPolicy): boolean {
  return policy === "duration" || policy === "after_plan_end";
}

/** The ordering key for spending: soonest expiry first, non-expiring last. */
export interface DrawableLot {
  id: string;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface LotDraw {
  lotId: string;
  take: number;
}

/**
 * Sort lots into the order they should be spent.
 *
 * Soonest-expiring first is what makes expiry fair to the user: units they are
 * about to lose are spent before units they could have kept. Lots that never
 * expire sort last and act as the reserve. Ties break on grant order so the
 * result is stable rather than dependent on however the rows came back.
 */
export function orderLotsForDraw<T extends DrawableLot>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiresAt && b.expiresAt) {
      const diff = a.expiresAt.getTime() - b.expiresAt.getTime();
      if (diff !== 0) return diff;
    } else if (a.expiresAt) {
      return -1;
    } else if (b.expiresAt) {
      return 1;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/**
 * Split `amount` across the lots in spend order.
 *
 * Returns one entry per lot actually touched. The sum of the takes falls short
 * of `amount` only when the lots do not cover it, which the caller treats as
 * the debt a reversal has left behind.
 */
export function planLotDraw(
  lots: readonly DrawableLot[],
  amount: number,
): LotDraw[] {
  const draws: LotDraw[] = [];
  let outstanding = amount;
  for (const lot of orderLotsForDraw(lots)) {
    if (outstanding <= 0) break;
    if (lot.remaining <= 0) continue;
    const take = Math.min(lot.remaining, outstanding);
    draws.push({ lotId: lot.id, take });
    outstanding -= take;
  }
  return draws;
}

/**
 * Split the expiry of already-lapsed lots across the headroom available.
 *
 * `headroom` is `balances.amount - balances.reserved`: units under an open hold
 * cannot be expired out from under it, so a lot that runs into that floor is
 * only partly expired and the remainder waits for the next pass.
 */
export function planLotExpiry(
  lots: readonly DrawableLot[],
  headroom: number,
): LotDraw[] {
  const draws: LotDraw[] = [];
  let available = Math.max(0, headroom);
  // Already ordered by expiry at the query, but sorting again keeps this
  // function correct on its own terms rather than on the caller's.
  for (const lot of orderLotsForDraw(lots)) {
    if (available <= 0) break;
    if (lot.remaining <= 0) continue;
    const take = Math.min(lot.remaining, available);
    draws.push({ lotId: lot.id, take });
    available -= take;
  }
  return draws;
}
