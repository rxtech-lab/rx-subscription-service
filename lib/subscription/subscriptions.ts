import "server-only";
import { and, desc, eq, gt, inArray, lte, ne, or } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import {
  appUsers,
  ledgerEntries,
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
import { addMonthsUtc, resolveExpiresAt } from "./balance-expiry-rules";
import { balanceAmountForSubscriptionStatus } from "./entitlement-rules";
import { stampLotsForPlanEnd } from "./balance-lots";
import { requirePlan } from "./plans";
import { simulatedNow } from "./test-clock";
import { complimentaryGrantSchema } from "./complimentary-schema";

const ACTIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due"] as const;

export interface OwnedPlan {
  planId: string;
  planName: string;
  planGroup: string;
  billingProvider: string;
  autoSubscribe: boolean;
}

/** Active recurring and paid/in-progress one-time plans owned by one user. */
export async function listOwnedPlans(input: {
  applicationId: string;
  appUserId: string;
  excludeSubscriptionId?: string;
  now?: Date;
}, executor: DbExecutor = db): Promise<OwnedPlan[]> {
  const subscriptionConditions = [
    eq(subscriptions.applicationId, input.applicationId),
    eq(subscriptions.appUserId, input.appUserId),
    inArray(subscriptions.status, [...ACTIVE_SUBSCRIPTION_STATUSES]),
    or(ne(subscriptions.billingProvider, "complimentary"), gt(subscriptions.currentPeriodEnd, input.now ?? new Date()))!,
  ];
  if (input.excludeSubscriptionId) {
    subscriptionConditions.push(ne(subscriptions.id, input.excludeSubscriptionId));
  }

  const [activeSubscriptions, oneTimePurchases] = await Promise.all([
    executor
      .select({
        planId: plans.id,
        planName: plans.name,
        planGroup: plans.planGroup,
        billingProvider: subscriptions.billingProvider,
        autoSubscribe: plans.autoSubscribe,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(and(...subscriptionConditions)),
    executor
      .select({
        planId: plans.id,
        planName: plans.name,
        planGroup: plans.planGroup,
        billingProvider: purchases.billingProvider,
        autoSubscribe: plans.autoSubscribe,
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
  now?: Date;
}, executor: DbExecutor = db) {
  const ownedPlans = await listOwnedPlans({
    applicationId: input.applicationId,
    appUserId: input.appUserId,
    excludeSubscriptionId: input.excludeSubscriptionId,
    now: input.now,
  }, executor);
  const conflict = ownedPlans.find(
    (ownedPlan) =>
      ownedPlan.planGroup === input.plan.planGroup &&
      !(ownedPlan.billingProvider === "internal" && ownedPlan.autoSubscribe),
  );
  if (!conflict) return;
  if (conflict.planId === input.plan.id) {
    throw new ValidationError(`User already has the "${input.plan.name}" plan.`);
  }
  throw new ValidationError(
    `User already has "${conflict.planName}" in plan group "${conflict.planGroup}". A user can only have one plan in each group.`,
  );
}

/** Grant access without creating a store purchase or modifying a provider subscription. */
export async function grantComplimentarySubscription(input: {
  applicationId: string;
  appUserId: string;
  environment: "sandbox" | "production";
  planId: string;
  periodDays: number;
  reason: string;
  /** Stable SDK tool-call ID, so a resumed approval cannot grant twice. */
  operationId: string;
  actor: Actor;
}) {
  const parsed = complimentaryGrantSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const args = parsed.data;
  if (!input.operationId.trim() || input.operationId.length > 200) {
    throw new ValidationError("A valid grant operation ID is required");
  }

  return db.transaction(async (tx) => {
    // Serialize grants for this user, including grants to different plans in one group.
    const [user] = await tx.select().from(appUsers).where(and(
      eq(appUsers.id, args.appUserId), eq(appUsers.applicationId, input.applicationId),
    )).limit(1).for("update");
    if (!user) throw new NotFoundError("app user", args.appUserId);
    if (user.environment !== args.environment) {
      throw new ValidationError(`User belongs to ${user.environment}, not ${args.environment}`);
    }

    const providerSubscriptionId = `grant:${input.operationId}`;
    const [previous] = await tx.select().from(subscriptions).where(and(
      eq(subscriptions.applicationId, input.applicationId),
      eq(subscriptions.appUserId, user.id),
      eq(subscriptions.billingProvider, "complimentary"),
      eq(subscriptions.providerSubscriptionId, providerSubscriptionId),
    )).limit(1);
    if (previous) {
      const details = previous.entitlementSnapshot?.complimentary as
        { periodDays?: number; reason?: string } | undefined;
      if (previous.planId !== args.planId || details?.periodDays !== args.periodDays || details?.reason !== args.reason) {
        throw new ValidationError("This grant operation was already used with different details");
      }
      return { subscription: previous, environment: user.environment, duplicate: true };
    }

    const [plan] = await tx.select().from(plans).where(and(
      eq(plans.id, args.planId), eq(plans.applicationId, input.applicationId),
    )).limit(1).for("share");
    if (!plan) throw new NotFoundError("plan", args.planId);
    if (plan.status !== "active") throw new ValidationError("Choose an active plan for complimentary access");
    if (plan.autoSubscribe) throw new ValidationError("This plan already provides automatic free access");

    const now = simulatedNow(user.testClockOffsetMs);
    await expireComplimentarySubscriptions({ applicationId: input.applicationId, appUserId: user.id, now }, tx);
    await assertPlanGroupAvailable({ applicationId: input.applicationId, appUserId: user.id, plan, now }, tx);
    const snapshot = await buildEntitlementSnapshot(plan.id, tx);
    const periodEnd = new Date(now.getTime() + args.periodDays * 86_400_000);
    const [subscription] = await tx.insert(subscriptions).values({
      id: newId(), applicationId: input.applicationId, appUserId: user.id, planId: plan.id,
      status: "active", billingProvider: "complimentary", providerSubscriptionId,
      currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true,
      entitlementSnapshot: { ...snapshot, complimentary: { periodDays: args.periodDays, reason: args.reason } },
      startedAt: now, createdAt: new Date(), updatedAt: new Date(),
    }).returning();

    await replaceInternalDefaultForPlan({ applicationId: input.applicationId, appUserId: user.id, planId: plan.id }, tx);
    // One allowance grant for this access period; there are no paid renewals.
    await grantPeriodBalances({
      applicationId: input.applicationId, appUserId: user.id, planId: plan.id,
      subscriptionId: subscription.id, periodKey: subscription.id, periodEnd,
      status: "active", idempotencyPrefix: "complimentary_plan_grant",
      referenceType: "subscription", referenceId: subscription.id,
    }, tx);
    await recordAudit({
      applicationId: input.applicationId, actor: input.actor,
      action: "subscription.grant_complimentary", entityType: "subscription", entityId: subscription.id,
      after: { ...subscription, environment: user.environment, reason: args.reason },
    }, tx);
    return { subscription, environment: user.environment, duplicate: false };
  });
}

/** Expiry is enforced on access reads and also swept for inactive users. */
export async function expireComplimentarySubscriptions(input: {
  applicationId?: string;
  appUserId?: string;
  now?: Date;
  limit?: number;
} = {}, executor: DbExecutor = db) {
  const now = input.now ?? new Date();
  return executor.transaction(async (tx) => {
    const rows = await tx.select().from(subscriptions).where(and(
      eq(subscriptions.billingProvider, "complimentary"),
      inArray(subscriptions.status, [...ACTIVE_SUBSCRIPTION_STATUSES]),
      lte(subscriptions.currentPeriodEnd, now),
      input.applicationId ? eq(subscriptions.applicationId, input.applicationId) : undefined,
      input.appUserId ? eq(subscriptions.appUserId, input.appUserId) : undefined,
    )).limit(input.limit ?? 500).for("update");
    for (const before of rows) {
      const endedAt = before.currentPeriodEnd!;
      await tx.update(subscriptions).set({ status: "expired", endedAt, cancelAtPeriodEnd: false, updatedAt: now })
        .where(eq(subscriptions.id, before.id));
      await stampLotsForPlanEnd({ subscriptionId: before.id, endedAt }, tx);
      await recordAudit({
        applicationId: before.applicationId, actor: { type: "system", id: null },
        action: "subscription.expire_complimentary", entityType: "subscription", entityId: before.id,
        before, after: { status: "expired", endedAt },
      }, tx);
    }
    return rows.length;
  });
}

function internalPeriodEnd(plan: Plan, start: Date): Date {
  const months =
    plan.billingInterval === "year"
      ? 12 * plan.intervalCount
      : plan.billingInterval === "quarter"
        ? 3 * plan.intervalCount
        : plan.intervalCount;
  return addMonthsUtc(start, months);
}

async function endInternalSubscriptions(ids: string[], endedAt: Date, executor: DbExecutor = db) {
  if (ids.length === 0) return;
  const ended = await executor
    .update(subscriptions)
    .set({
      status: "canceled",
      cancelAtPeriodEnd: false,
      endedAt,
      updatedAt: new Date(),
    })
    .where(inArray(subscriptions.id, ids))
    .returning({ id: subscriptions.id });
  await Promise.all(
    ended.map((row) =>
      stampLotsForPlanEnd({ subscriptionId: row.id, endedAt }, executor),
    ),
  );
}

/**
 * Replace an automatic free tier once a paid provider confirms another plan in
 * the same group. Checkout may be abandoned, so this runs at fulfillment, not
 * when the user merely opens the payment page.
 */
export async function replaceInternalDefaultForPlan(input: {
  applicationId: string;
  appUserId: string;
  planId: string;
}, executor: DbExecutor = db) {
  const target = await requirePlan(input.applicationId, input.planId, executor);
  const rows = await executor
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(
      and(
        eq(subscriptions.applicationId, input.applicationId),
        eq(subscriptions.appUserId, input.appUserId),
        eq(subscriptions.billingProvider, "internal"),
        inArray(subscriptions.status, [...ACTIVE_SUBSCRIPTION_STATUSES]),
        eq(plans.planGroup, target.planGroup),
        eq(plans.autoSubscribe, true),
      ),
    );
  await endInternalSubscriptions(
    rows.map((row) => row.id),
    new Date(),
    executor,
  );
}

/**
 * Keep provider-free subscriptions current and enroll the user into every
 * active automatic plan whose group is otherwise empty.
 */
export async function syncInternalDefaultSubscriptions(input: {
  applicationId: string;
  appUserId: string;
  now?: Date;
}) {
  const [user] = await db
    .select({ testClockOffsetMs: appUsers.testClockOffsetMs })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.id, input.appUserId),
        eq(appUsers.applicationId, input.applicationId),
      ),
    )
    .limit(1);
  if (!user) throw new NotFoundError("app user", input.appUserId);
  const now = input.now ?? simulatedNow(user.testClockOffsetMs);
  await expireComplimentarySubscriptions({ ...input, now });
  const internal = await db
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(
      and(
        eq(subscriptions.applicationId, input.applicationId),
        eq(subscriptions.appUserId, input.appUserId),
        eq(subscriptions.billingProvider, "internal"),
        inArray(subscriptions.status, [...ACTIVE_SUBSCRIPTION_STATUSES]),
      ),
    );

  for (const row of internal) {
    if (row.plan.billingInterval === "one_time") continue;
    let periodStart = row.subscription.currentPeriodStart ?? row.subscription.startedAt;
    let periodEnd =
      row.subscription.currentPeriodEnd ?? internalPeriodEnd(row.plan, periodStart);

    if (row.subscription.cancelAtPeriodEnd && now >= periodEnd) {
      await endInternalSubscriptions([row.subscription.id], periodEnd);
      continue;
    }
    if (row.subscription.cancelAtPeriodEnd) continue;

    const elapsedPeriods: { start: Date; end: Date }[] = [];
    while (now >= periodEnd) {
      periodStart = periodEnd;
      periodEnd = internalPeriodEnd(row.plan, periodStart);
      elapsedPeriods.push({ start: periodStart, end: periodEnd });
    }
    if (elapsedPeriods.length === 0) continue;

    const [advanced] = await db
      .update(subscriptions)
      .set({ currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, updatedAt: now })
      .where(
        and(
          eq(subscriptions.id, row.subscription.id),
          eq(subscriptions.updatedAt, row.subscription.updatedAt),
        ),
      )
      .returning({ id: subscriptions.id });
    if (!advanced) continue;

    for (const period of elapsedPeriods) {
      await grantPeriodBalances({
        applicationId: input.applicationId,
        appUserId: input.appUserId,
        planId: row.plan.id,
        periodKey: String(period.start.getTime()),
        periodEnd: period.end,
        subscriptionId: row.subscription.id,
        status: "active",
        idempotencyPrefix: "internal_plan_grant",
      });
    }
  }

  const defaultPlans = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.applicationId, input.applicationId),
        eq(plans.autoSubscribe, true),
        eq(plans.status, "active"),
        eq(plans.priceAmountCents, 0),
        ne(plans.billingInterval, "one_time"),
      ),
    );
  const owned = await listOwnedPlans({ ...input, now });
  const enrolled = [];

  for (const plan of defaultPlans) {
    if (owned.some((item) => item.planGroup === plan.planGroup)) continue;

    const [previous] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.applicationId, input.applicationId),
          eq(subscriptions.appUserId, input.appUserId),
          eq(subscriptions.planId, plan.id),
          eq(subscriptions.billingProvider, "internal"),
        ),
      )
      .limit(1);
    const snapshot = await buildEntitlementSnapshot(plan.id);
    const periodStart = now;
    const periodEnd = internalPeriodEnd(plan, periodStart);
    const providerSubscriptionId = `default:${plan.id}`;
    const [subscription] = previous
      ? await db
          .update(subscriptions)
          .set({
            status: "active",
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            billingProvider: "internal",
            providerSubscriptionId,
            providerProductId: null,
            stripeSubscriptionId: null,
            stripeCustomerId: null,
            entitlementSnapshot: snapshot,
            startedAt: now,
            endedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(subscriptions.id, previous.id),
              eq(subscriptions.status, previous.status),
              eq(subscriptions.updatedAt, previous.updatedAt),
            ),
          )
          .returning()
      : await db
          .insert(subscriptions)
          .values({
            id: newId(),
            applicationId: input.applicationId,
            appUserId: input.appUserId,
            planId: plan.id,
            status: "active",
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            billingProvider: "internal",
            providerSubscriptionId,
            entitlementSnapshot: snapshot,
            startedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning();
    if (!subscription) continue;

    await grantPeriodBalances({
      applicationId: input.applicationId,
      appUserId: input.appUserId,
      planId: plan.id,
      periodKey: String(periodStart.getTime()),
      periodEnd,
      subscriptionId: subscription.id,
      status: "active",
      idempotencyPrefix: "internal_plan_grant",
    });
    await recordAudit({
      applicationId: input.applicationId,
      actor: { type: "system", id: null },
      action: previous
        ? "subscription.auto_reactivate"
        : "subscription.auto_create",
      entityType: "subscription",
      entityId: subscription.id,
      before: previous ?? null,
      after: subscription,
    });
    owned.push({
      planId: plan.id,
      planName: plan.name,
      planGroup: plan.planGroup,
      billingProvider: "internal",
      autoSubscribe: true,
    });
    enrolled.push(subscription);
  }
  return enrolled;
}

