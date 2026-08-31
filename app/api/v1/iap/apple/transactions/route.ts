import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  resolveRequestUser,
} from "@/lib/api/context";
import { requireAppleIntegration } from "@/lib/iap/configuration";
import { fulfillAppleTransaction } from "@/lib/iap/apple/service";

const schema = z.object({
  rxlabUserId: z.string().min(1),
  signedTransaction: z.string().min(16).max(100_000),
});

export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid transaction request");
    }
    const integration = await requireAppleIntegration(context.application.id);
    const user = await resolveRequestUser(context, parsed.data);
    const result = await fulfillAppleTransaction({
      integration,
      environment: context.environment,
      signedTransaction: parsed.data.signedTransaction,
      expectedUser: user,
      fetchAuthoritative: true,
    });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
