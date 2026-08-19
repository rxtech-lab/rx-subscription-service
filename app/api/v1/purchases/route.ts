import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  resolveRequestUser,
} from "@/lib/api/context";
import { listPurchaseHistory } from "@/lib/subscription/purchases";

const querySchema = z.object({
  rxlabUserId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      rxlabUserId: url.searchParams.get("rxlabUserId") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid purchases query",
      );
    }

    const user = await resolveRequestUser(context, {
      rxlabUserId: parsed.data.rxlabUserId,
    });
    const result = await listPurchaseHistory({
      applicationId: context.application.id,
      appUserId: user.id,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
