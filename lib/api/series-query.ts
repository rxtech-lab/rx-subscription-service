import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { ApiError, type ApiContext } from "./context";
import { isGranularity, type Granularity } from "@/lib/subscription/series";

/**
 * The parameters both statistics endpoints share.
 *
 * Kept apart from `context.ts` because the rule here is the opposite of
 * `resolveRequestUser`'s: that one creates a user on first reference, which is
 * right for a debit but wrong for a read — a mistyped id in a stats query would
 * quietly litter the table with empty users. These endpoints look up, or 404.
 */

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export interface SeriesRange {
  from: Date;
  to: Date;
  granularity: Granularity;
}

function parseDate(value: string | null, field: string): Date {
  if (!value) {
    throw new ApiError(400, "invalid_request", `${field} is required`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ApiError(400, "invalid_request", `${field} must be an ISO 8601 date`);
  }
  return parsed;
}

export function parseSeriesRange(url: URL): SeriesRange {
  const from = parseDate(url.searchParams.get("from"), "from");
  const to = parseDate(url.searchParams.get("to"), "to");
  if (from.getTime() > to.getTime()) {
    throw new ApiError(400, "invalid_request", "from must not be after to");
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new ApiError(400, "invalid_request", "range must not exceed 366 days");
  }

  const granularity = url.searchParams.get("granularity") ?? "day";
  if (!isGranularity(granularity)) {
    throw new ApiError(
      400,
      "invalid_request",
      "granularity must be one of minute, hour, day, week, month",
    );
  }
  return { from, to, granularity };
}

/**
 * Resolve the optional `rxlabUserId` filter without creating anything.
 *
 * Returns null when the caller wants the whole application. Scoped by
 * `isTest` so a sandbox key cannot read a production user's history.
 *
 * A publishable key never gets the application-wide series: omitting the
 * filter narrows to the token's own user rather than widening to everyone,
 * and naming somebody else is rejected.
 */
export async function findSeriesUser(
  context: ApiContext,
  rxlabUserId: string | null,
): Promise<string | null> {
  let target = rxlabUserId;

  if (context.user) {
    if (target && target !== context.user.subject) {
      throw new ApiError(
        403,
        "user_mismatch",
        "A publishable key can only read the statistics of the user its access token identifies",
      );
    }
    target = context.user.subject;
  }

  if (!target) return null;

  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.applicationId, context.application.id),
        eq(appUsers.rxlabUserId, target),
        eq(appUsers.isTest, context.environment === "sandbox"),
      ),
    )
    .limit(1);

  if (!user) {
    throw new ApiError(404, "user_not_found", `No user "${target}"`);
  }
  return user.id;
}
