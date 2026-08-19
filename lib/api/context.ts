import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  applications,
  appUsers,
  balanceReservations,
  type ApiEnvironment,
  type Application,
} from "@/lib/db/schema";
import { ensureAppUser } from "@/lib/subscription/users";
import { resolveApiKey } from "./keys";

export interface ApiContext {
  application: Application;
  keyId: string;
  environment: ApiEnvironment;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Authenticate a machine request. Accepts `X-Api-Key` or a bearer token; both
 * carry the same application-scoped key.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiContext> {
  const header =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!header) {
    throw new ApiError(401, "missing_api_key", "Provide an X-Api-Key header");
  }

  const resolved = await resolveApiKey(header);
  if (!resolved) throw new ApiError(401, "invalid_api_key", "API key is invalid or revoked");

  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, resolved.applicationId))
    .limit(1);
  if (!application) {
    throw new ApiError(401, "unknown_application", "Application no longer exists");
  }
  if (application.status !== "active") {
    throw new ApiError(403, "application_disabled", "Application is disabled");
  }

  return {
    application,
    keyId: resolved.keyId,
    environment: resolved.environment,
  };
}

/**
 * Resolve the target user of a request. Apps address users by their rxlab id
 * (the token `sub`); the local record is created on first reference so an app
 * never has to register users up front.
 */
export async function resolveRequestUser(
  context: ApiContext,
  input: { rxlabUserId?: string; email?: string | null; displayName?: string | null },
) {
  const rxlabUserId = input.rxlabUserId?.trim();
  if (!rxlabUserId) {
    throw new ApiError(400, "missing_user", "rxlabUserId is required");
  }
  return ensureAppUser({
    applicationId: context.application.id,
    rxlabUserId,
    email: input.email ?? null,
    displayName: input.displayName ?? null,
    isTest: context.environment === "sandbox",
  });
}

/**
 * Reservation ids are opaque but still need an environment ownership check.
 * This prevents a sandbox key from reading or mutating a production hold (and
 * vice versa) when both environments belong to the same application.
 */
export async function requireApiReservation(
  context: ApiContext,
  reservationId: string,
) {
  const [reservation] = await db
    .select({ id: balanceReservations.id })
    .from(balanceReservations)
    .innerJoin(appUsers, eq(balanceReservations.appUserId, appUsers.id))
    .where(
      and(
        eq(balanceReservations.id, reservationId),
        eq(balanceReservations.applicationId, context.application.id),
        eq(appUsers.isTest, context.environment === "sandbox"),
      ),
    )
    .limit(1);
  if (!reservation) {
    throw new ApiError(
      404,
      "reservation_not_found",
      `Balance reservation not found: ${reservationId}`,
    );
  }
}

export function apiError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.code, error_description: error.message, ...error.details },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const name = error instanceof Error ? error.name : "";
  if (name === "ValidationError") {
    return Response.json(
      { error: "invalid_request", error_description: (error as Error).message },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (name === "NotFoundError") {
    return Response.json(
      { error: "not_found", error_description: (error as Error).message },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (name === "InsufficientBalanceError") {
    const balanceError = error as Error & {
      available: number;
      requested: number;
    };
    return Response.json(
      {
        error: "insufficient_balance",
        error_description: balanceError.message,
        available: balanceError.available,
        required: balanceError.requested,
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (name === "IdempotencyConflictError") {
    return Response.json(
      { error: "idempotency_conflict", error_description: (error as Error).message },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (name === "ReservationNotFoundError") {
    return Response.json(
      { error: "reservation_not_found", error_description: (error as Error).message },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (name === "ReservationStateError") {
    const stateError = error as Error & { status: string };
    return Response.json(
      {
        error: "reservation_not_open",
        error_description: stateError.message,
        status: stateError.status,
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  console.error("API error:", error);
  return Response.json(
    { error: "server_error" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export const noStore = { "Cache-Control": "no-store" } as const;
