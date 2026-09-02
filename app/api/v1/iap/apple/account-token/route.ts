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
  getOrCreateStoreAccountLink,
  requireAppleIntegration,
} from "@/lib/iap/configuration";

const schema = z.object({ rxlabUserId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "apple.account-token");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request");
    }
    await requireAppleIntegration(context.application.id);
    const user = await resolveRequestUser(context, parsed.data);
    const link = await getOrCreateStoreAccountLink(user);
    return Response.json(
      { appAccountToken: link.providerAccountToken, environment: context.environment },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
