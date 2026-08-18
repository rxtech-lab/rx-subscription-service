import { z } from "zod";
import {
  apiError,
  authenticateApiRequest,
  resolveRequestUser,
} from "@/lib/api/context";
import { e2eNotFound, isAuthorizedE2ERequest } from "@/lib/e2e/request";
import { resolveEntitlements } from "@/lib/subscription/entitlements";
import { requirePlan } from "@/lib/subscription/plans";
import { upsertSubscriptionFromStripe } from "@/lib/subscription/subscriptions";

const schema = z.object({
  rxlabUserId: z.string().min(1),
  planId: z.string().min(1),
});

/** Simulate the authoritative Stripe subscription sync in Playwright tests. */
export async function POST(request: Request) {
  if (!isAuthorizedE2ERequest(request)) return e2eNotFound();

  try {
    const context = await authenticateApiRequest(request);
    const input = schema.parse(await request.json());
    const user = await resolveRequestUser(context, {
      rxlabUserId: input.rxlabUserId,
    });
    await requirePlan(context.application.id, input.planId);

    const now = new Date();
    const { subscription } = await upsertSubscriptionFromStripe({
      applicationId: context.application.id,
      appUserId: user.id,
      planId: input.planId,
      stripeSubscriptionId: `sub_e2e_${user.id}_${input.planId}`,
      stripeCustomerId: `cus_e2e_${user.id}`,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
      cancelAtPeriodEnd: false,
    });
    const entitlements = await resolveEntitlements({
      applicationId: context.application.id,
      appUserId: user.id,
    });
    return Response.json({ subscription, entitlements });
  } catch (error) {
    return apiError(error);
  }
}
