import { z } from "zod";
import { apiError, ApiError, authenticateApiRequest, noStore, requireKeyScope, resolveRequestUser } from "@/lib/api/context";
import { createPlanChangeSession } from "@/lib/stripe/plan-change";

const schema = z.object({
  rxlabUserId: z.string().min(1),
  subscriptionId: z.string().min(1),
  planId: z.string().min(1),
  returnUrl: z.string().url(),
  timing: z.enum(["immediate", "next_period"]).default("immediate"),
});

/** Open a hosted confirmation for an owned recurring Stripe subscription. */
export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "checkout.create");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid plan change request");
    const user = await resolveRequestUser(context, { rxlabUserId: parsed.data.rxlabUserId });
    const result = await createPlanChangeSession({
      applicationId: context.application.id, user,
      subscriptionId: parsed.data.subscriptionId, planId: parsed.data.planId,
      returnUrl: parsed.data.returnUrl, timing: parsed.data.timing,
    });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
