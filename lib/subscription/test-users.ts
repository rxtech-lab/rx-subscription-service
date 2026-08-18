import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUserRoles,
  appUserUsageLimits,
  appUsers,
  balanceUnits,
  balances,
  plans,
  subscriptionRoles,
  subscriptions,
  usageItems,
  type AppUser,
} from "@/lib/db/schema";
import {
  assertNonNegativeInteger,
  assertPositiveInteger,
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";
import { resolveEntitlements } from "./entitlements";
import { requireRole } from "./roles";
import { clampClockOffset } from "./test-clock";
import { upsertSubscriptionFromStripe } from "./subscriptions";
import { requireUsageItem } from "./usage-items";
import { creditBalance, requireAppUser } from "./users";

/** How long a granted test subscription runs before it looks expired. */
const DEFAULT_PERIOD_DAYS = 30;

/**
 * Resolve a test user, refusing anything that is not one.
 *
 * Every mutation in this module — and every request from the storefront — goes
 * through here, so neither a hand-crafted form field, a stale cookie, nor an
 * approved-but-wrong AI tool call can reach a real subscriber's balances.
 */
export async function requireTestUser(
  applicationId: string,
  appUserId: string,
): Promise<AppUser> {
  const user = await requireAppUser(applicationId, appUserId);
  if (!user.isTest) throw new ValidationError("that user is not a test user");
  return user;
}

export async function createTestUser(input: {
  applicationId: string;
  displayName: string;
  email?: string | null;
  level?: number;
  levelKey?: string | null;
  note?: string | null;
  actor: Actor;
}) {
  const displayName = input.displayName.trim();
  if (!displayName) throw new ValidationError("displayName is required");
  if (displayName.length > 120) {
    throw new ValidationError("displayName must be at most 120 characters");
  }
  const level = input.level ?? 0;
  if (!Number.isSafeInteger(level)) throw new ValidationError("level must be an integer");

  const now = new Date();
  const [created] = await db
    .insert(appUsers)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      // Test users have no rxlab identity behind them. The synthesized id keeps
      // the (application, rxlabUserId) unique index satisfied and makes them
      // addressable through the public API for integration testing.
      rxlabUserId: `test:${newId()}`,
      email: input.email?.trim() || null,
      displayName,
      level,
      levelKey: input.levelKey?.trim() || null,
      isTest: true,
      testNote: input.note?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.create",
    entityType: "app_user",
    entityId: created.id,
    after: created,
  });
  return created;
}

export async function updateTestUser(input: {
  applicationId: string;
  appUserId: string;
  displayName?: string;
  email?: string | null;
  level?: number;
  levelKey?: string | null;
  note?: string | null;
  actor: Actor;
}) {
  const before = await requireTestUser(input.applicationId, input.appUserId);

  const displayName =
    input.displayName === undefined ? before.displayName : input.displayName.trim();
  if (input.displayName !== undefined && !displayName) {
    throw new ValidationError("displayName is required");
  }
  if (input.level !== undefined && !Number.isSafeInteger(input.level)) {
    throw new ValidationError("level must be an integer");
  }

  const [updated] = await db
    .update(appUsers)
    .set({
      displayName,
      email: input.email === undefined ? before.email : input.email?.trim() || null,
      level: input.level ?? before.level,
      levelKey:
        input.levelKey === undefined ? before.levelKey : input.levelKey?.trim() || null,
      testNote: input.note === undefined ? before.testNote : input.note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(appUsers.id, before.id))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.update",
    entityType: "app_user",
    entityId: updated.id,
    before,
    after: updated,
  });
  return updated;
}

/**
 * Delete a test user and everything hanging off it. Balances, ledger entries,
 * subscriptions, usage counters, purchases and the Stripe customer mirror all
 * cascade on `app_user_id`, so the row delete is the whole cleanup.
 */
export async function deleteTestUser(input: {
  applicationId: string;
  appUserId: string;
  actor: Actor;
}) {
  const before = await requireTestUser(input.applicationId, input.appUserId);
  await db.delete(appUsers).where(eq(appUsers.id, before.id));

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.delete",
    entityType: "app_user",
    entityId: before.id,
    before,
  });
  return { id: before.id };
}

