import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  balanceUnits,
  balances,
  plans,
  subscriptions,
  type AppUser,
} from "@/lib/db/schema";
import {
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";
import { upsertSubscriptionFromStripe } from "./subscriptions";
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
}

/**
 * Everything the Test tab renders per row, in three queries rather than one per
 * user, so the page cost does not grow with the number of test users.
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
  const [subscriptionRows, balanceRows] = await Promise.all([
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
  }));
}
