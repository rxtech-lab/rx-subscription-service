import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUserRoles,
  appUserUsageLimits,
  planEntitlements,
  plans,
  subscriptionRoles,
  subscriptions,
  type PlanEntitlement,
} from "@/lib/db/schema";
import {
  buildPermissionExpression,
  parsePermissionList,
  serializePermissionList,
} from "@/lib/permissions/expression";
import { getRolePermissions, listRoles } from "./roles";

const ACTIVE_STATUSES = ["trialing", "active", "past_due"] as const;

export interface ResolvedEntitlements {
  plans: {
    subscriptionId: string;
    planId: string;
    planKey: string;
    planName: string;
    status: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }[];
  roleKeys: string[];
  roleIds: string[];
  /** Serialized `read:a:all` / `read:a:id1,id2` expressions. */
  permissions: string[];
  features: Record<string, string | null>;
  /**
   * Per-period allowance by usage item id, merged across active plans and then
   * overridden by any per-user limit.
   */
  usageLimits: Record<string, number | null>;
  /** Role ids held directly, rather than through a plan or a default role. */
  directRoleIds: string[];
  /** The per-user overrides that were applied on top of the plan allowances. */
  usageLimitOverrides: Record<string, number | null>;
  balanceGrants: { unitId: string; amount: number }[];
}

/** Roles a user holds directly, filtered to this application's own roles. */
async function directRoleIdsFor(input: {
  applicationId: string;
  appUserId: string;
}): Promise<string[]> {
  const rows = await db
    .select({ roleId: appUserRoles.roleId })
    .from(appUserRoles)
    .innerJoin(subscriptionRoles, eq(appUserRoles.roleId, subscriptionRoles.id))
    .where(
      and(
        eq(appUserRoles.appUserId, input.appUserId),
        eq(subscriptionRoles.applicationId, input.applicationId),
      ),
    );
  return rows.map((row) => row.roleId);
}

/** Per-user usage allowances, keyed by usage item id. */
export async function getUsageLimitOverrides(
  appUserId: string,
): Promise<Record<string, number | null>> {
  const rows = await db
    .select({
      usageItemId: appUserUsageLimits.usageItemId,
      limitValue: appUserUsageLimits.limitValue,
    })
    .from(appUserUsageLimits)
    .where(eq(appUserUsageLimits.appUserId, appUserId));

  const overrides: Record<string, number | null> = {};
  for (const row of rows) overrides[row.usageItemId] = row.limitValue;
  return overrides;
}

/**
 * The entitlement rows that apply to a subscription.
 *
 * A subscription carries a snapshot of what its plan granted at purchase, so
 * editing a plan does not retroactively change what existing subscribers have.
 * Subscriptions created before a snapshot existed fall back to the live plan.
 */
function snapshotEntitlements(
  snapshot: Record<string, unknown> | null,
): PlanEntitlement[] | null {
  if (!snapshot) return null;
  const entitlements = snapshot.entitlements;
  return Array.isArray(entitlements) ? (entitlements as PlanEntitlement[]) : null;
}

