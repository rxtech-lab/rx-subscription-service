import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
  resolveRequestUser,
} from "@/lib/api/context";
import {
  createBillingPortalSession,
  createPlanCheckout,
  createTopupCheckout,
  NotEligibleError,
} from "@/lib/stripe/checkout";
import { CouponNotApplicableError } from "@/lib/subscription/coupons";

const schema = z.object({
  rxlabUserId: z.string().min(1),
  email: z.string().email().optional(),
  displayName: z.string().max(120).optional(),
  kind: z.enum(["plan", "topup", "portal"]),
  planId: z.string().optional(),
  topupId: z.string().optional(),
  /** A coupon code belonging to this application. Never another app's. */
  couponCode: z.string().max(64).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  returnUrl: z.string().url().optional(),
});

/** Start a Stripe Checkout session, or open the billing portal. */
export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "checkout.create");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid checkout request",
      );
    }

    const user = await resolveRequestUser(context, {
      rxlabUserId: parsed.data.rxlabUserId,
      email: parsed.data.email ?? null,
      displayName: parsed.data.displayName ?? null,
    });

    if (parsed.data.kind === "portal") {
      const portal = await createBillingPortalSession({
        user,
        returnUrl: parsed.data.returnUrl,
      });
      return Response.json(portal, { headers: noStore });
    }

    if (parsed.data.kind === "plan") {
      if (!parsed.data.planId) {
        throw new ApiError(400, "invalid_request", "planId is required");
      }
      const result = await createPlanCheckout({
        applicationId: context.application.id,
        user,
        planId: parsed.data.planId,
        couponCode: parsed.data.couponCode,
        successUrl: parsed.data.successUrl,
        cancelUrl: parsed.data.cancelUrl,
      });
      return Response.json(result, { headers: noStore });
    }

    if (!parsed.data.topupId) {
      throw new ApiError(400, "invalid_request", "topupId is required");
    }
    const result = await createTopupCheckout({
      applicationId: context.application.id,
      user,
      topupId: parsed.data.topupId,
      couponCode: parsed.data.couponCode,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
    });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    // A refused code is the buyer's problem to fix, not a server fault, so it
    // comes back with the machine-readable blockers the app can act on.
    if (error instanceof CouponNotApplicableError) {
      return Response.json(
        {
          error: "coupon_not_applicable",
          error_description: error.message,
          blockers: error.blockers,
        },
        { status: 422, headers: noStore },
      );
    }
    if (error instanceof NotEligibleError) {
      return Response.json(
        {
          error: "not_eligible",
          error_description: error.message,
          blockedBy: error.failed,
        },
        { status: 403, headers: noStore },
      );
    }
    return apiError(error);
  }
}
