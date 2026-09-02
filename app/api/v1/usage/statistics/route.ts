import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageItems } from "@/lib/db/schema";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
} from "@/lib/api/context";
import { findSeriesUser, parseSeriesRange } from "@/lib/api/series-query";
import { getUsageSeries } from "@/lib/subscription/consumption";

/**
 * Metered events over time, bucketed and optionally grouped by item.
 *
 * Separate from `GET /api/v1/usage`, which stays the point-in-time counter
 * readout (`used` / `limit` / `remaining` / `resetsAt`) that callers gate turns
 * on. This one answers "how much, when" and is built from `usage_records`, so
 * it is unaffected by counters resetting at a period boundary.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "usage.statistics.read");
    const url = new URL(request.url);
    const { from, to, granularity } = parseSeriesRange(url);

    const groupByParam = url.searchParams.get("groupBy");
    if (groupByParam && groupByParam !== "item") {
      throw new ApiError(400, "invalid_request", "groupBy must be item");
    }
    const groupBy = groupByParam as "item" | null;

    const itemKey = url.searchParams.get("item");
    let usageItemId: string | null = null;
    if (itemKey) {
      const [item] = await db
        .select({ id: usageItems.id })
        .from(usageItems)
        .where(
          and(
            eq(usageItems.applicationId, context.application.id),
            eq(usageItems.key, itemKey),
          ),
        )
        .limit(1);
      if (!item) {
        throw new ApiError(404, "unknown_usage_item", `No usage item "${itemKey}"`);
      }
      usageItemId = item.id;
    }

    const appUserId = await findSeriesUser(
      context,
      url.searchParams.get("rxlabUserId"),
    );

    const series = await getUsageSeries({
      applicationId: context.application.id,
      appUserId,
      usageItemId,
      from,
      to,
      granularity,
      groupBy,
      environment: context.environment,
    });

    return Response.json(series, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