/**
 * Put a test user on a plan without taking a payment.
 *
 * Goes through the same `upsertSubscriptionFromStripe` the webhook uses, with a
 * synthetic subscription id, so the resulting row — including its frozen
 * entitlement snapshot and its period balance grants — is indistinguishable from
 * one that came from a real checkout.
 */
export async function grantTestSubscription(input: {
  applicationId: string;
  appUserId: string;
  planId: string;
  periodDays?: number;
  actor: Actor;
}) {
  const user = await requireTestUser(input.applicationId, input.appUserId);

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, input.planId), eq(plans.applicationId, input.applicationId)))
    .limit(1);
  if (!plan) throw new NotFoundError("plan", input.planId);

  const periodDays = input.periodDays ?? DEFAULT_PERIOD_DAYS;
  if (!Number.isSafeInteger(periodDays) || periodDays <= 0) {
    throw new ValidationError("periodDays must be a positive integer");
  }

  const now = new Date();
  const { subscription } = await upsertSubscriptionFromStripe({
    applicationId: input.applicationId,
    appUserId: user.id,
    planId: plan.id,
    stripeSubscriptionId: `sub_test_${user.id}_${plan.id}`,
    stripeCustomerId: `cus_test_${user.id}`,
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + periodDays * 86_400_000),
    cancelAtPeriodEnd: false,
  });

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.grant_subscription",
    entityType: "subscription",
    entityId: subscription.id,
    after: subscription,
  });
  return subscription;
}

/** Seed a starting balance. Uses the ordinary ledger so history looks real. */
export async function creditTestBalance(input: {
  applicationId: string;
  appUserId: string;
  unitId: string;
  amount: number;
  actor: Actor;
}) {
  const user = await requireTestUser(input.applicationId, input.appUserId);
  const result = await creditBalance({
    appUserId: user.id,
    unitId: input.unitId,
    amount: input.amount,
    kind: "adjustment",
    description: "Test balance",
    idempotencyKey: `test_credit:${newId()}`,
    referenceType: "test_user",
    referenceId: user.id,
  });

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.credit_balance",
    entityType: "app_user",
    entityId: user.id,
    after: { unitId: input.unitId, amount: input.amount, entryId: result.entry.id },
  });
  return result.entry;
}

/** The role ids a user holds directly, ignoring plans and default roles. */
async function directRoleIds(appUserId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: appUserRoles.roleId })
    .from(appUserRoles)
    .where(eq(appUserRoles.appUserId, appUserId));
  return rows.map((row) => row.roleId);
}

/**
 * Replace the roles a test user holds directly.
 *
 * Roles normally arrive with a plan, which makes the permission-gated parts of
 * an application awkward to try out: you would have to buy something first.
 * Granting them here goes through the same resolution path, so the application
 * sees an ordinary role holder.
 */
export async function setTestUserRoles(input: {
  applicationId: string;
  appUserId: string;
  roleIds: string[];
  actor: Actor;
}) {
  const user = await requireTestUser(input.applicationId, input.appUserId);
  const roleIds = Array.from(new Set(input.roleIds.filter(Boolean)));
  // Each role is re-checked against the application, so a hand-edited form
  // cannot attach another application's role to this user.
  for (const roleId of roleIds) await requireRole(input.applicationId, roleId);

  const before = await directRoleIds(user.id);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.delete(appUserRoles).where(eq(appUserRoles.appUserId, user.id));
    if (roleIds.length === 0) return;
    await tx.insert(appUserRoles).values(
      roleIds.map((roleId) => ({
        id: newId(),
        appUserId: user.id,
        roleId,
        createdAt: now,
      })),
    );
  });

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.set_roles",
    entityType: "app_user",
    entityId: user.id,
    before: { roleIds: before },
    after: { roleIds },
  });
  return roleIds;
}

