import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  balanceUnits,
  planEntitlements,
  plans,
  subscriptionRoles,
  usageItems,
  type BillingInterval,
  type EntitlementKind,
} from "@/lib/db/schema";
import {
  assertCurrency,
  assertKey,
  assertNonNegativeInteger,
  assertPositiveInteger,
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";

export async function listPlans(
  applicationId: string,
  options: { includeArchived?: boolean } = {},
) {
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.applicationId, applicationId))
    .orderBy(asc(plans.sortOrder), asc(plans.key));
  return options.includeArchived
    ? rows
    : rows.filter((plan) => plan.status !== "archived");
}

export async function requirePlan(applicationId: string, planId: string) {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.applicationId, applicationId)))
    .limit(1);
  if (!plan) throw new NotFoundError("plan", planId);
  return plan;
}

/**
 * Stripe has no "quarter" interval — it is three monthly intervals. Keeping the
 * product-level enum separate from the Stripe representation means the console
 * and the API can talk about quarters without leaking billing-provider shape.
 */
export function stripeRecurring(
  interval: BillingInterval,
  intervalCount: number,
): { interval: "month" | "year"; interval_count: number } | null {
  switch (interval) {
    case "month":
      return { interval: "month", interval_count: intervalCount };
    case "quarter":
      return { interval: "month", interval_count: 3 * intervalCount };
    case "year":
      return { interval: "year", interval_count: intervalCount };
    case "one_time":
      return null;
  }
}

export async function createPlan(input: {
  applicationId: string;
  key: string;
  name: string;
  description?: string | null;
  billingInterval: BillingInterval;
  intervalCount?: number;
  priceAmountCents: number;
  currency?: string;
  trialDays?: number;
  sortOrder?: number;
  actor: Actor;
}) {
  const key = assertKey(input.key);
  if (!input.name.trim()) throw new ValidationError("name is required");
  const priceAmountCents = assertNonNegativeInteger(
    input.priceAmountCents,
    "priceAmountCents",
  );
  const intervalCount = assertPositiveInteger(
    input.intervalCount ?? 1,
    "intervalCount",
  );
  const trialDays = assertNonNegativeInteger(input.trialDays ?? 0, "trialDays");
  const currency = assertCurrency(input.currency ?? "usd");

  if (input.billingInterval === "one_time" && trialDays > 0) {
    throw new ValidationError("a one-time plan cannot have a trial");
  }

  const [duplicate] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.applicationId, input.applicationId), eq(plans.key, key)))
    .limit(1);
  if (duplicate) throw new ValidationError(`a plan with key "${key}" already exists`);

  const now = new Date();
  const [plan] = await db
    .insert(plans)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      billingInterval: input.billingInterval,
      intervalCount,
      priceAmountCents,
      currency,
      trialDays,
      status: "draft",
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "plan.create",
    entityType: "plan",
    entityId: plan.id,
    after: plan,
  });
  return plan;
}

export async function updatePlan(input: {
  applicationId: string;
  planId: string;
  name?: string;
  description?: string | null;
  priceAmountCents?: number;
  currency?: string;
  trialDays?: number;
  sortOrder?: number;
  actor: Actor;
}) {
  const before = await requirePlan(input.applicationId, input.planId);

  // A price change means a new Stripe Price; clear the stale pointer so the next
  // sync mints one. Existing subscriptions keep the Price they were created with.
  const priceChanged =
    input.priceAmountCents !== undefined &&
    input.priceAmountCents !== before.priceAmountCents;
  const currencyChanged =
    input.currency !== undefined &&
    assertCurrency(input.currency) !== before.currency;

  const [plan] = await db
    .update(plans)
    .set({
      name: input.name?.trim() || before.name,
      description:
        input.description === undefined
          ? before.description
          : input.description?.trim() || null,
      priceAmountCents:
        input.priceAmountCents === undefined
          ? before.priceAmountCents
          : assertNonNegativeInteger(input.priceAmountCents, "priceAmountCents"),
      currency:
        input.currency === undefined ? before.currency : assertCurrency(input.currency),
      trialDays:
        input.trialDays === undefined
          ? before.trialDays
          : assertNonNegativeInteger(input.trialDays, "trialDays"),
      sortOrder: input.sortOrder ?? before.sortOrder,
      // Both accounts' Prices are stale once the amount or currency moves.
      stripePriceId: priceChanged || currencyChanged ? null : before.stripePriceId,
      stripeSandboxPriceId:
        priceChanged || currencyChanged ? null : before.stripeSandboxPriceId,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, input.planId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "plan.update",
    entityType: "plan",
    entityId: plan.id,
    before,
    after: plan,
  });
  return plan;
}

export async function setPlanStatus(input: {
  applicationId: string;
  planId: string;
  status: "draft" | "active" | "archived";
  actor: Actor;
}) {
  const before = await requirePlan(input.applicationId, input.planId);
  const [plan] = await db
    .update(plans)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(plans.id, input.planId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: `plan.${input.status}`,
    entityType: "plan",
    entityId: plan.id,
    before,
    after: plan,
  });
  return plan;
}

export async function listPlanEntitlements(planId: string) {
  return db
    .select()
    .from(planEntitlements)
    .where(eq(planEntitlements.planId, planId))
    .orderBy(asc(planEntitlements.kind));
}

type EntitlementFields = {
  applicationId: string;
  kind: EntitlementKind;
  roleId?: string | null;
  permissionKey?: string | null;
  permissionScope?: "all" | "selected" | null;
  permissionTargetIds?: string[] | null;
  usageItemId?: string | null;
  limitValue?: number | null;
  trialLimitValue?: number | null;
  unitId?: string | null;
  amount?: number | null;
  featureKey?: string | null;
  featureValue?: string | null;
};

