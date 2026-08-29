import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { balanceLots, type BalanceExpiryPolicy } from "@/lib/db/schema";
import { newId } from "./shared";
import { planLotDraw } from "./balance-expiry-rules";

/**
 * Tranche primitives that mutate lots inside a caller's transaction.
 *
 * Split out from `balance-lots.ts` for the same reason `balance-core.ts` is
 * split from `users.ts`: the reservation module has to draw lots down when it
 * settles, and the expiry sweep has to release reservations before it runs.
 * Keeping the primitives free of any reservation import breaks what would
 * otherwise be a cycle between the two.
 */

/** A drizzle transaction handle. Every helper here must run inside one. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OpenLotInput {
  appUserId: string;
  unitId: string;
  amount: number;
  ledgerEntryId: string | null;
  expiresAt: Date | null;
  expiryPolicy?: BalanceExpiryPolicy;
  expiryMonths?: number | null;
  subscriptionId?: string | null;
  planId?: string | null;
  now: Date;
}

/**
 * Record newly credited units as a spendable tranche.
 *
 * `debt` is how far the balance was below zero before this credit. A reversal
 * can claw back units the user already spent, which drives `balances.amount`
 * negative while every lot is already empty. The credit has to settle that debt
 * before any of it becomes spendable again, otherwise the sum of the lots would
 * overstate the balance and expiry could remove units that were never there.
 */
export async function openLot(tx: Tx, input: OpenLotInput, debt = 0) {
  const spendable = input.amount - Math.max(0, debt);
  if (spendable <= 0) return null;

  const [lot] = await tx
    .insert(balanceLots)
    .values({
      id: newId(),
      appUserId: input.appUserId,
      unitId: input.unitId,
      ledgerEntryId: input.ledgerEntryId,
      originalAmount: spendable,
      remaining: spendable,
      expiresAt: input.expiresAt,
      expiryPolicy: input.expiryPolicy ?? "never",
      expiryMonths: input.expiryMonths ?? null,
      subscriptionId: input.subscriptionId ?? null,
      planId: input.planId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  return lot;
}

/**
 * Spend `amount` from the open lots, soonest expiry first.
 *
 * Draining in expiry order is what makes the feature fair: units the user is
 * about to lose are spent before units they could have kept. Lots that never
 * expire sort last so they act as the reserve.
 *
 * Returns how much was actually drained, which is less than `amount` only when
 * the lots do not cover it — the negative-balance reversal path.
 */
export async function drainLots(
  tx: Tx,
  appUserId: string,
  unitId: string,
  amount: number,
  now: Date,
): Promise<number> {
  const open = await tx
    .select()
    .from(balanceLots)
    .where(
      and(
        eq(balanceLots.appUserId, appUserId),
        eq(balanceLots.unitId, unitId),
        gt(balanceLots.remaining, 0),
      ),
    );

  const draws = planLotDraw(open, amount);
  const byId = new Map(open.map((lot) => [lot.id, lot]));
  for (const draw of draws) {
    const lot = byId.get(draw.lotId)!;
    await tx
      .update(balanceLots)
      .set({ remaining: lot.remaining - draw.take, updatedAt: now })
      .where(eq(balanceLots.id, lot.id));
  }
  return draws.reduce((total, draw) => total + draw.take, 0);
}
