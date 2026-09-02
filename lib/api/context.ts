import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  applications,
  appUsers,
  balanceReservations,
  type ApiEnvironment,
  type ApiKeyKind,
  type Application,
} from "@/lib/db/schema";
import { ensureAppUser } from "@/lib/subscription/users";
import { readRequestCredentials } from "./credentials";
import { ApiError } from "./errors";
import { resolveApiKey } from "./keys";
import { assertKeyKindAllows } from "./scopes";
import { requireUserTokenIssuer, verifyUserToken, type UserTokenPrincipal } from "./user-token";

export interface ApiContext {
  application: Application;
  keyId: string;
  environment: ApiEnvironment;
  kind: ApiKeyKind;
  /**
   * The verified end user, present only for publishable keys. Secret keys name
   * their user per request instead, so this stays null for them.
   */
  user: UserTokenPrincipal | null;
}

export { ApiError };

/**
 * Authenticate a request and establish who it acts for.
 *
 * A secret key authenticates on its own. A publishable key never does: it must
 * arrive with the end user's rxlab access token, and the user it may touch is
 * taken from that token rather than from anything the caller wrote.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiContext> {
  const { apiKey, userToken } = readRequestCredentials(request);
  if (!apiKey) {
    throw new ApiError(401, "missing_api_key", "Provide an X-Api-Key header");
  }

  const resolved = await resolveApiKey(apiKey);
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

  let user: UserTokenPrincipal | null = null;
  if (resolved.kind === "publishable") {
    if (!userToken) {
      throw new ApiError(
        401,
        "missing_user_token",
        "A publishable key requires the end user's access token in the Authorization header",
      );
    }
    // An empty allow-list would accept any rxlab user's token, so treat it as
    // a broken key rather than an open one. `createApiKey` refuses to mint
    // one; this catches rows edited by hand.
    if (resolved.allowedClientIds.length === 0) {
      throw new ApiError(
        403,
        "client_not_allowed",
        "This publishable key has no allowed OAuth clients",
      );
    }
    user = await verifyUserToken(userToken, {
      issuer: requireUserTokenIssuer(),
      allowedClientIds: resolved.allowedClientIds,
    });
  }

  return {
    application,
    keyId: resolved.keyId,
    environment: resolved.environment,
    kind: resolved.kind,
    user,
  };
}

/**
 * Reject an operation the presented key may not perform.
 *
 * Every `/api/v1` route calls this with its own operation name. Names in
 * `PUBLISHABLE_KEY_OPERATIONS` are reachable by both key kinds; anything else
 * is secret-key-only by construction, so a new route is closed to clients
 * until somebody deliberately adds it to that list.
 */
export function requireKeyScope(context: ApiContext, operation: string): void {
  assertKeyKindAllows(context.kind, operation);
}

/**
 * Resolve the target user of a request.
 *
 * Secret keys address users by their rxlab id (the token `sub`) and the local
 * record is created on first reference, so a backend never has to register
 * users up front. Publishable keys do not get that privilege: the user comes
 * from the verified token, and a request naming somebody else is rejected
 * rather than quietly redirected, so a misconfigured client fails loudly
 * instead of silently reading the wrong account.
 */
export async function resolveRequestUser(
  context: ApiContext,
  input: { rxlabUserId?: string; email?: string | null; displayName?: string | null },
) {
  const requested = input.rxlabUserId?.trim();

  if (context.user) {
    if (requested && requested !== context.user.subject) {
      throw new ApiError(
        403,
        "user_mismatch",
        "A publishable key can only act for the user its access token identifies",
      );
    }
    return ensureAppUser({
      applicationId: context.application.id,
      rxlabUserId: context.user.subject,
      // From the token, never the request: a client must not be able to
      // rewrite the profile it is signed in as.
      email: context.user.email,
      displayName: context.user.displayName,
      isTest: context.environment === "sandbox",
    });
  }

  if (!requested) {
    throw new ApiError(400, "missing_user", "rxlabUserId is required");
  }
  return ensureAppUser({
    applicationId: context.application.id,
    rxlabUserId: requested,
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
