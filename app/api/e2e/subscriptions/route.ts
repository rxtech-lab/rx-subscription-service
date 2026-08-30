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
import { grantTestSubscription } from "@/lib/subscription/test-users";

const schema = z.object({
  rxlabUserId: z.string().min(1),
  planId: z.string().min(1),
  status: z.enum(["active", "trialing"]).default("active"),
});

/** Simulate subscription grants for both production and sandbox E2E users. */
export async function POST(request: Request) {
  if (!isAuthorizedE2ERequest(request)) return e2eNotFound();

  try {
    const context = await authenticateApiRequest(request);
    const input = schema.parse(await request.json());
    const user = await resolveRequestUser(context, {
      rxlabUserId: input.rxlabUserId,
    });
    await requirePlan(context.application.id, input.planId);

    const subscription = user.isTest
      ? await grantTestSubscription({
          applicationId: context.application.id,
          appUserId: user.id,
          planId: input.planId,
          status: input.status,
          actor: { type: "system", id: null },
        })
      : await syncProductionSubscription({
          applicationId: context.application.id,
          appUserId: user.id,
          planId: input.planId,
          status: input.status,
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

async function syncProductionSubscription(input: {
  applicationId: string;
  appUserId: string;
  planId: string;
  status: "active" | "trialing";
}) {
  const now = new Date();
  const { subscription } = await upsertSubscriptionFromStripe({
    applicationId: input.applicationId,
    appUserId: input.appUserId,
    planId: input.planId,
    stripeSubscriptionId: `sub_e2e_${input.appUserId}_${input.planId}`,
    stripeCustomerId: `cus_e2e_${input.appUserId}`,
    status: input.status,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    cancelAtPeriodEnd: false,
  });
  return subscription;
}