export async function addPlanEntitlement(
  input: EntitlementFields & { planId: string; actor: Actor },
) {
  await requirePlan(input.applicationId, input.planId);
  await assertEntitlementShape(input);

  const now = new Date();
  const [entitlement] = await db
    .insert(planEntitlements)
    .values({
      id: newId(),
      planId: input.planId,
      kind: input.kind,
      ...entitlementColumnsForKind(input),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "plan.add_entitlement",
    entityType: "plan_entitlement",
    entityId: entitlement.id,
    after: entitlement,
  });
  return entitlement;
}

/** An empty string is not a missing id: it would be sent to SQLite as a real
 * foreign key and fail the constraint. Callers that fill in every field — an AI
 * tool call, a single form with inputs for every kind — hit that easily. */
const blankToNull = (value?: string | null) => value?.trim() || null;

/**
 * Keep only the columns that belong to this kind. A role grant stores a role and
 * nothing else, so leftovers from other kinds never reach the row.
 */
function entitlementColumnsForKind(input: EntitlementFields) {
  const empty = {
    roleId: null,
    permissionKey: null,
    permissionScope: null,
    permissionTargetIds: null,
    usageItemId: null,
    limitValue: null,
    trialLimitValue: null,
    unitId: null,
    amount: null,
    featureKey: null,
    featureValue: null,
  } as const;

  switch (input.kind) {
    case "role":
      return { ...empty, roleId: blankToNull(input.roleId) };
    case "permission":
      return {
        ...empty,
        permissionKey: blankToNull(input.permissionKey),
        permissionScope: input.permissionScope ?? null,
        permissionTargetIds: input.permissionTargetIds?.length
          ? input.permissionTargetIds
          : null,
      };
    case "usage_limit":
      return {
        ...empty,
        usageItemId: blankToNull(input.usageItemId),
        limitValue: input.limitValue ?? null,
        // Existing callers only know about one allowance. Keep their trial
        // behavior unchanged unless they explicitly provide a trial value.
        trialLimitValue:
          input.trialLimitValue === undefined
            ? (input.limitValue ?? null)
            : input.trialLimitValue,
      };
    case "balance_grant":
      return {
        ...empty,
        unitId: blankToNull(input.unitId),
        amount: input.amount ?? null,
      };
    case "feature":
      return {
        ...empty,
        featureKey: blankToNull(input.featureKey),
        featureValue: blankToNull(input.featureValue),
      };
  }
}

async function assertEntitlementShape(input: EntitlementFields) {
  switch (input.kind) {
    case "role": {
      const roleId = blankToNull(input.roleId);
      if (!roleId) throw new ValidationError("roleId is required for a role grant");
      const [role] = await db
        .select({ id: subscriptionRoles.id })
        .from(subscriptionRoles)
        .where(
          and(
            eq(subscriptionRoles.id, roleId),
            eq(subscriptionRoles.applicationId, input.applicationId),
          ),
        )
        .limit(1);
      if (!role) throw new ValidationError("role does not belong to this application");
      return;
    }
    case "permission": {
      if (!blankToNull(input.permissionKey)) {
        throw new ValidationError("permissionKey is required for a permission grant");
      }
      if (input.permissionScope === "selected" && !input.permissionTargetIds?.length) {
        throw new ValidationError("a selected permission grant needs target ids");
      }
      return;
    }
    case "usage_limit": {
      const usageItemId = blankToNull(input.usageItemId);
      if (!usageItemId) {
        throw new ValidationError("usageItemId is required for a usage limit");
      }
      const [item] = await db
        .select({ id: usageItems.id })
        .from(usageItems)
        .where(
          and(
            eq(usageItems.id, usageItemId),
            eq(usageItems.applicationId, input.applicationId),
          ),
        )
        .limit(1);
      if (!item) {
        throw new ValidationError("usage item does not belong to this application");
      }
      if (input.limitValue !== null && input.limitValue !== undefined) {
        assertNonNegativeInteger(input.limitValue, "limitValue");
      }
      if (input.trialLimitValue !== null && input.trialLimitValue !== undefined) {
        assertNonNegativeInteger(input.trialLimitValue, "trialLimitValue");
      }
      return;
    }
    case "balance_grant": {
      const unitId = blankToNull(input.unitId);
      if (!unitId) {
        throw new ValidationError("unitId is required for a balance grant");
      }
      const [unit] = await db
        .select({ id: balanceUnits.id })
        .from(balanceUnits)
        .where(
          and(
            eq(balanceUnits.id, unitId),
            eq(balanceUnits.applicationId, input.applicationId),
          ),
        )
        .limit(1);
      if (!unit) {
        throw new ValidationError("balance unit does not belong to this application");
      }
      assertPositiveInteger(input.amount ?? 0, "amount");
      return;
    }
    case "feature": {
      if (!input.featureKey?.trim()) {
        throw new ValidationError("featureKey is required for a feature grant");
      }
      return;
    }
  }
}

export async function removePlanEntitlement(input: {
  applicationId: string;
  planId: string;
  entitlementId: string;
  actor: Actor;
}) {
  await requirePlan(input.applicationId, input.planId);
  const [before] = await db
    .select()
    .from(planEntitlements)
    .where(
      and(
        eq(planEntitlements.id, input.entitlementId),
        eq(planEntitlements.planId, input.planId),
      ),
    )
    .limit(1);
  if (!before) throw new NotFoundError("plan entitlement", input.entitlementId);

  await db.delete(planEntitlements).where(eq(planEntitlements.id, input.entitlementId));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "plan.remove_entitlement",
    entityType: "plan_entitlement",
    entityId: input.entitlementId,
    before,
  });
}
