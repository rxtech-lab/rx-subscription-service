import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  resolveRequestUser,
} from "@/lib/api/context";
import {
  requireAppleIntegration,
  setAppleConsumptionConsent,
} from "@/lib/iap/configuration";

const schema = z.object({
  rxlabUserId: z.string().min(1),
  consented: z.boolean(),
});

export async function PUT(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request");
    }
    await requireAppleIntegration(context.application.id);
    const user = await resolveRequestUser(context, parsed.data);
    const link = await setAppleConsumptionConsent({
      user,
      consented: parsed.data.consented,
    });
    return Response.json(
      { consented: link.consumptionDataConsent, updatedAt: link.consentUpdatedAt },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
