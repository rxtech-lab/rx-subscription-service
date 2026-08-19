import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  resolveRequestUser,
} from "@/lib/api/context";
import { describeCoupon } from "@/lib/subscription/coupon-rules";
import {
  couponTerms,
  evaluateCoupon,
  findCouponByCode,
  type CouponTarget,
} from "@/lib/subscription/coupons";
import { requirePlan } from "@/lib/subscription/plans";
import { requireTopupProduct } from "@/lib/subscription/topups";

const schema = z
  .object({
    rxlabUserId: z.string().min(1),
    email: z.string().email().optional(),
    displayName: z.string().max(120).optional(),
    code: z.string().min(1).max(64),
    planId: z.string().optional(),
    topupId: z.string().optional(),
  })
  .refine((value) => Boolean(value.planId) !== Boolean(value.topupId), {
    message: "provide exactly one of planId or topupId",
  });

/**
 * Price a code before checkout.
 *
 * The same evaluation checkout performs, so what an app shows in its cart is
 * what Stripe charges. It is a preview, not a hold: checkout re-evaluates and
 * takes the redemption, so a code that runs out between the two is refused
 * there rather than silently overspent.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const applicationId = context.application.id;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid request",
      );
    }

    const user = await resolveRequestUser(context, {
      rxlabUserId: parsed.data.rxlabUserId,
      email: parsed.data.email ?? null,
      displayName: parsed.data.displayName ?? null,
    });

    const target: CouponTarget = parsed.data.planId
      ? { kind: "plan", plan: await requirePlan(applicationId, parsed.data.planId) }
      : {
          kind: "topup",
          product: await requireTopupProduct(applicationId, parsed.data.topupId!),
        };

    const coupon = await findCouponByCode(applicationId, parsed.data.code);
    if (!coupon) {
      return Response.json(
        {
          valid: false,
          reason: "That code is not valid for this app.",
          blockers: ["not_found"],
        },
        { headers: noStore },
      );
    }

    const evaluation = await evaluateCoupon({
      applicationId,
      coupon,
      appUserId: user.id,
      target,
    });

    return Response.json(
      {
        valid: evaluation.applies,
        code: coupon.code,
        name: coupon.name,
        description: coupon.description,
        terms: describeCoupon(couponTerms(coupon)),
        duration: coupon.duration,
        durationInMonths: coupon.durationInMonths,
        discountCents: evaluation.applies ? evaluation.discountCents : 0,
        totalCents: evaluation.applies
          ? evaluation.totalCents
          : (target.kind === "plan"
              ? target.plan.priceAmountCents
              : target.product.priceAmountCents),
        currency: evaluation.currency,
        capped: evaluation.capped,
        reason: evaluation.reason,
        blockers: evaluation.blockers,
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
