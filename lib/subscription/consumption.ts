import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  LEDGER_KINDS,
  ledgerEntries,
  usageItems,
  usageRecords,
} from "@/lib/db/schema";
import {
  assertWithinRowLimit,
  addConsumptionDelta,
  bucketKeys,
  foldIntoBuckets,
  MAX_ROWS,
  type Granularity,
} from "./series";

/**
 * Grouped time series over the two append-only trails: `ledger_entries` for
 * balance movement and `usage_records` for metered events.
 *
 * Both are built here rather than in the API route, because the console renders
 * the same numbers from a server component and must not fetch its own HTTP
 * endpoint to get them. One function, two callers.
 *
 * Series come from the immutable trails, never from `balances` or
 * `usage_counters`: a counter resets every period, so it can describe *now* but
 * cannot describe a range. The records can do both.
 */

/** Beyond this many distinct descriptions the tail is folded into "Other". */
const TOP_DESCRIPTIONS = 7;

export interface ConsumptionBucket {
  /** ISO 8601 start of the bucket, UTC. */
  start: string;
  /** Units spent, as a positive number — charts want a magnitude. */
  spent: number;
  /** Units granted: plan allowances, topups, refunds, adjustments up. */
  granted: number;
  /** `granted - spent`, the balance movement across the bucket. */
  net: number;
  entryCount: number;
}

export interface ConsumptionGroup {
  key: string;
  label: string;
  spent: number;
  granted: number;
  net: number;
  entryCount: number;
  buckets: ConsumptionBucket[];
}

export interface ConsumptionSeries {
  from: string;
  to: string;
  granularity: Granularity;
  totals: ConsumptionBucket[];
  /** Null unless `groupBy` was asked for. */
  groups: ConsumptionGroup[] | null;
}

export interface UsageBucket {
  start: string;
  /** Signed sum, in case a correction ever writes a negative record. */
  amount: number;
  /** The positive portion of `amount` — what was actually consumed. */
  consumed: number;
  eventCount: number;
  /** Balance units charged by a `charge_balance` overage on these events. */
  chargedUnits: number;
}

export interface UsageGroup {
  key: string;
  label: string;
  amount: number;
  consumed: number;
  eventCount: number;
  chargedUnits: number;
  buckets: UsageBucket[];
}

export interface UsageSeries {
  from: string;
  to: string;
  granularity: Granularity;
  totals: UsageBucket[];
  groups: UsageGroup[] | null;
}

function emptyConsumption(start: string): ConsumptionBucket {
  return { start, spent: 0, granted: 0, net: 0, entryCount: 0 };
}

function emptyUsage(start: string): UsageBucket {
  return { start, amount: 0, consumed: 0, eventCount: 0, chargedUnits: 0 };
}

/**
 * Rank groups by size, keep the largest and fold the tail into "Other".
 *
 * Deliberately not `topWithOther`: that helper reduces to `{label, value}` and
 * so cannot carry each group's buckets through, and it identifies the overflow
 * slice by the literal label "Other" — which would collide with a real model
 * actually called that. Here the synthetic row is keyed `other` and the tail is
 * summed column by column, which is the part a label-only helper cannot do.
 */
function rollupGroups<Bucket>(
  groups: Map<string, { label: string; buckets: Bucket[] }>,
  weight: (buckets: Bucket[]) => number,
  limit: number,
  keys: string[],
  seed: (start: string) => Bucket,
  merge: (into: Bucket, from: Bucket) => Bucket,
): { key: string; label: string; buckets: Bucket[] }[] {
  const ranked = [...groups]
    .map(([key, group]) => ({ key, label: group.label, buckets: group.buckets }))
    .sort((a, b) => weight(b.buckets) - weight(a.buckets));

  if (ranked.length <= limit) return ranked;

  const merged = keys.map(seed);
  for (const group of ranked.slice(limit)) {
    group.buckets.forEach((bucket, index) => {
      merged[index] = merge(merged[index], bucket);
    });
  }
  return [...ranked.slice(0, limit), { key: "other", label: "Other", buckets: merged }];
}

export interface ConsumptionQuery {
  applicationId: string;
  /** Omit for the whole application. */
  appUserId?: string | null;
  /** Omit for every unit. */
  unitId?: string | null;
  from: Date;
  to: Date;
  granularity: Granularity;
  /** `description` carries the model name on usage debits. */
  groupBy?: "kind" | "description" | null;
  /** Sandbox and production users are never mixed into one series. */
  isTest: boolean;
}

