import "server-only";
import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { balanceLots, balances, ledgerEntries } from "@/lib/db/schema";
import { newId } from "./shared";
import { planLotExpiry, resolveExpiresAfterPlanEnd } from "./balance-expiry-rules";
import { expireBalanceReservations } from "./balance-reservations";

export { drainLots, openLot, type OpenLotInput } from "./balance-lots-core";

/**
 * The tranche mechanics behind balance expiry.
 *
 * Everything here maintains one invariant: `SUM(balance_lots.remaining)` equals
 * `MAX(0, balances.amount)` for a given (user, unit). `balances.amount` remains
 * the number every guard and every read uses; the lots exist only so that a
 * subset of it can be taken away when a grant lapses.
 */

/**
 * Stamp the lots a subscription granted with a real expiry, now that the plan
 * has ended and `after_plan_end` finally has an anchor to count from.
 *
 * Only ever narrows: a lot that already carries an expiry keeps it, so a
 * re-delivered `customer.subscription.deleted` cannot push an expiry outwards.
 */
export async function stampLotsForPlanEnd(input: {
  subscriptionId: string;
  endedAt: Date;
}) {
  const pending = await db
    .select()
    .from(balanceLots)
    .where(
      and(
        eq(balanceLots.subscriptionId, input.subscriptionId),
        eq(balanceLots.expiryPolicy, "after_plan_end"),
        gt(balanceLots.remaining, 0),
      ),
    );

  const now = new Date();
  let stamped = 0;
  for (const lot of pending) {
    if (lot.expiresAt) continue;
    const expiresAt = resolveExpiresAfterPlanEnd(input.endedAt, lot.expiryMonths);
    if (!expiresAt) continue;
    await db
      .update(balanceLots)
      .set({ expiresAt, updatedAt: now })
      .where(and(eq(balanceLots.id, lot.id), sql`${balanceLots.expiresAt} IS NULL`));
    stamped += 1;
  }
  return stamped;
}

export interface ExpireLotsInput {
  appUserId?: string;
  unitId?: string;
  /** Overridable so the sweep and the tests can pin the clock. */
  now?: Date;
  /** Caps one sweep pass. The workflow job loops until a pass expires nothing. */
  limit?: number;
}

export interface ExpiredLotsResult {
  lots: number;
  units: number;
}

/**
 * Zero every lot whose expiry has passed and take the units off the balance.
 *
 * Called lazily from the debit and read paths so a balance is never observed
 * containing units that already lapsed, and on a schedule by the sweep workflow
 * so an idle user's balance and ledger do not sit stale.
 *
 * Reserved units are never expired out from under an open hold: the balance is
 * only reduced as far as `amount - reserved`, and whatever is left over stays on
 * the lot for the next pass, once the hold settles or lapses.
 */
