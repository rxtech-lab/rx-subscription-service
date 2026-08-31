import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  planEntitlements,
  plans,
  purchases,
  subscriptions,
  type BalanceExpiryPolicy,
  type Plan,
  type SubscriptionStatus,
} from "@/lib/db/schema";
import {
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";
import { creditBalance } from "./users";
import { resolveExpiresAt } from "./balance-expiry-rules";
import { balanceAmountForSubscriptionStatus } from "./entitlement-rules";
import { stampLotsForPlanEnd } from "./balance-lots";

const ACTIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due"] as const;

export interface OwnedPlan {
  planId: string;
  planName: string;
  planGroup: string;
}

/** Active recurring and paid/in-progress one-time plans owned by one user. */
export async function listOwnedPlans(input: {
  applicationId: string;
  appUserId: string;
  excludeSubscriptionId?: string;
}): Promise<OwnedPlan[]> {
  const subscriptionConditions = [
    eq(subscriptions.applicationId, input.applicationId),
    eq(subscriptions.appUserId, input.appUserId),
    inArray(subscriptions.status, [...ACTIVE_SUBSCRIPTION_STATUSES]),
  ];
  if (input.excludeSubscriptionId) {
    subscriptionConditions.push(ne(subscriptions.id, input.excludeSubscriptionId));
  }

  const [activeSubscriptions, oneTimePurchases] = await Promise.all([
    db
      .select({
        planId: plans.id,
        planName: plans.name,
        planGroup: plans.planGroup,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(and(...subscriptionConditions)),
    db
      .select({
        planId: plans.id,
        planName: plans.name,
        planGroup: plans.planGroup,
      })
      .from(purchases)
      .innerJoin(plans, eq(purchases.planId, plans.id))
      .where(
        and(
          eq(purchases.applicationId, input.applicationId),
          eq(purchases.appUserId, input.appUserId),
          eq(purchases.kind, "plan_one_time"),
          inArray(purchases.status, ["pending", "paid"]),
        ),
      )
  ]);
  return [...activeSubscriptions, ...oneTimePurchases];
}

/** Enforce one owned or in-progress plan per group before opening Checkout. */
export async function assertPlanGroupAvailable(input: {
  applicationId: string;
  appUserId: string;
  plan: Plan;
  excludeSubscriptionId?: string;
}) {
  const ownedPlans = await listOwnedPlans({
    applicationId: input.applicationId,
    appUserId: input.appUserId,
    excludeSubscriptionId: input.excludeSubscriptionId,
  });
  const conflict = ownedPlans.find(
    (ownedPlan) => ownedPlan.planGroup === input.plan.planGroup,
  );
  if (!conflict) return;
  if (conflict.planId === input.plan.id) {
    throw new ValidationError(`User already has the "${input.plan.name}" plan.`);
  }
  throw new ValidationError(
    `User already has "${conflict.planName}" in plan group "${conflict.planGroup}". A user can only have one plan in each group.`,
  );
}

/**
 * The slice of a plan entitlement `grantPeriodBalances` needs. Accepted as a
 * parameter so a caller holding an entitlement snapshot can grant from that
 * frozen copy instead of re-reading the live — possibly since edited — plan.
 */
export interface BalanceGrantEntitlement {
  kind: string;
  unitId: string | null;
  amount: number | null;
  trialAmount?: number | null;
  balanceExpiryPolicy?: BalanceExpiryPolicy | null;
  balanceExpiryMonths?: number | null;
}

/**
 * Freeze what a plan grants right now. Stored on the subscription so a later
 * edit to the plan does not change what an existing subscriber already bought.
 */
export async function buildEntitlementSnapshot(planId: string) {
  const entitlements = await db
    .select()
    .from(planEntitlements)
    .where(eq(planEntitlements.planId, planId));
  return { capturedAt: new Date().toISOString(), entitlements };
}

export async function listSubscriptions(
  applicationId: string,
  options: { appUserId?: string } = {},
) {
  const where = options.appUserId
    ? and(
        eq(subscriptions.applicationId, applicationId),
        eq(subscriptions.appUserId, options.appUserId),
      )
    : eq(subscriptions.applicationId, applicationId);

  return db
    .select({
      id: subscriptions.id,
      appUserId: subscriptions.appUserId,
      planId: subscriptions.planId,
      planName: plans.name,
      planKey: plans.key,
      planGroup: plans.planGroup,
      status: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      billingProvider: subscriptions.billingProvider,
      providerSubscriptionId: subscriptions.providerSubscriptionId,
      providerProductId: subscriptions.providerProductId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      startedAt: subscriptions.startedAt,
      // Carried so the console can tag test rows rather than hide them — an
      // admin watching a test checkout wants to see it land here.
      isTest: appUsers.isTest,
      userLabel: appUsers.displayName,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .innerJoin(appUsers, eq(subscriptions.appUserId, appUsers.id))
    .where(where)
    .orderBy(desc(subscriptions.startedAt));
}

export async function getSubscriptionByStripeId(stripeSubscriptionId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  return row ?? null;
}

/**
 * Create or update the local subscription from Stripe's view of it. Stripe is
 * the source of truth for status and period boundaries; everything else
 * (entitlements, balances) is derived here.
 */
export async function upsertSubscriptionFromStripe(input: {
  applicationId: string;
  appUserId: string;
  planId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  providerProductId?: string | null;
}) {
  const now = new Date();
  const existing = await getSubscriptionByStripeId(input.stripeSubscriptionId);

  if ((ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(input.status)) {
    const [plan] = await db
      .select()
      .from(plans)
      .where(
        and(
          eq(plans.id, input.planId),
          eq(plans.applicationId, input.applicationId),
        ),
      )
      .limit(1);
    if (!plan) throw new NotFoundError("plan", input.planId);
    await assertPlanGroupAvailable({
      applicationId: input.applicationId,
      appUserId: input.appUserId,
      plan,
      excludeSubscriptionId: existing?.id,
    });
  }

  if (existing) {
    const [updated] = await db
      .update(subscriptions)
      .set({
        billingProvider: "stripe",
        providerSubscriptionId: input.stripeSubscriptionId,
        providerProductId:
          input.providerProductId ?? existing.providerProductId,
        status: input.status,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        endedAt:
          input.status === "canceled" || input.status === "expired"
            ? (existing.endedAt ?? now)
            : null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, existing.id))
      .returning();

    // The plan has ended, so `after_plan_end` grants finally have the anchor
    // they were waiting for and can be given a real expiry.
    if (updated.endedAt) {
      await stampLotsForPlanEnd({
        subscriptionId: updated.id,
        endedAt: updated.endedAt,
      });
    }
    return { subscription: updated, created: false as const };
  }

  const [created] = await db
    .insert(subscriptions)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      appUserId: input.appUserId,
      planId: input.planId,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      billingProvider: "stripe",
      providerSubscriptionId: input.stripeSubscriptionId,
      providerProductId: input.providerProductId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeCustomerId: input.stripeCustomerId,
      entitlementSnapshot: await buildEntitlementSnapshot(input.planId),
      startedAt: input.currentPeriodStart ?? now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return { subscription: created, created: true as const };
}

/**
 * Credit the balance grants a plan includes for one billing period.
 *
 * The idempotency key is derived from the period, so a webhook replay — or two
 * events describing the same renewal — grants the period exactly once.
 */
export async function grantPeriodBalances(input: {
  applicationId: string;
  appUserId: string;
  planId: string;
  periodKey: string;
  /** End of the period being granted, the anchor for `period_end` expiry. */
  periodEnd?: Date | null;
  /** Recorded on each lot so plan end can find `after_plan_end` grants. */
  subscriptionId?: string | null;
  entitlements?: BalanceGrantEntitlement[];
  /** Selects a trial-specific grant amount when status is `trialing`. */
  status?: string;
  /** Defaults preserve the existing Stripe/local ledger contract. */
  idempotencyPrefix?: string;
  referenceType?: string;
  referenceId?: string;
}) {
  const entitlements =
    input.entitlements ??
    (await db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, input.planId)));

  const grants = entitlements.filter(
    (entitlement) => entitlement.kind === "balance_grant" && entitlement.unitId,
  );

  const grantedAt = new Date();
  const results = [];
  for (const grant of grants) {
    const amount = balanceAmountForSubscriptionStatus(
      grant,
      input.status ?? "active",
    );
    if (!amount || amount < 0) continue;
    const policy = grant.balanceExpiryPolicy ?? "never";
    const months = grant.balanceExpiryMonths ?? null;
    // Existing grants retain their historical key. Only a newly configured
    // stage-specific grant needs the stage suffix so trial and paid credits can
    // both land when a provider reuses the same period anchor at the boundary.
    const hasDistinctTrialAmount =
      typeof grant.trialAmount === "number" && grant.trialAmount !== grant.amount;
    const stageKey = hasDistinctTrialAmount
      ? `${input.periodKey}:${input.status === "trialing" ? "trial" : "non_trial"}`
      : input.periodKey;
    results.push(
      await creditBalance({
        appUserId: input.appUserId,
        unitId: grant.unitId!,
        amount,
        kind: "plan_grant",
        description: "Plan allowance",
        idempotencyKey: `${input.idempotencyPrefix ?? "plan_grant"}:${input.appUserId}:${input.planId}:${grant.unitId}:${stageKey}`,
        referenceType: input.referenceType ?? "plan",
        referenceId: input.referenceId ?? input.planId,
        expiresAt: resolveExpiresAt({
          policy,
          months,
          grantedAt,
          periodEnd: input.periodEnd ?? null,
        }),
        expiryPolicy: policy,
        expiryMonths: months,
        subscriptionId: input.subscriptionId ?? null,
        planId: input.planId,
      }),
    );
  }
  return results;
}

export async function cancelSubscription(input: {
  applicationId: string;
  subscriptionId: string;
  immediately: boolean;
  actor: Actor;
}) {
  const [before] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, input.subscriptionId),
        eq(subscriptions.applicationId, input.applicationId),
      ),
    )
    .limit(1);
  if (!before) throw new NotFoundError("subscription", input.subscriptionId);

  const now = new Date();
  const [updated] = await db
    .update(subscriptions)
    .set(
      input.immediately
        ? { status: "canceled", endedAt: now, cancelAtPeriodEnd: false, updatedAt: now }
        : { cancelAtPeriodEnd: true, updatedAt: now },
    )
    .where(eq(subscriptions.id, input.subscriptionId))
    .returning();

  // Only an immediate cancel ends the plan now. `cancel_at_period_end` leaves
  // the subscription running, so its grants keep their open-ended lots until
  // Stripe reports the subscription actually gone.
  if (updated.endedAt) {
    await stampLotsForPlanEnd({
      subscriptionId: updated.id,
      endedAt: updated.endedAt,
    });
  }

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: input.immediately ? "subscription.cancel" : "subscription.cancel_at_period_end",
    entityType: "subscription",
    entityId: updated.id,
    before,
    after: updated,
  });
  return updated;
}

/** Plans that can be sold right now. */
export async function listPurchasablePlans(applicationId: string): Promise<Plan[]> {
  return db
    .select()
    .from(plans)
    .where(and(eq(plans.applicationId, applicationId), eq(plans.status, "active")));
}

export async function getActiveSubscriptionForPlan(input: {
  appUserId: string;
  planId: string;
}) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.appUserId, input.appUserId),
        eq(subscriptions.planId, input.planId),
        inArray(subscriptions.status, ["trialing", "active", "past_due"]),
      ),
    )
    .limit(1);
  return row ?? null;
}
