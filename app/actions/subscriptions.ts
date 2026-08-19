"use server";

import { redirect } from "next/navigation";
import type { Plan } from "@/lib/db/schema";
import { adminSubscriptionCheckoutUrls } from "@/lib/stripe/admin-checkout";
import { createPlanCheckout } from "@/lib/stripe/checkout";
import { siteUrl } from "@/lib/stripe/client";
import { requirePlan } from "@/lib/subscription/plans";
import { ValidationError } from "@/lib/subscription/shared";
import { requireAppUser } from "@/lib/subscription/users";
import {
  text,
  toActionState,
  withApplication,
  type ActionState,
} from "./shared";

function requireRecurringPlan(plan: Plan) {
  if (plan.billingInterval === "one_time") {
    throw new ValidationError("Choose a recurring plan to test a subscription");
  }
}

export async function startTestSubscriptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  let checkoutUrl = "";

  try {
    await withApplication(applicationId, async () => {
      const [user, plan] = await Promise.all([
        requireAppUser(applicationId, text(formData, "appUserId")),
        requirePlan(applicationId, text(formData, "planId")),
      ]);
      requireRecurringPlan(plan);

      const urls = adminSubscriptionCheckoutUrls(siteUrl(), applicationId);
      const checkout = await createPlanCheckout({
        applicationId,
        user,
        planId: plan.id,
        couponCode: text(formData, "couponCode"),
        successUrl: urls.successUrl,
        cancelUrl: urls.cancelUrl,
      });
      checkoutUrl = checkout.checkoutUrl;
    });
  } catch (error) {
    return toActionState(error);
  }

  redirect(checkoutUrl);
}
