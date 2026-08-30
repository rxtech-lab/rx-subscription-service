import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
} from "@/lib/api/context";
import { findSeriesUser, parseSeriesRange } from "@/lib/api/series-query";
import { getConsumptionSeries } from "@/lib/subscription/consumption";
import { getBalanceUnitByKey } from "@/lib/subscription/units";

/**
 * Balance movement over time, bucketed and optionally grouped.
 *
 * `groupBy=description` is the interesting one for a metered app: the debit's
 * description is whatever the app wrote there — finance-bot writes the model
 * name — so it yields a spend breakdown with no extra instrumentation.
 *
 * Omit `rxlabUserId` for the whole application.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const url = new URL(request.url);
    const { from, to, granularity } = parseSeriesRange(url);

    const groupByParam = url.searchParams.get("groupBy");
    const groupBy =
      groupByParam === "kind" || groupByParam === "description"
        ? groupByParam
        : null;
    if (groupByParam && !groupBy) {
      throw new ApiError(
        400,
        "invalid_request",
        "groupBy must be kind or description",
      );
    }

    const unitKey = url.searchParams.get("unit");
    const unit = unitKey
      ? await getBalanceUnitByKey(context.application.id, unitKey)
      : null;
    if (unitKey && !unit) {
      throw new ApiError(404, "unknown_unit", `No balance unit "${unitKey}"`);
    }

    const appUserId = await findSeriesUser(
      context,
      url.searchParams.get("rxlabUserId"),
    );

    const series = await getConsumptionSeries({
      applicationId: context.application.id,
      appUserId,
      unitId: unit?.id ?? null,
      from,
      to,
      granularity,
      groupBy,
      isTest: context.environment === "sandbox",
    });

    return Response.json(
      {
        ...series,
        unit: unit
          ? {
              key: unit.key,
              name: unit.name,
              symbol: unit.symbol,
              precision: unit.precision,
            }
          : null,
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
