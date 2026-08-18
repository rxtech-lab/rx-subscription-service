import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  usageCounters,
  usageRecords,
  type UsageCounter,
  type UsageItem,
} from "@/lib/db/schema";
import {
  assertPositiveInteger,
  newId,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";
import { resolvePeriod, type Period } from "./periods";
import { simulatedNow } from "./test-clock";
import { getBillingWindow, resolveEntitlements } from "./entitlements";
import { listUsageItems, requireUsageItem } from "./usage-items";
import { debitBalance, InsufficientBalanceError, requireAppUser } from "./users";

export interface UsageStatus {
  itemId: string;
  key: string;
  name: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date | null;
  resetsAt: Date | null;
  resetPolicy: UsageItem["resetPolicy"];
  overagePolicy: UsageItem["overagePolicy"];
}

/**
 * Open the counter row for the period `now` falls in, creating it if needed.
 *
 * This is the lazy reset: nothing resets counters on a schedule — asking for the
 * current period is what rolls a lapsed one over.
 */
async function openCounter(input: {
  appUserId: string;
  item: UsageItem;
  period: Period;
  limit: number | null;
  now: Date;
}): Promise<UsageCounter> {
  const [existing] = await db
    .select()
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.appUserId, input.appUserId),
        eq(usageCounters.usageItemId, input.item.id),
        eq(usageCounters.periodStart, input.period.start),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(usageCounters)
    .values({
      id: newId(),
      appUserId: input.appUserId,
      usageItemId: input.item.id,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      used: 0,
      limitValue: input.limit,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost the race — the row another request created is equally valid.
  const [raced] = await db
    .select()
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.appUserId, input.appUserId),
        eq(usageCounters.usageItemId, input.item.id),
        eq(usageCounters.periodStart, input.period.start),
      ),
    )
    .limit(1);
  return raced;
}

/** The most recent counter for an item, used to anchor rolling windows. */
async function latestCounter(appUserId: string, usageItemId: string) {
  const [counter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.appUserId, appUserId),
        eq(usageCounters.usageItemId, usageItemId),
      ),
    )
    .orderBy(sql`${usageCounters.periodStart} DESC`)
    .limit(1);
  return counter ?? null;
}

async function resolveLimit(input: {
  applicationId: string;
  appUserId: string;
  item: UsageItem;
}): Promise<number | null> {
  const entitlements = await resolveEntitlements({
    applicationId: input.applicationId,
    appUserId: input.appUserId,
  });
  // An explicit plan allowance wins; otherwise the item's own default applies.
  return input.item.id in entitlements.usageLimits
    ? entitlements.usageLimits[input.item.id]
    : input.item.defaultLimit;
}

export async function getUsageStatus(input: {
  applicationId: string;
  appUserId: string;
  now?: Date;
}): Promise<UsageStatus[]> {
  const items = await listUsageItems(input.applicationId);
  if (items.length === 0) return [];

  // A test user may be living at a simulated time; for everyone else the offset
  // is zero and this is the wall clock.
  const user = await requireAppUser(input.applicationId, input.appUserId);
  const now = input.now ?? simulatedNow(user.testClockOffsetMs);

  const entitlements = await resolveEntitlements({
    applicationId: input.applicationId,
    appUserId: input.appUserId,
  });
  const billing = await getBillingWindow({
    applicationId: input.applicationId,
    appUserId: input.appUserId,
  });

  const statuses: UsageStatus[] = [];
  for (const item of items) {
    const previous = await latestCounter(input.appUserId, item.id);
    const period = resolvePeriod(now, {
      resetPolicy: item.resetPolicy,
      resetIntervalCount: item.resetIntervalCount,
      resetIntervalUnit: item.resetIntervalUnit,
      currentStart: previous?.periodStart ?? null,
      currentEnd: previous?.periodEnd ?? null,
      billingPeriodStart: billing.start,
      billingPeriodEnd: billing.end,
    });

    const limit =
      item.id in entitlements.usageLimits
        ? entitlements.usageLimits[item.id]
        : item.defaultLimit;

    // Read-only: a counter that has not been opened yet simply reads as zero.
    const current =
      previous && previous.periodStart.getTime() === period.start.getTime()
        ? previous
        : null;
    const used = current?.used ?? 0;

    statuses.push({
      itemId: item.id,
      key: item.key,
      name: item.name,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
      periodStart: period.start,
      periodEnd: period.end,
      resetsAt: period.end,
      resetPolicy: item.resetPolicy,
      overagePolicy: item.overagePolicy,
    });
  }
  return statuses;
}

export interface RecordUsageResult {
  allowed: boolean;
  reason?: "limit_exceeded" | "insufficient_balance";
  used: number;
  limit: number | null;
  remaining: number | null;
  chargedUnits: number;
  periodEnd: Date | null;
  duplicate: boolean;
}