export async function getConsumptionSeries(
  input: ConsumptionQuery,
): Promise<ConsumptionSeries> {
  const keys = bucketKeys(input.from, input.to, input.granularity);

  const rows = await db
    .select({
      createdAt: ledgerEntries.createdAt,
      delta: ledgerEntries.delta,
      kind: ledgerEntries.kind,
      description: ledgerEntries.description,
    })
    .from(ledgerEntries)
    .innerJoin(appUsers, eq(ledgerEntries.appUserId, appUsers.id))
    .where(
      and(
        eq(appUsers.applicationId, input.applicationId),
        eq(appUsers.isTest, input.isTest),
        input.appUserId ? eq(ledgerEntries.appUserId, input.appUserId) : undefined,
        input.unitId ? eq(ledgerEntries.unitId, input.unitId) : undefined,
        gte(ledgerEntries.createdAt, input.from),
        lte(ledgerEntries.createdAt, input.to),
      ),
    )
    .limit(MAX_ROWS + 1);
  assertWithinRowLimit(rows.length);

  const fold = (bucket: ConsumptionBucket, row: (typeof rows)[number]) =>
    addConsumptionDelta(bucket, row.delta);

  const totals = foldIntoBuckets(
    keys,
    rows,
    input.granularity,
    (row) => row.createdAt,
    emptyConsumption,
    fold,
  );

  if (!input.groupBy) {
    return {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      granularity: input.granularity,
      totals,
      groups: null,
    };
  }

  const dimension = input.groupBy;
  const partitions = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = dimension === "kind" ? row.kind : row.description;
    const bucketRows = partitions.get(key);
    if (bucketRows) bucketRows.push(row);
    else partitions.set(key, [row]);
  }

  const groupKeys =
    dimension === "kind" ? [...LEDGER_KINDS] : [...partitions.keys()];
  const built = new Map(
    groupKeys.map((key) => [
      key,
      {
        label: key,
        buckets: foldIntoBuckets(
          keys,
          partitions.get(key) ?? [],
          input.granularity,
          (row) => row.createdAt,
          emptyConsumption,
          fold,
        ),
      },
    ]),
  );

  // `kind` is a bounded enum, so every value stays; free-text descriptions are
  // unbounded and would otherwise turn into an unreadable legend.
  const rolled =
    dimension === "kind"
      ? [...built].map(([key, group]) => ({
          key,
          label: group.label,
          buckets: group.buckets,
        }))
      : rollupGroups(
          built,
          (buckets) => buckets.reduce((total, bucket) => total + bucket.spent, 0),
          TOP_DESCRIPTIONS,
          keys,
          emptyConsumption,
          (into, from) => ({
            start: into.start,
            spent: into.spent + from.spent,
            granted: into.granted + from.granted,
            net: into.net + from.net,
            entryCount: into.entryCount + from.entryCount,
          }),
        );

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    granularity: input.granularity,
    totals,
    groups: rolled.map((group) => ({
      key: group.key,
      label: group.label,
      spent: group.buckets.reduce((total, bucket) => total + bucket.spent, 0),
      granted: group.buckets.reduce((total, bucket) => total + bucket.granted, 0),
      net: group.buckets.reduce((total, bucket) => total + bucket.net, 0),
      entryCount: group.buckets.reduce((total, b) => total + b.entryCount, 0),
      buckets: group.buckets,
    })),
  };
}

export interface UsageQuery {
  applicationId: string;
  appUserId?: string | null;
  usageItemId?: string | null;
  from: Date;
  to: Date;
  granularity: Granularity;
  groupBy?: "item" | null;
  isTest: boolean;
}

export async function getUsageSeries(input: UsageQuery): Promise<UsageSeries> {
  const keys = bucketKeys(input.from, input.to, input.granularity);

  const [rows, itemDefinitions] = await Promise.all([
    db
      .select({
        createdAt: usageRecords.createdAt,
        amount: usageRecords.amount,
        chargedUnits: usageRecords.chargedUnits,
        itemKey: usageItems.key,
        itemName: usageItems.name,
      })
      .from(usageRecords)
      .innerJoin(appUsers, eq(usageRecords.appUserId, appUsers.id))
      .innerJoin(usageItems, eq(usageRecords.usageItemId, usageItems.id))
      .where(
        and(
          eq(appUsers.applicationId, input.applicationId),
          eq(appUsers.isTest, input.isTest),
          input.appUserId ? eq(usageRecords.appUserId, input.appUserId) : undefined,
          input.usageItemId
            ? eq(usageRecords.usageItemId, input.usageItemId)
            : undefined,
          gte(usageRecords.createdAt, input.from),
          lte(usageRecords.createdAt, input.to),
        ),
      )
      .limit(MAX_ROWS + 1),
    input.groupBy === "item"
      ? db
          .select({ key: usageItems.key, name: usageItems.name })
          .from(usageItems)
          .where(
            and(
              eq(usageItems.applicationId, input.applicationId),
              input.usageItemId
                ? eq(usageItems.id, input.usageItemId)
                : undefined,
            ),
          )
          .orderBy(asc(usageItems.sortOrder), asc(usageItems.key))
      : Promise.resolve([]),
  ]);
  assertWithinRowLimit(rows.length);

  const fold = (bucket: UsageBucket, row: (typeof rows)[number]) => ({
    start: bucket.start,
    amount: bucket.amount + row.amount,
    consumed: bucket.consumed + Math.max(row.amount, 0),
    eventCount: bucket.eventCount + 1,
    chargedUnits: bucket.chargedUnits + row.chargedUnits,
  });

  const totals = foldIntoBuckets(
    keys,
    rows,
    input.granularity,
    (row) => row.createdAt,
    emptyUsage,
    fold,
  );

  if (input.groupBy !== "item") {
    return {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      granularity: input.granularity,
      totals,
      groups: null,
    };
  }

  const partitions = new Map<string, { name: string; rows: typeof rows }>(
    itemDefinitions.map((item) => [item.key, { name: item.name, rows: [] }]),
  );
  for (const row of rows) {
    const partition = partitions.get(row.itemKey);
    if (partition) partition.rows.push(row);
    else partitions.set(row.itemKey, { name: row.itemName, rows: [row] });
  }

  // Items are a bounded set defined in the console, so every one is returned —
  // no top-N rollup, unlike free-text ledger descriptions.
  const groups = [...partitions].map(([key, partition]) => {
    const buckets = foldIntoBuckets(
      keys,
      partition.rows,
      input.granularity,
      (row) => row.createdAt,
      emptyUsage,
      fold,
    );
    return {
      key,
      label: partition.name,
      amount: buckets.reduce((total, bucket) => total + bucket.amount, 0),
      consumed: buckets.reduce((total, bucket) => total + bucket.consumed, 0),
      eventCount: buckets.reduce((total, bucket) => total + bucket.eventCount, 0),
      chargedUnits: buckets.reduce((total, b) => total + b.chargedUnits, 0),
      buckets,
    };
  });

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    granularity: input.granularity,
    totals,
    groups,
  };
}