export async function resolveEntitlements(input: {
  applicationId: string;
  appUserId: string;
}): Promise<ResolvedEntitlements> {
  const rows = await db
    .select({
      subscriptionId: subscriptions.id,
      planId: subscriptions.planId,
      status: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      entitlementSnapshot: subscriptions.entitlementSnapshot,
      planKey: plans.key,
      planName: plans.name,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(
      and(
        eq(subscriptions.applicationId, input.applicationId),
        eq(subscriptions.appUserId, input.appUserId),
        inArray(subscriptions.status, [...ACTIVE_STATUSES]),
      ),
    );

  const [allRoles, directRoleIds, usageLimitOverrides] = await Promise.all([
    listRoles(input.applicationId),
    directRoleIdsFor(input),
    getUsageLimitOverrides(input.appUserId),
  ]);

  const empty: ResolvedEntitlements = {
    plans: [],
    roleKeys: [],
    roleIds: [],
    directRoleIds,
    permissions: [],
    features: {},
    usageLimits: { ...usageLimitOverrides },
    usageLimitOverrides,
    balanceGrants: [],
  };

  // Default roles apply to everyone, subscriber or not; directly granted roles
  // apply the same way, without a plan behind them.
  const roleIds = new Set([
    ...allRoles.filter((role) => role.isDefault).map((role) => role.id),
    ...directRoleIds,
  ]);

  if (rows.length === 0 && roleIds.size === 0) return empty;

  const liveByPlan = new Map<string, PlanEntitlement[]>();
  const planIdsNeedingLive = rows
    .filter((row) => snapshotEntitlements(row.entitlementSnapshot) === null)
    .map((row) => row.planId);

  if (planIdsNeedingLive.length > 0) {
    const live = await db
      .select()
      .from(planEntitlements)
      .where(inArray(planEntitlements.planId, planIdsNeedingLive));
    for (const entitlement of live) {
      const bucket = liveByPlan.get(entitlement.planId) ?? [];
      bucket.push(entitlement);
      liveByPlan.set(entitlement.planId, bucket);
    }
  }

  const permissionExpressions: string[] = [];
  const features: Record<string, string | null> = {};
  const usageLimits: Record<string, number | null> = {};
  const balanceGrants: { unitId: string; amount: number }[] = [];

  for (const row of rows) {
    const entitlements =
      snapshotEntitlements(row.entitlementSnapshot) ??
      liveByPlan.get(row.planId) ??
      [];

    for (const entitlement of entitlements) {
      switch (entitlement.kind) {
        case "role":
          if (entitlement.roleId) roleIds.add(entitlement.roleId);
          break;
        case "permission": {
          if (!entitlement.permissionKey) break;
          const expression = buildPermissionExpression({
            key: entitlement.permissionKey,
            scope: entitlement.permissionScope ?? "all",
            targetIds: entitlement.permissionTargetIds ?? [],
          });
          if (expression) permissionExpressions.push(expression);
          break;
        }
        case "usage_limit": {
          if (!entitlement.usageItemId) break;
          const current = usageLimits[entitlement.usageItemId];
          // Null means unlimited, which always wins over any finite allowance.
          if (entitlement.limitValue === null || current === null) {
            usageLimits[entitlement.usageItemId] = null;
          } else {
            usageLimits[entitlement.usageItemId] = Math.max(
              current ?? 0,
              entitlement.limitValue ?? 0,
            );
          }
          break;
        }
        case "balance_grant":
          if (entitlement.unitId && entitlement.amount) {
            balanceGrants.push({
              unitId: entitlement.unitId,
              amount: entitlement.amount,
            });
          }
          break;
        case "feature":
          if (entitlement.featureKey) {
            features[entitlement.featureKey] = entitlement.featureValue ?? null;
          }
          break;
      }
    }
  }

  // A per-user override replaces whatever the plans worked out to, in either
  // direction — it is set deliberately, so it is not a "best allowance wins"
  // merge like the plan values above.
  Object.assign(usageLimits, usageLimitOverrides);

  // Roles contribute their own permission grants on top of any direct ones.
  const roleIdList = Array.from(roleIds);
  const rolesById = new Map(allRoles.map((role) => [role.id, role]));
  for (const roleId of roleIdList) {
    const { expressions } = await getRolePermissions(input.applicationId, roleId);
    permissionExpressions.push(...expressions);
  }

  return {
    plans: rows.map((row) => ({
      subscriptionId: row.subscriptionId,
      planId: row.planId,
      planKey: row.planKey,
      planName: row.planName,
      status: row.status,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    })),
    roleIds: roleIdList,
    directRoleIds,
    usageLimitOverrides,
    roleKeys: roleIdList
      .map((roleId) => rolesById.get(roleId)?.key)
      .filter((key): key is string => Boolean(key))
      .sort(),
    permissions: serializePermissionList(parsePermissionList(permissionExpressions)),
    features,
    usageLimits,
    balanceGrants,
  };
}

/** Role ids only — the cheap path used by topup eligibility checks. */
export async function getUserRoleIds(input: {
  applicationId: string;
  appUserId: string;
}): Promise<string[]> {
  const entitlements = await resolveEntitlements(input);
  return entitlements.roleIds;
}

/** The current billing window, used by `billing_period` usage resets. */
export async function getBillingWindow(input: {
  applicationId: string;
  appUserId: string;
}): Promise<{ start: Date | null; end: Date | null }> {
  const [row] = await db
    .select({
      start: subscriptions.currentPeriodStart,
      end: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.applicationId, input.applicationId),
        eq(subscriptions.appUserId, input.appUserId),
        inArray(subscriptions.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(1);
  return { start: row?.start ?? null, end: row?.end ?? null };
}
