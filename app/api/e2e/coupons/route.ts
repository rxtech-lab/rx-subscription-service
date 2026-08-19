import { z } from "zod";
import { apiError, authenticateApiRequest } from "@/lib/api/context";
import { e2eNotFound, isAuthorizedE2ERequest } from "@/lib/e2e/request";
import { createCoupon, setCouponStatus } from "@/lib/subscription/coupons";

const schema = z.object({
  code: z.string(),
  name: z.string(),
  discountType: z.enum(["percent", "amount"]),
  percentBasisPoints: z.number().int().positive().nullable().optional(),
  amountOffCents: z.number().int().positive().nullable().optional(),
  maxDiscountCents: z.number().int().positive().nullable().optional(),
  appliesTo: z.enum(["all", "selected"]).default("all"),
  planIds: z.array(z.string()).default([]),
  topupProductIds: z.array(z.string()).default([]),
  restrictToUsers: z.boolean().default(false),
  appUserIds: z.array(z.string()).default([]),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  maxRedemptionsPerUser: z.number().int().positive().nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  redeemBy: z.string().datetime({ offset: true }).nullable().optional(),
});

/** Test-only setup seam. It is unavailable unless both E2E guards are present. */
export async function POST(request: Request) {
  if (!isAuthorizedE2ERequest(request)) return e2eNotFound();

  try {
    const context = await authenticateApiRequest(request);
    const input = schema.parse(await request.json());
    const actor = { type: "system" as const, id: "playwright" };
    const created = await createCoupon({
      applicationId: context.application.id,
      ...input,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      redeemBy: input.redeemBy ? new Date(input.redeemBy) : null,
      actor,
    });
    const coupon = await setCouponStatus({
      applicationId: context.application.id,
      couponId: created.id,
      status: "active",
      actor,
    });
    return Response.json(coupon);
  } catch (error) {
    return apiError(error);
  }
}
