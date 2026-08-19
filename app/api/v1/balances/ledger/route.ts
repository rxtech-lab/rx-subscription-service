import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  resolveRequestUser,
} from "@/lib/api/context";
import { getBalanceUnitByKey } from "@/lib/subscription/units";
import { getLedgerHistory } from "@/lib/subscription/users";

const querySchema = z.object({
  rxlabUserId: z.string().min(1),
  unit: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      rxlabUserId: url.searchParams.get("rxlabUserId") ?? undefined,
      unit: url.searchParams.get("unit") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid ledger query",
      );
    }

    const user = await resolveRequestUser(context, {
      rxlabUserId: parsed.data.rxlabUserId,
    });
    const unit = parsed.data.unit
      ? await getBalanceUnitByKey(context.application.id, parsed.data.unit)
      : null;
    if (parsed.data.unit && !unit) {
      throw new ApiError(404, "unknown_unit", `No balance unit "${parsed.data.unit}"`);
    }

    const result = await getLedgerHistory({
      appUserId: user.id,
      unitId: unit?.id,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