/**
 * The slice of a plan entitlement `grantPeriodBalances` needs. One-time
 * purchases can supply a snapshot; recurring grants use the current plan.
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
 * Capture grants for purchase history and one-time fulfillment. Recurring
 * subscriptions use the current plan for access and future period grants.
 */
export async function buildEntitlementSnapshot(planId: string, executor: DbExecutor = db) {
  const entitlements = await executor
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
      planAutoSubscribe: plans.autoSubscribe,
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
      userEnvironment: appUsers.environment,
      userLabel: appUsers.displayName,
      userEmail: appUsers.email,
      rxlabUserId: appUsers.rxlabUserId,
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
    if ((ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(input.status)) {
      await replaceInternalDefaultForPlan({
        applicationId: input.applicationId,
        appUserId: input.appUserId,
        planId: input.planId,
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

  if ((ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(input.status)) {
    await replaceInternalDefaultForPlan({
      applicationId: input.applicationId,
      appUserId: input.appUserId,
      planId: input.planId,
    });
  }

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
  /** Only one-time purchases use supplied snapshots; subscriptions use live grants. */
  entitlements?: BalanceGrantEntitlement[];
  /** Selects a trial-specific grant amount when status is `trialing`. */
  status?: string;
  /** Defaults preserve the existing Stripe/local ledger contract. */
  idempotencyPrefix?: string;
  referenceType?: string;
  referenceId?: string;
}, executor: DbExecutor = db) {
  const entitlements =
    (input.subscriptionId ? undefined : input.entitlements) ??
    (await executor
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
    const keyPrefix = `${input.idempotencyPrefix ?? "plan_grant"}:${input.appUserId}:${input.planId}:${grant.unitId}`;
    const legacyKey = `${keyPrefix}:${input.periodKey}`;
    const stagedKey = `${legacyKey}:${input.status === "trialing" ? "trial" : "non_trial"}`;
    const idempotencyKey = hasDistinctTrialAmount ? stagedKey : legacyKey;
    if (input.subscriptionId) {
      // A live plan edit can switch between equal and distinct trial amounts.
      // Recognize the prior key format as the same credit, while keeping trial
      // and paid stages distinct when both were configured separately.
      const [prior] = await executor
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, hasDistinctTrialAmount ? legacyKey : stagedKey))
        .limit(1);
      if (prior) {
        results.push({ entry: prior, duplicate: true as const });
        continue;
      }
    }
    results.push(
      await creditBalance({
        appUserId: input.appUserId,
        unitId: grant.unitId!,
        amount,
        kind: "plan_grant",
        description: "Plan allowance",
        idempotencyKey,
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
      }, executor),
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
  if (before.billingProvider === "internal") {
    const plan = await requirePlan(input.applicationId, before.planId);
    if (plan.autoSubscribe) {
      throw new ValidationError(
        "Disable automatic subscription on the plan before canceling it",
      );
    }
  }

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

/**
 * Remove a development-only StoreKit subscription from the local entitlement
 * mirror. Apple remains authoritative outside the Xcode data plane, so this is
 * intentionally unavailable for sandbox and production subscriptions.
 *
 * Store transactions and granted balances stay intact as immutable purchase
 * history. Submitting a current signed transaction again can recreate the
 * subscription mirror.
 */
export async function deleteXcodeSubscription(input: {
  applicationId: string;
  subscriptionId: string;
  actor: Actor;
}) {
  const [found] = await db
    .select({
      subscription: subscriptions,
      userEnvironment: appUsers.environment,
    })
    .from(subscriptions)
    .innerJoin(appUsers, eq(subscriptions.appUserId, appUsers.id))
    .where(
      and(
        eq(subscriptions.id, input.subscriptionId),
        eq(subscriptions.applicationId, input.applicationId),
      ),
    )
    .limit(1);
  if (!found) throw new NotFoundError("subscription", input.subscriptionId);
  if (
    found.subscription.billingProvider !== "apple_app_store" ||
    found.userEnvironment !== "xcode"
  ) {
    throw new ValidationError(
      "Only Xcode App Store subscriptions can be deleted here",
    );
  }

  await db
    .delete(subscriptions)
    .where(
      and(
        eq(subscriptions.id, found.subscription.id),
        eq(subscriptions.applicationId, input.applicationId),
      ),
    );

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "subscription.delete_xcode",
    entityType: "subscription",
    entityId: found.subscription.id,
    before: found.subscription,
  });
  return { id: found.subscription.id };
}

/** Plans that can be sold right now. */
export async function listPurchasablePlans(applicationId: string): Promise<Plan[]> {
  return db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.applicationId, applicationId),
        eq(plans.status, "active"),
        eq(plans.autoSubscribe, false),
      ),
    );
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