/**
 * Meter usage for one user.
 *
 * `idempotencyKey` is unique across all usage records, so a client that retries
 * a request after a timeout re-reads its original result instead of
 * double-charging. Callers should derive it from their own operation id.
 */
export async function recordUsage(input: {
  applicationId: string;
  appUserId: string;
  usageItemId: string;
  amount: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | null;
  now?: Date;
}): Promise<RecordUsageResult> {
  const amount = assertPositiveInteger(input.amount, "amount");
  if (!input.idempotencyKey.trim()) {
    throw new ValidationError("idempotencyKey is required");
  }

  const user = await requireAppUser(input.applicationId, input.appUserId);
  const now = input.now ?? simulatedNow(user.testClockOffsetMs);
  const item = await requireUsageItem(input.applicationId, input.usageItemId);

  const [duplicate] = await db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (duplicate) {
    const limit = await resolveLimit({
      applicationId: input.applicationId,
      appUserId: input.appUserId,
      item,
    });
    return {
      allowed: true,
      used: duplicate.usedAfter,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - duplicate.usedAfter),
      chargedUnits: duplicate.chargedUnits,
      periodEnd: null,
      duplicate: true,
    };
  }

  const limit = await resolveLimit({
    applicationId: input.applicationId,
    appUserId: input.appUserId,
    item,
  });
  const billing = await getBillingWindow({
    applicationId: input.applicationId,
    appUserId: input.appUserId,
  });
  const previous = await latestCounter(input.appUserId, item.id);
  const period = resolvePeriod(now, {
    resetPolicy: item.resetPolicy,
    resetIntervalCount: item.resetIntervalCount,
    resetIntervalUnit: item.resetIntervalUnit,
    currentStart: previous?.periodStart ?? null,
    currentEnd: previous?.periodEnd ?? null,
    billingPeriodStart: billing.start,
    billingPeriodEnd: billing.end,
  });

  const counter = await openCounter({
    appUserId: input.appUserId,
    item,
    period,
    limit,
    now,
  });

  const overBy =
    limit === null ? 0 : Math.max(0, counter.used + amount - limit);

  if (overBy > 0 && item.overagePolicy === "block") {
    return {
      allowed: false,
      reason: "limit_exceeded",
      used: counter.used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - counter.used),
      chargedUnits: 0,
      periodEnd: period.end,
      duplicate: false,
    };
  }

  // Charge for the portion above the allowance before the counter moves, so a
  // failed charge leaves usage untouched.
  let chargedUnits = 0;
  if (overBy > 0 && item.overagePolicy === "charge_balance") {
    const cost = overBy * (item.overageCostPerUnit ?? 0);
    if (cost > 0 && item.overageUnitId) {
      try {
        await debitBalance({
          appUserId: input.appUserId,
          unitId: item.overageUnitId,
          amount: cost,
          kind: "overage",
          description: `Overage on ${item.name}`,
          idempotencyKey: `overage:${input.idempotencyKey}`,
          referenceType: "usage_item",
          referenceId: item.id,
        });
        chargedUnits = cost;
      } catch (error) {
        if (error instanceof InsufficientBalanceError) {
          return {
            allowed: false,
            reason: "insufficient_balance",
            used: counter.used,
            limit,
            remaining: limit === null ? null : Math.max(0, limit - counter.used),
            chargedUnits: 0,
            periodEnd: period.end,
            duplicate: false,
          };
        }
        throw error;
      }
    }
  }

  const usedAfter = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(usageCounters)
      .set({ used: sql`${usageCounters.used} + ${amount}`, updatedAt: now })
      .where(eq(usageCounters.id, counter.id))
      .returning();

    await tx.insert(usageRecords).values({
      id: newId(),
      appUserId: input.appUserId,
      usageItemId: item.id,
      counterId: counter.id,
      amount,
      usedAfter: updated.used,
      chargedUnits,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? null,
      createdAt: now,
    });
    return updated.used;
  });

  return {
    allowed: true,
    used: usedAfter,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - usedAfter),
    chargedUnits,
    periodEnd: period.end,
    duplicate: false,
  };
}

/** Console override: set a counter back to zero for the current period. */
export async function resetUsageCounter(input: {
  applicationId: string;
  appUserId: string;
  usageItemId: string;
  actor: Actor;
}) {
  const item = await requireUsageItem(input.applicationId, input.usageItemId);
  const counter = await latestCounter(input.appUserId, item.id);
  if (!counter) return null;

  const [updated] = await db
    .update(usageCounters)
    .set({ used: 0, updatedAt: new Date() })
    .where(eq(usageCounters.id, counter.id))
    .returning();

  // Wiping a counter loses the only record that it ever ran up, so the audit
  // row is where the previous figure survives.
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "usage.reset",
    entityType: "usage_counter",
    entityId: updated.id,
    before: { usageItemId: item.id, used: counter.used },
    after: { usageItemId: item.id, used: 0 },
  });
  return updated;
}