export async function expireBalanceLots(
  input: ExpireLotsInput = {},
): Promise<ExpiredLotsResult> {
  const now = input.now ?? new Date();

  // Releasing lapsed holds first maximises the headroom available below, so a
  // stale reservation cannot indefinitely postpone an expiry.
  await expireBalanceReservations({
    appUserId: input.appUserId,
    unitId: input.unitId,
  });

  const scope = [
    lte(balanceLots.expiresAt, now),
    isNotNull(balanceLots.expiresAt),
    gt(balanceLots.remaining, 0),
    ...(input.appUserId ? [eq(balanceLots.appUserId, input.appUserId)] : []),
    ...(input.unitId ? [eq(balanceLots.unitId, input.unitId)] : []),
  ];

  const due = await db
    .select()
    .from(balanceLots)
    .where(and(...scope))
    .orderBy(asc(balanceLots.expiresAt))
    .limit(input.limit ?? 500);
  if (due.length === 0) return { lots: 0, units: 0 };

  // One transaction per (user, unit): the balance row is the contended object,
  // and a single failing balance must not roll back every other user's sweep.
  const byBalance = new Map<string, typeof due>();
  for (const lot of due) {
    const key = `${lot.appUserId}:${lot.unitId}`;
    const bucket = byBalance.get(key);
    if (bucket) bucket.push(lot);
    else byBalance.set(key, [lot]);
  }

  let expiredLots = 0;
  let expiredUnits = 0;

  for (const bucket of byBalance.values()) {
    const { appUserId, unitId } = bucket[0];
    const result = await db.transaction(async (tx) => {
      const [balance] = await tx
        .select()
        .from(balances)
        .where(and(eq(balances.appUserId, appUserId), eq(balances.unitId, unitId)))
        .limit(1);
      if (!balance) return { lots: 0, units: 0 };

      const headroom = balance.amount - balance.reserved;
      if (headroom <= 0) return { lots: 0, units: 0 };

      // Re-read under the transaction: a debit between the scan above and here
      // may already have spent part of these lots.
      const fresh = await tx
        .select()
        .from(balanceLots)
        .where(
          and(
            inArray(
              balanceLots.id,
              bucket.map((lot) => lot.id),
            ),
            gt(balanceLots.remaining, 0),
          ),
        );
      const byId = new Map(fresh.map((lot) => [lot.id, lot]));

      let lots = 0;
      let units = 0;
      for (const draw of planLotExpiry(fresh, headroom)) {
        const current = byId.get(draw.lotId)!;
        const take = draw.take;
        const nextRemaining = current.remaining - take;
        await tx
          .update(balanceLots)
          .set({
            remaining: nextRemaining,
            // Only settled once the lot is actually empty; a partial expiry
            // that hit the reserved floor must stay visible to the next pass.
            expiredAt: nextRemaining === 0 ? now : null,
            updatedAt: now,
          })
          .where(eq(balanceLots.id, current.id));

        const [updated] = await tx
          .update(balances)
          .set({ amount: sql`${balances.amount} - ${take}`, updatedAt: now })
          .where(and(eq(balances.appUserId, appUserId), eq(balances.unitId, unitId)))
          .returning();

        await tx
          .insert(ledgerEntries)
          .values({
            id: newId(),
            appUserId,
            unitId,
            kind: "expiry",
            delta: -take,
            balanceAfter: updated.amount,
            description: "Units expired",
            referenceType: "balance_lot",
            referenceId: current.id,
            // `current.remaining` distinguishes successive partial expiries of
            // the same lot, while a retried identical pass still dedupes.
            idempotencyKey: `expiry:${current.id}:${current.remaining}`,
            metadata: {
              expiryPolicy: current.expiryPolicy,
              expiresAt: current.expiresAt?.toISOString() ?? null,
              planId: current.planId,
              subscriptionId: current.subscriptionId,
            },
            createdAt: now,
          })
          .onConflictDoNothing();

        units += take;
        if (nextRemaining === 0) lots += 1;
      }
      return { lots, units };
    });

    expiredLots += result.lots;
    expiredUnits += result.units;
  }

  return { lots: expiredLots, units: expiredUnits };
}

/**
 * What is going to expire, and when. Powers the console's balance detail and
 * lets an application warn a user before they lose units.
 */
export async function listUpcomingExpiries(input: {
  appUserId: string;
  unitId?: string;
}) {
  return db
    .select({
      lotId: balanceLots.id,
      unitId: balanceLots.unitId,
      remaining: balanceLots.remaining,
      expiresAt: balanceLots.expiresAt,
      expiryPolicy: balanceLots.expiryPolicy,
      planId: balanceLots.planId,
    })
    .from(balanceLots)
    .where(
      and(
        eq(balanceLots.appUserId, input.appUserId),
        gt(balanceLots.remaining, 0),
        isNotNull(balanceLots.expiresAt),
        ...(input.unitId ? [eq(balanceLots.unitId, input.unitId)] : []),
      ),
    )
    .orderBy(asc(balanceLots.expiresAt));
}
