import { z } from "zod";
import { apiError, authenticateApiRequest } from "@/lib/api/context";
import { e2eNotFound, isAuthorizedE2ERequest } from "@/lib/e2e/request";
import {
  saveAppleIntegration,
  saveAppleProductMapping,
} from "@/lib/iap/configuration";

const schema = z.object({
  productId: z.string().min(1),
  planId: z.string().optional(),
  topupProductId: z.string().optional(),
  /** The App Store price, when it differs from the local one. */
  priceAmountCents: z.number().int().nonnegative().nullish(),
  currency: z.string().min(3).max(3).nullish(),
});

export async function POST(request: Request) {
  if (!isAuthorizedE2ERequest(request)) return e2eNotFound();
  try {
    const context = await authenticateApiRequest(request);
    const input = schema.parse(await request.json());
    const actor = { type: "system" as const, id: "playwright" };
    const integration = await saveAppleIntegration({
      applicationId: context.application.id,
      bundleId: "com.rxlab.e2e",
      appAppleId: 123456789,
      enabled: true,
      actor,
    });
    const mapping = await saveAppleProductMapping({
      applicationId: context.application.id,
      productId: input.productId,
      planId: input.planId,
      topupProductId: input.topupProductId,
      priceAmountCents: input.priceAmountCents,
      currency: input.currency,
      actor,
    });
    return Response.json({ integration, mapping });
  } catch (error) {
    return apiError(error);
  }
}
