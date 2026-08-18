"use server";

import { redirect } from "next/navigation";
import {
  advanceTestUserClock,
  increaseTestUserUsageLimit,
  setTestUserClock,
} from "@/lib/subscription/test-users";
import { offsetForTime } from "@/lib/subscription/test-clock";
import { newId } from "@/lib/subscription/shared";
import { recordUsage, resetUsageCounter } from "@/lib/subscription/usage";
import { readTestSession } from "@/lib/test-session";

/**
 * Usage controls for the simulated storefront.
 *
 * Like the checkout actions, these authorize against the signed test-session
 * cookie rather than a console login, and every service call underneath
 * re-checks that the named user is still a test user — so the "raise my own
 * limit" button here can never reach a real subscriber's allowance.
 */
async function requireSession() {
  const session = await readTestSession();
  if (!session) redirect("/test/expired");
  return session;
}

/**
 * Where the storefront lands after a usage action, with the outcome to show.
 *
 * The `n` param is a per-action nonce: repeating the same action would land on
 * a byte-identical URL, and the outcome toast keys off this to raise itself
 * again rather than staying hidden from the previous one.
 */
function backTo(
  applicationId: string,
  outcome: string,
  amount?: number,
): string {
  const params = new URLSearchParams({ usage: outcome, n: newId() });
  if (amount !== undefined) params.set("amount", String(amount));
  return `/test/${encodeURIComponent(applicationId)}?${params}#usage`;
}

/** The step size the caller is testing with, defaulting to a single unit. */
function requestedAmount(formData: FormData): number {
  const parsed = Math.trunc(Number(formData.get("amount") ?? 1));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * Spend against a usage item, in whatever step the caller set.
 *
 * The point is to walk into the limit deliberately, so a blocked call is a
 * normal outcome rather than an error: it comes back as a notice on the page.
 */
export async function recordTestUsageAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const usageItemId = String(formData.get("usageItemId") ?? "");
  const amount = requestedAmount(formData);

  let outcome: string;
  try {
    const result = await recordUsage({
      applicationId: session.applicationId,
      appUserId: session.user.id,
      usageItemId,
      amount,
      // Each click is its own operation. Reusing a key would replay the first
      // result instead of metering again.
      idempotencyKey: `test_app:${session.user.id}:${newId()}`,
      metadata: { source: "test_app" },
    });
    outcome = result.allowed ? "recorded" : (result.reason ?? "blocked");
  } catch (error) {
    console.error("Test usage failed:", error);
    outcome = "failed";
  }

  redirect(backTo(session.applicationId, outcome, amount));
}

/**
 * Move this user's clock forward, so a period that resets daily or monthly can
 * be watched rolling over now rather than next month.
 */
export async function advanceTestClockAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const byMs = Number(formData.get("byMs") ?? 0);

  let outcome: string;
  try {
    await advanceTestUserClock({
      applicationId: session.applicationId,
      appUserId: session.user.id,
      byMs,
      actor: { type: "system", id: session.user.id },
    });
    outcome = "clock_moved";
  } catch (error) {
    console.error("Advancing the test clock failed:", error);
    outcome = "failed";
  }

  redirect(backTo(session.applicationId, outcome));
}

/**
 * Jump the clock to a specific moment. The browser sends epoch milliseconds
 * rather than the field's wall-clock text, so the time the user picked is the
 * time they get whatever timezone the server runs in.
 */
export async function setTestClockAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const atMs = Number(formData.get("atMs"));

  let outcome: string;
  try {
    if (!Number.isFinite(atMs)) throw new Error("atMs is required");
    await setTestUserClock({
      applicationId: session.applicationId,
      appUserId: session.user.id,
      offsetMs: offsetForTime(new Date(atMs)),
      actor: { type: "system", id: session.user.id },
    });
    outcome = "clock_moved";
  } catch (error) {
    console.error("Setting the test clock failed:", error);
    outcome = "failed";
  }

  redirect(backTo(session.applicationId, outcome));
}

/** Put the user back on real time. */
export async function resetTestClockAction(): Promise<void> {
  const session = await requireSession();

  let outcome: string;
  try {
    await setTestUserClock({
      applicationId: session.applicationId,
      appUserId: session.user.id,
      offsetMs: 0,
      actor: { type: "system", id: session.user.id },
    });
    outcome = "clock_real";
  } catch (error) {
    console.error("Resetting the test clock failed:", error);
    outcome = "failed";
  }

  redirect(backTo(session.applicationId, outcome));
}

/**
 * Put the current period's counter back to zero.
 *
 * Counters normally roll over on their own schedule, which can be a month
 * away — too long to wait when you are trying the same flow twice.
 */
export async function resetTestUsageAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const usageItemId = String(formData.get("usageItemId") ?? "");

  let outcome: string;
  try {
    await resetUsageCounter({
      applicationId: session.applicationId,
      appUserId: session.user.id,
      usageItemId,
      actor: { type: "system", id: session.user.id },
    });
    outcome = "reset";
  } catch (error) {
    console.error("Resetting test usage failed:", error);
    outcome = "failed";
  }

  redirect(backTo(session.applicationId, outcome));
}

/** Raise this user's own allowance, so a blocked call can be tried again. */
export async function increaseTestUsageLimitAction(
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  const usageItemId = String(formData.get("usageItemId") ?? "");
  const by = Number(formData.get("by") ?? 10);

  let outcome: string;
  try {
    await increaseTestUserUsageLimit({
      applicationId: session.applicationId,
      appUserId: session.user.id,
      usageItemId,
      by: Number.isFinite(by) ? Math.trunc(by) : 10,
      actor: { type: "system", id: session.user.id },
    });
    outcome = "limit_raised";
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("already unlimited")) {
      outcome = "already_unlimited";
    } else {
      console.error("Raising the test usage limit failed:", error);
      outcome = "failed";
    }
  }

  redirect(backTo(session.applicationId, outcome));
}
