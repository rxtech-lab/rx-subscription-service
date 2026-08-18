import { z } from "zod";
import { apiError, authenticateApiRequest } from "@/lib/api/context";
import { e2eNotFound, isAuthorizedE2ERequest } from "@/lib/e2e/request";
import {
  createTopupProduct,
  updateTopupProduct,
} from "@/lib/subscription/topups";

const schema = z.object({
  key: z.string(),
  name: z.string(),
  unitId: z.string(),
  amount: z.number().int().positive(),
  priceAmountCents: z.number().int().positive(),
  eligibility: z.discriminatedUnion("type", [
    z.object({ type: z.literal("standalone") }),
    z.object({ type: z.literal("plan"), planId: z.string() }),
    z.object({ type: z.literal("role"), roleId: z.string() }),
  ]),
});

/** Test-only setup seam. It is unavailable unless both E2E guards are present. */
export async function POST(request: Request) {
  if (!isAuthorizedE2ERequest(request)) return e2eNotFound();

  try {
    const context = await authenticateApiRequest(request);
    const input = schema.parse(await request.json());
    const actor = { type: "system" as const, id: "playwright" };
    const created = await createTopupProduct({
      applicationId: context.application.id,
      ...input,
      actor,
    });
    const product = await updateTopupProduct({
      applicationId: context.application.id,
      topupId: created.id,
      status: "active",
      actor,
    });
    return Response.json({ ...product, eligibilityRule: created.eligibilityRule });
  } catch (error) {
    return apiError(error);
  }
}
