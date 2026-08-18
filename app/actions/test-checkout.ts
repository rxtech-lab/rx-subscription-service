"use server";

import { redirect } from "next/navigation";
import {
  createPlanCheckout,
  createTopupCheckout,
  NotEligibleError,
} from "@/lib/stripe/checkout";
import { siteUrl } from "@/lib/stripe/client";
import { readTestSession } from "@/lib/test-session";
import { toActionState, type ActionState } from "./shared";

/**
 * The storefront's callers are test users, not console admins, so these actions
 * authorize against the signed test-session cookie instead of `withApplication`.
 * The cookie names exactly one test user, and `readTestSession` re-verifies that
 * the user still exists and is still a test user on every call.
 */
async function requireSession() {
  const session = await readTestSession();
  if (!session) redirect("/test/expired");
  return session;
}

function returnUrls(applicationId: string, kind: "plan" | "topup") {
  const origin = siteUrl();
  const base = `${origin}/test/${encodeURIComponent(applicationId)}`;
  return {
    successUrl: `${base}/checkout/complete?kind=${kind}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/checkout/complete?status=cancelled`,
  };
}

export async function startTestPlanCheckoutAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  let checkoutUrl: string;
  try {
    const result = await createPlanCheckout({
      applicationId: session.applicationId,
      user: session.user,
      planId: String(formData.get("planId") ?? ""),
      mode: "sandbox",
      ...returnUrls(session.applicationId, "plan"),
    });
    checkoutUrl = result.checkoutUrl;
  } catch (error) {
    if (error instanceof Error && error.message === "STRIPE_SANDBOX_NOT_CONFIGURED") {
      return { error: "Stripe sandbox is not configured for this environment." };
    }
    return toActionState(error);
  }
  redirect(checkoutUrl);
}

export async function startTestTopupCheckoutAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  let checkoutUrl: string;
  try {
    const result = await createTopupCheckout({
      applicationId: session.applicationId,
      user: session.user,
      topupId: String(formData.get("topupId") ?? ""),
      mode: "sandbox",
      ...returnUrls(session.applicationId, "topup"),
    });
    checkoutUrl = result.checkoutUrl;
  } catch (error) {
    if (error instanceof NotEligibleError) {
      return { error: "You are not eligible to buy this pack." };
    }
    if (error instanceof Error && error.message === "STRIPE_SANDBOX_NOT_CONFIGURED") {
      return { error: "Stripe sandbox is not configured for this environment." };
    }
    return toActionState(error);
  }
  redirect(checkoutUrl);
}