/**
 * Pin a usage allowance for one test user. `limitValue` null means unlimited.
 *
 * The override wins over the plan allowance in both directions, so a limit can
 * be lowered to the edge of the cap and then raised again without editing —
 * and without disturbing — the plan every other subscriber is on.
 */
export async function setTestUserUsageLimit(input: {
  applicationId: string;
  appUserId: string;
  usageItemId: string;
  limitValue: number | null;
  actor: Actor;
}) {
  const user = await requireTestUser(input.applicationId, input.appUserId);
  const item = await requireUsageItem(input.applicationId, input.usageItemId);
  if (input.limitValue !== null) {
    assertNonNegativeInteger(input.limitValue, "limitValue");
  }

  const now = new Date();
  const [saved] = await db
    .insert(appUserUsageLimits)
    .values({
      id: newId(),
      appUserId: user.id,
      usageItemId: item.id,
      limitValue: input.limitValue,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [appUserUsageLimits.appUserId, appUserUsageLimits.usageItemId],
      set: { limitValue: input.limitValue, updatedAt: now },
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.set_usage_limit",
    entityType: "app_user",
    entityId: user.id,
    after: { usageItemId: item.id, limitValue: input.limitValue },
  });
  return saved;
}

/** Drop the override, putting the user back on the plan allowance. */
export async function clearTestUserUsageLimit(input: {
  applicationId: string;
  appUserId: string;
  usageItemId: string;
  actor: Actor;
}) {
  const user = await requireTestUser(input.applicationId, input.appUserId);
  const item = await requireUsageItem(input.applicationId, input.usageItemId);

  await db
    .delete(appUserUsageLimits)
    .where(
      and(
        eq(appUserUsageLimits.appUserId, user.id),
        eq(appUserUsageLimits.usageItemId, item.id),
      ),
    );

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.clear_usage_limit",
    entityType: "app_user",
    entityId: user.id,
    before: { usageItemId: item.id },
  });
}

/**
 * Raise a test user's allowance by `by`, starting from whatever they have now.
 *
 * This is what the test app's "raise the limit" button calls: hitting a limit
 * and then lifting it is the whole point of the exercise, and the caller should
 * not have to know whether the current number came from a plan, the item
 * default, or an earlier override.
 */
export async function increaseTestUserUsageLimit(input: {
  applicationId: string;
  appUserId: string;
  usageItemId: string;
  by: number;
  actor: Actor;
}) {
  const user = await requireTestUser(input.applicationId, input.appUserId);
  const item = await requireUsageItem(input.applicationId, input.usageItemId);
  const by = assertPositiveInteger(input.by, "by");

  const entitlements = await resolveEntitlements({
    applicationId: input.applicationId,
    appUserId: user.id,
  });
  const current =
    item.id in entitlements.usageLimits
      ? entitlements.usageLimits[item.id]
      : item.defaultLimit;
  if (current === null) {
    throw new ValidationError(`${item.name} is already unlimited`);
  }

  await setTestUserUsageLimit({
    applicationId: input.applicationId,
    appUserId: user.id,
    usageItemId: item.id,
    limitValue: current + by,
    actor: input.actor,
  });
  return { usageItemId: item.id, limitValue: current + by };
}

/**
 * Move a test user's clock, in milliseconds relative to real time.
 *
 * Nothing else moves: their subscription dates, ledger and audit rows stay on
 * the real timeline. What changes is which usage period `now` falls in, which
 * is exactly what a reset policy is made of.
 */
export async function setTestUserClock(input: {
  applicationId: string;
  appUserId: string;
  offsetMs: number;
  actor: Actor;
}) {
  const before = await requireTestUser(input.applicationId, input.appUserId);
  const offsetMs = clampClockOffset(input.offsetMs);

  const [updated] = await db
    .update(appUsers)
    .set({ testClockOffsetMs: offsetMs, updatedAt: new Date() })
    .where(eq(appUsers.id, before.id))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_user.set_clock",
    entityType: "app_user",
    entityId: updated.id,
    before: { testClockOffsetMs: before.testClockOffsetMs },
    after: { testClockOffsetMs: updated.testClockOffsetMs },
  });
  return updated;
}

