import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  subscriptions,
  topupEligibilityRules,
  topupProducts,
  type TopupRuleType,
} from "@/lib/db/schema";
import {
  assertCurrency,
  assertKey,
  assertPositiveInteger,
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";
import { requireBalanceUnit } from "./units";
import { requirePlan } from "./plans";
import { requireRole } from "./roles";
import { getUserRoleIds } from "./entitlements";

export type TopupEligibility =
  | { type: "standalone" }
  | { type: "plan"; planId: string }
  | { type: "role"; roleId: string };

export async function listTopupProducts(
  applicationId: string,
  options: { includeArchived?: boolean } = {},
) {
  const rows = await db
    .select()
    .from(topupProducts)
    .where(eq(topupProducts.applicationId, applicationId))
    .orderBy(asc(topupProducts.sortOrder), asc(topupProducts.key));
  return options.includeArchived
    ? rows
    : rows.filter((product) => product.status !== "archived");
}

export async function requireTopupProduct(applicationId: string, topupId: string) {
  const [product] = await db
    .select()
    .from(topupProducts)
    .where(
      and(
        eq(topupProducts.id, topupId),
        eq(topupProducts.applicationId, applicationId),
      ),
    )
    .limit(1);
  if (!product) throw new NotFoundError("topup product", topupId);
  return product;
}

export async function createTopupProduct(input: {
  applicationId: string;
  key: string;
  name: string;
  description?: string | null;
  unitId: string;
  amount: number;
  priceAmountCents: number;
  currency?: string;
  maxPurchasesPerUser?: number | null;
  sortOrder?: number;
  eligibility?: TopupEligibility;
  actor: Actor;
}) {
  const key = assertKey(input.key);
  if (!input.name.trim()) throw new ValidationError("name is required");
  await requireBalanceUnit(input.applicationId, input.unitId);
  const amount = assertPositiveInteger(input.amount, "amount");
  const priceAmountCents = assertPositiveInteger(
    input.priceAmountCents,
    "priceAmountCents",
  );
  const currency = assertCurrency(input.currency ?? "usd");
  if (input.maxPurchasesPerUser !== null && input.maxPurchasesPerUser !== undefined) {
    assertPositiveInteger(input.maxPurchasesPerUser, "maxPurchasesPerUser");
  }

  const [duplicate] = await db
    .select({ id: topupProducts.id })
    .from(topupProducts)
    .where(
      and(
        eq(topupProducts.applicationId, input.applicationId),
        eq(topupProducts.key, key),
      ),
    )
    .limit(1);
  if (duplicate) throw new ValidationError(`a topup with key "${key}" already exists`);

  const eligibility = input.eligibility ?? { type: "standalone" };
  if (eligibility.type === "plan") {
    await requirePlan(input.applicationId, eligibility.planId);
  } else if (eligibility.type === "role") {
    await requireRole(input.applicationId, eligibility.roleId);
  }

  const now = new Date();
  const { product, eligibilityRule } = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(topupProducts)
      .values({
        id: newId(),
        applicationId: input.applicationId,
        key,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        unitId: input.unitId,
        amount,
        priceAmountCents,
        currency,
        status: "draft",
        maxPurchasesPerUser: input.maxPurchasesPerUser ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (eligibility.type === "standalone") {
      return { product, eligibilityRule: null };
    }

    const [eligibilityRule] = await tx
      .insert(topupEligibilityRules)
      .values({
        id: newId(),
        topupProductId: product.id,
        ruleType:
          eligibility.type === "plan" ? "requires_active_plan" : "requires_role",
        planId: eligibility.type === "plan" ? eligibility.planId : null,
        roleId: eligibility.type === "role" ? eligibility.roleId : null,
        createdAt: now,
      })
      .returning();
    return { product, eligibilityRule };
  });

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "topup.create",
    entityType: "topup_product",
    entityId: product.id,
    after: product,
  });
  if (eligibilityRule) {
    await recordAudit({
      applicationId: input.applicationId,
      actor: input.actor,
      action: "topup.add_rule",
      entityType: "topup_eligibility_rule",
      entityId: eligibilityRule.id,
      after: eligibilityRule,
    });
  }
  return { ...product, eligibilityRule };
}

export async function updateTopupProduct(input: {
  applicationId: string;
  topupId: string;
  name?: string;
  description?: string | null;
  amount?: number;
  priceAmountCents?: number;
  currency?: string;
  maxPurchasesPerUser?: number | null;
  status?: "draft" | "active" | "archived";
  sortOrder?: number;
  actor: Actor;
}) {
  const before = await requireTopupProduct(input.applicationId, input.topupId);

  const priceChanged =
    input.priceAmountCents !== undefined &&
    input.priceAmountCents !== before.priceAmountCents;
  const currencyChanged =
    input.currency !== undefined && assertCurrency(input.currency) !== before.currency;
  if (input.maxPurchasesPerUser !== null && input.maxPurchasesPerUser !== undefined) {
    assertPositiveInteger(input.maxPurchasesPerUser, "maxPurchasesPerUser");
  }

  const [product] = await db
    .update(topupProducts)
    .set({
      name: input.name?.trim() || before.name,
      description:
        input.description === undefined
          ? before.description
          : input.description?.trim() || null,
      amount:
        input.amount === undefined
          ? before.amount
          : assertPositiveInteger(input.amount, "amount"),
      priceAmountCents:
        input.priceAmountCents === undefined
          ? before.priceAmountCents
          : assertPositiveInteger(input.priceAmountCents, "priceAmountCents"),
      currency:
        input.currency === undefined ? before.currency : assertCurrency(input.currency),
      maxPurchasesPerUser:
        input.maxPurchasesPerUser === undefined
          ? before.maxPurchasesPerUser
          : input.maxPurchasesPerUser,
      status: input.status ?? before.status,
      sortOrder: input.sortOrder ?? before.sortOrder,
      // Both accounts' Prices are stale once the amount or currency moves.
      stripePriceId: priceChanged || currencyChanged ? null : before.stripePriceId,
      stripeSandboxPriceId:
        priceChanged || currencyChanged ? null : before.stripeSandboxPriceId,
      updatedAt: new Date(),
    })
    .where(eq(topupProducts.id, input.topupId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "topup.update",
    entityType: "topup_product",
    entityId: product.id,
    before,
    after: product,
  });
  return product;
}

