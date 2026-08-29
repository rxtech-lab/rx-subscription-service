import { sleep } from "workflow";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, subscriptions } from "@/lib/db/schema";
import { stripe, modeForUser } from "@/lib/stripe/client";
import {
  buildEntitlementSnapshot,
  grantPeriodBalances,
} from "@/lib/subscription/subscriptions";
import { expireBalanceLots } from "@/lib/subscription/balance-lots";

/**
 * Watch a trial to its end, then bring the subscriber onto paid footing.
 *
 * Everything here is also driven by `customer.subscription.updated` in the
 * ordinary case. This job exists because that is a single delivery of a single
 * webhook at a moment nobody is watching: if Stripe's event is dropped, or the
 * endpoint is down for the minute it arrives, a trialing user keeps trial
 * allowances indefinitely and the balance the trial granted never lapses. A
 * durable timer that wakes at the boundary and reconciles is the backstop.
 *
 * Every step is idempotent, so the webhook and this job racing at the boundary
 * is the expected case, not a failure.
 */

interface TrialContext {
  subscriptionId: string;
  applicationId: string;
  appUserId: string;
  planId: string;
  stripeSubscriptionId: string | null;
  isTest: boolean;
}

async function loadTrialContext(subscriptionId: string): Promise<TrialContext | null> {
  "use step";
  const [row] = await db
    .select({
      subscriptionId: subscriptions.id,
      applicationId: subscriptions.applicationId,
      appUserId: subscriptions.appUserId,
      planId: subscriptions.planId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      status: subscriptions.status,
      isTest: appUsers.isTest,
    })
    .from(subscriptions)
    .innerJoin(appUsers, eq(subscriptions.appUserId, appUsers.id))
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  if (!row) return null;
  return {
    subscriptionId: row.subscriptionId,
    applicationId: row.applicationId,
    appUserId: row.appUserId,
    planId: row.planId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    isTest: row.isTest,
  };
}

/**
 * Re-read the subscription from Stripe and push it back through the ordinary
 * webhook path, so status, period window, and grants all land exactly as a
 * delivered event would have left them.
 */
async function reconcileFromStripe(context: TrialContext): Promise<string | null> {
  "use step";
  if (!context.stripeSubscriptionId) return null;
  const mode = modeForUser({ isTest: context.isTest });
  const subscription = await stripe(mode).subscriptions.retrieve(
    context.stripeSubscriptionId,
  );
  // Imported here rather than at module scope: the webhook module schedules
  // this workflow, so a static import would close a cycle between the two.
  const { syncSubscriptionFromStripe } = await import("@/lib/stripe/webhook");
  await syncSubscriptionFromStripe(subscription);

  const [row] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.id, context.subscriptionId))
    .limit(1);
  return row?.status ?? null;
}

/**
 * Refresh the frozen entitlement copy.
 *
 * `resolveEntitlementLimit` reads `trialLimitValue` while the subscription is
 * trialing and `limitValue` afterwards, both out of this snapshot. Rebuilding
 * it at the boundary means a plan edited during the trial takes effect on the
 * paid allowance the subscriber is now on.
 */
async function resnapshotEntitlements(context: TrialContext) {
  "use step";
  const snapshot = await buildEntitlementSnapshot(context.planId);
  await db
    .update(subscriptions)
    .set({ entitlementSnapshot: snapshot, updatedAt: new Date() })
    .where(eq(subscriptions.id, context.subscriptionId));
  return snapshot.entitlements.length;
}

/**
 * Sweep the balance at the boundary.
 *
 * This deliberately expires only what the plan's own policy already marked as
 * expiring — a `period_end` grant made during the trial carries an expiry of
 * the trial end, so it lapses here. Grants configured to survive (`never`,
 * `duration`, `after_plan_end`) are left alone: the job's role is to make
 * expiry punctual, not to overrule how the plan was configured.
 */
async function expireLapsedTrialUnits(context: TrialContext) {
  "use step";
  const result = await expireBalanceLots({ appUserId: context.appUserId });
  return result.units;
}

/**
 * Credit the first paid period.
 *
 * Normally `invoice.paid` does this. Granting here as well is safe because the
 * key is derived from the period start, so whichever arrives second is a no-op.
 */
async function grantFirstPaidPeriod(context: TrialContext) {
  "use step";
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, context.subscriptionId))
    .limit(1);
  if (!row || (row.status !== "active" && row.status !== "past_due")) return 0;
  if (!row.currentPeriodStart) return 0;

  const results = await grantPeriodBalances({
    applicationId: row.applicationId,
    appUserId: row.appUserId,
    planId: row.planId,
    periodKey: String(row.currentPeriodStart.getTime()),
    periodEnd: row.currentPeriodEnd,
    subscriptionId: row.id,
  });
  return results.filter((result) => !result.duplicate).length;
}

/**
 * Sleep until the trial ends, then reconcile the subscriber onto paid terms.
 *
 * `trialEndsAt` is passed as an ISO string because workflow arguments are
 * serialized, and a `Date` survives that round trip far less predictably than
 * a string does.
 */
export async function trialWatchWorkflow(
  subscriptionId: string,
  trialEndsAt: string,
) {
  "use workflow";

  await sleep(new Date(trialEndsAt));

  const context = await loadTrialContext(subscriptionId);
  // The subscription was deleted outright during the trial; nothing to update.
  if (!context) return { status: "gone" as const };

  const status = await reconcileFromStripe(context);
  const entitlements = await resnapshotEntitlements(context);
  const expiredUnits = await expireLapsedTrialUnits(context);
  const granted = await grantFirstPaidPeriod(context);

  return { status, entitlements, expiredUnits, granted };
}
