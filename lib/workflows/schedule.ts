import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { trialWatchWorkflow } from "./trial-watch";
import { balanceExpirySweepWorkflow } from "./balance-expiry-sweep";

/**
 * Starting workflow runs from ordinary server code.
 *
 * Every entry point here is best-effort: a subscription must still sync, and a
 * webhook must still return 200, when the workflow backend is unreachable or
 * simply not configured in a local checkout. The jobs are a punctuality
 * mechanism, never the thing that makes the data correct, so a failure to
 * schedule is logged and swallowed rather than failing the caller.
 */

/**
 * Watch one trial to its end.
 *
 * A trialing subscription re-syncs on every Stripe event, so this is called
 * repeatedly for the same trial. `start()` has no idempotency key, so the
 * already-scheduled run is recorded on the subscription and reused while the
 * trial end is unchanged. A trial whose end actually moves gets a fresh run;
 * the superseded one still fires but no-ops, because it re-reads the
 * subscription when it wakes rather than trusting what it was started with.
 */
export async function scheduleTrialWatch(input: {
  subscriptionId: string;
  trialEndsAt: Date;
}) {
  const runAt = input.trialEndsAt.getTime();
  if (!Number.isFinite(runAt)) return null;

  const [existing] = await db
    .select({
      trialWatchRunId: subscriptions.trialWatchRunId,
      trialWatchEndsAt: subscriptions.trialWatchEndsAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, input.subscriptionId))
    .limit(1);
  if (existing?.trialWatchRunId && existing.trialWatchEndsAt?.getTime() === runAt) {
    return existing.trialWatchRunId;
  }

  try {
    const run = await start(trialWatchWorkflow, [
      input.subscriptionId,
      input.trialEndsAt.toISOString(),
    ]);
    // Conditional on the run we read above, so two webhooks racing here record
    // one winner instead of interleaving into an inconsistent pair.
    await db
      .update(subscriptions)
      .set({
        trialWatchRunId: run.runId,
        trialWatchEndsAt: input.trialEndsAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptions.id, input.subscriptionId),
          existing?.trialWatchRunId
            ? eq(subscriptions.trialWatchRunId, existing.trialWatchRunId)
            : sql`${subscriptions.trialWatchRunId} IS NULL`,
        ),
      );
    return run.runId;
  } catch (error) {
    console.error(
      `Could not schedule trial watch for subscription ${input.subscriptionId}:`,
      error,
    );
    return null;
  }
}

/** Kick off a full expiry sweep. Called by the cron route. */
export async function startBalanceExpirySweep() {
  const run = await start(balanceExpirySweepWorkflow, []);
  return run.runId;
}