/** Jump forward (or back, with a negative value) from where the clock is now. */
export async function advanceTestUserClock(input: {
  applicationId: string;
  appUserId: string;
  byMs: number;
  actor: Actor;
}) {
  const user = await requireTestUser(input.applicationId, input.appUserId);
  if (!Number.isFinite(input.byMs) || input.byMs === 0) {
    throw new ValidationError("byMs must be a non-zero number of milliseconds");
  }
  return setTestUserClock({
    applicationId: input.applicationId,
    appUserId: user.id,
    offsetMs: user.testClockOffsetMs + input.byMs,
    actor: input.actor,
  });
}

export interface TestUserSummary {
  user: AppUser;
  subscriptions: {
    id: string;
    planName: string;
    planKey: string;
    status: string;
    currentPeriodEnd: Date | null;
  }[];
  balances: { unitKey: string; unitName: string; amount: number }[];
  /** Roles held directly. Plan-granted roles are not repeated here. */
  roles: { roleId: string; key: string; title: string }[];
  usageLimits: {
    usageItemId: string;
    itemKey: string;
    itemName: string;
    limitValue: number | null;
  }[];
}

/**
 * Everything the Test tab renders per row, in a fixed number of queries rather
 * than one per user, so the page cost does not grow with the number of test
 * users.
 */
export async function listTestUsers(
  applicationId: string,
): Promise<TestUserSummary[]> {
  const users = await db
    .select()
    .from(appUsers)
    .where(and(eq(appUsers.applicationId, applicationId), eq(appUsers.isTest, true)))
    .orderBy(desc(appUsers.createdAt));
  if (users.length === 0) return [];

  const ids = users.map((user) => user.id);
  const [subscriptionRows, balanceRows, roleRows, limitRows] = await Promise.all([
    db
      .select({
        id: subscriptions.id,
        appUserId: subscriptions.appUserId,
        planName: plans.name,
        planKey: plans.key,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(inArray(subscriptions.appUserId, ids))
      .orderBy(desc(subscriptions.startedAt)),
    db
      .select({
        appUserId: balances.appUserId,
        unitKey: balanceUnits.key,
        unitName: balanceUnits.name,
        amount: balances.amount,
      })
      .from(balances)
      .innerJoin(balanceUnits, eq(balances.unitId, balanceUnits.id))
      .where(inArray(balances.appUserId, ids)),
    db
      .select({
        appUserId: appUserRoles.appUserId,
        roleId: subscriptionRoles.id,
        key: subscriptionRoles.key,
        title: subscriptionRoles.title,
      })
      .from(appUserRoles)
      .innerJoin(subscriptionRoles, eq(appUserRoles.roleId, subscriptionRoles.id))
      .where(inArray(appUserRoles.appUserId, ids)),
    db
      .select({
        appUserId: appUserUsageLimits.appUserId,
        usageItemId: usageItems.id,
        itemKey: usageItems.key,
        itemName: usageItems.name,
        limitValue: appUserUsageLimits.limitValue,
      })
      .from(appUserUsageLimits)
      .innerJoin(usageItems, eq(appUserUsageLimits.usageItemId, usageItems.id))
      .where(inArray(appUserUsageLimits.appUserId, ids)),
  ]);

  return users.map((user) => ({
    user,
    subscriptions: subscriptionRows
      .filter((row) => row.appUserId === user.id)
      .map((row) => ({
        id: row.id,
        planName: row.planName,
        planKey: row.planKey,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd,
      })),
    balances: balanceRows
      .filter((row) => row.appUserId === user.id)
      .map((row) => ({
        unitKey: row.unitKey,
        unitName: row.unitName,
        amount: row.amount,
      })),
    roles: roleRows
      .filter((row) => row.appUserId === user.id)
      .map((row) => ({ roleId: row.roleId, key: row.key, title: row.title })),
    usageLimits: limitRows
      .filter((row) => row.appUserId === user.id)
      .map((row) => ({
        usageItemId: row.usageItemId,
        itemKey: row.itemKey,
        itemName: row.itemName,
        limitValue: row.limitValue,
      })),
  }));
}