export async function deleteTopupProduct(input: {
  applicationId: string;
  topupId: string;
  actor: Actor;
}) {
  const before = await requireTopupProduct(input.applicationId, input.topupId);
  await db.delete(topupProducts).where(eq(topupProducts.id, input.topupId));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "topup.delete",
    entityType: "topup_product",
    entityId: input.topupId,
    before,
  });
}

export async function listEligibilityRules(topupId: string) {
  return db
    .select()
    .from(topupEligibilityRules)
    .where(eq(topupEligibilityRules.topupProductId, topupId));
}

export async function addEligibilityRule(input: {
  applicationId: string;
  topupId: string;
  ruleType: TopupRuleType;
  planId?: string | null;
  roleId?: string | null;
  actor: Actor;
}) {
  await requireTopupProduct(input.applicationId, input.topupId);

  if (input.ruleType === "requires_active_plan") {
    if (!input.planId) {
      throw new ValidationError("requires_active_plan needs a planId");
    }
    await requirePlan(input.applicationId, input.planId);
  }
  if (input.ruleType === "requires_role") {
    if (!input.roleId) throw new ValidationError("requires_role needs a roleId");
    await requireRole(input.applicationId, input.roleId);
  }

  const [rule] = await db
    .insert(topupEligibilityRules)
    .values({
      id: newId(),
      topupProductId: input.topupId,
      ruleType: input.ruleType,
      planId: input.ruleType === "requires_active_plan" ? input.planId! : null,
      roleId: input.ruleType === "requires_role" ? input.roleId! : null,
      createdAt: new Date(),
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "topup.add_rule",
    entityType: "topup_eligibility_rule",
    entityId: rule.id,
    after: rule,
  });
  return rule;
}

export async function removeEligibilityRule(input: {
  applicationId: string;
  topupId: string;
  ruleId: string;
  actor: Actor;
}) {
  await requireTopupProduct(input.applicationId, input.topupId);
  const [before] = await db
    .select()
    .from(topupEligibilityRules)
    .where(
      and(
        eq(topupEligibilityRules.id, input.ruleId),
        eq(topupEligibilityRules.topupProductId, input.topupId),
      ),
    )
    .limit(1);
  if (!before) throw new NotFoundError("eligibility rule", input.ruleId);

  await db
    .delete(topupEligibilityRules)
    .where(eq(topupEligibilityRules.id, input.ruleId));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "topup.remove_rule",
    entityType: "topup_eligibility_rule",
    entityId: input.ruleId,
    before,
  });
}

export interface EligibilityResult {
  eligible: boolean;
  /** Rules the user failed, for a message the app can show verbatim. */
  failed: { ruleType: TopupRuleType; planId: string | null; roleId: string | null }[];
}

const ACTIVE_STATUSES = ["trialing", "active", "past_due"] as const;

/**
 * Evaluate a topup's gates for one user. Rules are ANDed.
 *
 * Called both when checkout starts and again at fulfillment, so a plan that
 * lapses mid-checkout cannot be used to buy a plan-gated pack.
 */
export async function checkTopupEligibility(input: {
  applicationId: string;
  topupId: string;
  appUserId: string;
}): Promise<EligibilityResult> {
  const rules = await listEligibilityRules(input.topupId);
  if (rules.length === 0) return { eligible: true, failed: [] };

  const activeSubscriptions = await db
    .select({ planId: subscriptions.planId, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.appUserId, input.appUserId));
  const active = activeSubscriptions.filter((subscription) =>
    (ACTIVE_STATUSES as readonly string[]).includes(subscription.status),
  );
  const activePlanIds = new Set(active.map((subscription) => subscription.planId));

  const failed: EligibilityResult["failed"] = [];
  let roleIds: Set<string> | null = null;

  for (const rule of rules) {
    if (rule.ruleType === "requires_any_plan") {
      if (active.length === 0) {
        failed.push({ ruleType: rule.ruleType, planId: null, roleId: null });
      }
      continue;
    }
    if (rule.ruleType === "requires_active_plan") {
      if (!rule.planId || !activePlanIds.has(rule.planId)) {
        failed.push({ ruleType: rule.ruleType, planId: rule.planId, roleId: null });
      }
      continue;
    }
    // requires_role
    roleIds ??= new Set(
      await getUserRoleIds({
        applicationId: input.applicationId,
        appUserId: input.appUserId,
      }),
    );
    if (!rule.roleId || !roleIds.has(rule.roleId)) {
      failed.push({ ruleType: rule.ruleType, planId: null, roleId: rule.roleId });
    }
  }

  return { eligible: failed.length === 0, failed };
}
