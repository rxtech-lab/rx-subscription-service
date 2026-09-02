import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
  resolveRequestUser,
} from "@/lib/api/context";
import { getUsageItemByKey } from "@/lib/subscription/usage-items";
import { getUsageStatus, recordUsage } from "@/lib/subscription/usage";
import { apiUsageKey, scopedApiUsageKey } from "@/lib/api/idempotency";

const schema = z.object({
  rxlabUserId: z.string().min(1),
  item: z.string().min(1),
  amount: z.number().int().positive().default(1),
  idempotencyKey: z.string().min(1).max(180).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Report usage against a metered item. */
export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "usage.record");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid usage request",
      );
    }

    const item = await getUsageItemByKey(context.application.id, parsed.data.item);
    if (!item) {
      throw new ApiError(404, "unknown_usage_item", `No usage item "${parsed.data.item}"`);
    }

    const user = await resolveRequestUser(context, {
      rxlabUserId: parsed.data.rxlabUserId,
    });

    // Without a caller-supplied key each retry is a distinct event, which is the
    // correct default for fire-and-forget metering.
    const callerIdempotencyKey =
      parsed.data.idempotencyKey ??
      request.headers.get("idempotency-key") ??
      `usage:${user.id}:${item.id}:${crypto.randomUUID()}`;
    const legacyIdempotencyKey = apiUsageKey(
      context.application.id,
      context.environment,
      callerIdempotencyKey,
    );
    const idempotencyKey = scopedApiUsageKey(
      context.application.id,
      context.environment,
      user.id,
      item.id,
      callerIdempotencyKey,
    );

    const result = await recordUsage({
      applicationId: context.application.id,
      appUserId: user.id,
      usageItemId: item.id,
      amount: parsed.data.amount,
      idempotencyKey,
      legacyIdempotencyKey,
      metadata: parsed.data.metadata ?? null,
    });

    return Response.json(result, {
      status: result.allowed ? 200 : 402,
      headers: noStore,
    });
  } catch (error) {
    return apiError(error);
  }
}

/** Current usage for every item. */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "usage.read");
    const url = new URL(request.url);
    const user = await resolveRequestUser(context, {
      rxlabUserId: url.searchParams.get("rxlabUserId") ?? undefined,
    });

    const usage = await getUsageStatus({
      applicationId: context.application.id,
      appUserId: user.id,
    });
    return Response.json({ usage }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
