import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageItems, type ResetPolicy, type ResetUnit } from "@/lib/db/schema";
import {
  assertKey,
  assertNonNegativeInteger,
  assertPositiveInteger,
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";

export async function listUsageItems(applicationId: string) {
  return db
    .select()
    .from(usageItems)
    .where(eq(usageItems.applicationId, applicationId))
    .orderBy(asc(usageItems.sortOrder), asc(usageItems.key));
}

export async function requireUsageItem(applicationId: string, usageItemId: string) {
  const [item] = await db
    .select()
    .from(usageItems)
    .where(
      and(eq(usageItems.id, usageItemId), eq(usageItems.applicationId, applicationId)),
    )
    .limit(1);
  if (!item) throw new NotFoundError("usage item", usageItemId);
  return item;
}

export async function getUsageItemByKey(applicationId: string, key: string) {
  const [item] = await db
    .select()
    .from(usageItems)
    .where(
      and(
        eq(usageItems.applicationId, applicationId),
        eq(usageItems.key, key.trim().toLowerCase()),
      ),
    )
    .limit(1);
  return item ?? null;
}

/**
 * A reset policy either needs an interval or forbids one: `never` and
 * `billing_period` take their boundaries from elsewhere, while the windowed
 * policies are meaningless without a count and a unit.
 */
function assertResetShape(
  resetPolicy: ResetPolicy,
  resetIntervalCount: number | null | undefined,
  resetIntervalUnit: ResetUnit | null | undefined,
): { count: number | null; unit: ResetUnit | null } {
  const windowed =
    resetPolicy === "rolling_window" || resetPolicy === "calendar_period";
  if (!windowed) return { count: null, unit: null };

  if (!resetIntervalUnit) {
    throw new ValidationError(`${resetPolicy} requires resetIntervalUnit`);
  }
  return {
    count: assertPositiveInteger(resetIntervalCount ?? 1, "resetIntervalCount"),
    unit: resetIntervalUnit,
  };
}

export async function createUsageItem(input: {
  applicationId: string;
  key: string;
  name: string;
  description?: string | null;
  valueType?: "counter" | "gauge";
  resetPolicy?: ResetPolicy;
  resetIntervalCount?: number | null;
  resetIntervalUnit?: ResetUnit | null;
  defaultLimit?: number | null;
  overagePolicy?: "block" | "allow" | "charge_balance";
  overageUnitId?: string | null;
  overageCostPerUnit?: number | null;
  sortOrder?: number;
  actor: Actor;
}) {
  const key = assertKey(input.key);
  if (!input.name.trim()) throw new ValidationError("name is required");

  const resetPolicy = input.resetPolicy ?? "never";
  const reset = assertResetShape(
    resetPolicy,
    input.resetIntervalCount,
    input.resetIntervalUnit,
  );

  const overagePolicy = input.overagePolicy ?? "block";
  if (overagePolicy === "charge_balance") {
    if (!input.overageUnitId) {
      throw new ValidationError("charge_balance overage requires overageUnitId");
    }
    assertPositiveInteger(input.overageCostPerUnit ?? 0, "overageCostPerUnit");
  }
  if (input.defaultLimit !== null && input.defaultLimit !== undefined) {
    assertNonNegativeInteger(input.defaultLimit, "defaultLimit");
  }

  if (await getUsageItemByKey(input.applicationId, key)) {
    throw new ValidationError(`a usage item with key "${key}" already exists`);
  }

  const now = new Date();
  const [item] = await db
    .insert(usageItems)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      valueType: input.valueType ?? "counter",
      resetPolicy,
      resetIntervalCount: reset.count,
      resetIntervalUnit: reset.unit,
      defaultLimit: input.defaultLimit ?? null,
      overagePolicy,
      overageUnitId: input.overageUnitId ?? null,
      overageCostPerUnit: input.overageCostPerUnit ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "usage_item.create",
    entityType: "usage_item",
    entityId: item.id,
    after: item,
  });
  return item;
}

export async function updateUsageItem(input: {
  applicationId: string;
  usageItemId: string;
  name?: string;
  description?: string | null;
  resetPolicy?: ResetPolicy;
  resetIntervalCount?: number | null;
  resetIntervalUnit?: ResetUnit | null;
  defaultLimit?: number | null;
  overagePolicy?: "block" | "allow" | "charge_balance";
  overageUnitId?: string | null;
  overageCostPerUnit?: number | null;
  sortOrder?: number;
  actor: Actor;
}) {
  const before = await requireUsageItem(input.applicationId, input.usageItemId);

  const resetPolicy = input.resetPolicy ?? before.resetPolicy;
  const reset = assertResetShape(
    resetPolicy,
    input.resetIntervalCount === undefined
      ? before.resetIntervalCount
      : input.resetIntervalCount,
    input.resetIntervalUnit === undefined
      ? before.resetIntervalUnit
      : input.resetIntervalUnit,
  );

  const overagePolicy = input.overagePolicy ?? before.overagePolicy;
  const overageUnitId =
    input.overageUnitId === undefined ? before.overageUnitId : input.overageUnitId;
  const overageCostPerUnit =
    input.overageCostPerUnit === undefined
      ? before.overageCostPerUnit
      : input.overageCostPerUnit;
  if (overagePolicy === "charge_balance") {
    if (!overageUnitId) {
      throw new ValidationError("charge_balance overage requires overageUnitId");
    }
    assertPositiveInteger(overageCostPerUnit ?? 0, "overageCostPerUnit");
  }
  if (input.defaultLimit !== null && input.defaultLimit !== undefined) {
    assertNonNegativeInteger(input.defaultLimit, "defaultLimit");
  }

  const [item] = await db
    .update(usageItems)
    .set({
      name: input.name?.trim() || before.name,
      description:
        input.description === undefined
          ? before.description
          : input.description?.trim() || null,
      resetPolicy,
      resetIntervalCount: reset.count,
      resetIntervalUnit: reset.unit,
      defaultLimit:
        input.defaultLimit === undefined ? before.defaultLimit : input.defaultLimit,
      overagePolicy,
      overageUnitId,
      overageCostPerUnit,
      sortOrder: input.sortOrder ?? before.sortOrder,
      updatedAt: new Date(),
    })
    .where(eq(usageItems.id, input.usageItemId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "usage_item.update",
    entityType: "usage_item",
    entityId: item.id,
    before,
    after: item,
  });
  return item;
}

export async function deleteUsageItem(input: {
  applicationId: string;
  usageItemId: string;
  actor: Actor;
}) {
  const before = await requireUsageItem(input.applicationId, input.usageItemId);
  await db.delete(usageItems).where(eq(usageItems.id, input.usageItemId));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "usage_item.delete",
    entityType: "usage_item",
    entityId: input.usageItemId,
    before,
  });
}
