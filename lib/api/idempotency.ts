import type { ApiEnvironment } from "@/lib/db/schema";

/**
 * Production retains its original namespace so in-flight retries from existing
 * clients remain idempotent after this feature ships. Test environments add an
 * explicit segment so the same caller key can safely be exercised everywhere.
 */
function environmentNamespace(
  applicationId: string,
  environment: ApiEnvironment,
) {
  return environment === "production"
    ? `api:${applicationId}`
    : `api:${applicationId}:${environment}`;
}

/** Caller keys are application-local; these prefixes isolate API operations. */
export function apiBalanceKey(
  applicationId: string,
  environment: ApiEnvironment,
  callerKey: string,
) {
  return `${environmentNamespace(applicationId, environment)}:${callerKey.trim()}`;
}

export function apiReservationKey(
  applicationId: string,
  environment: ApiEnvironment,
  callerKey: string,
) {
  return `${environmentNamespace(applicationId, environment)}:balance-reservation:${callerKey.trim()}`;
}

export function apiReservationOperationKey(
  applicationId: string,
  environment: ApiEnvironment,
  callerKey: string,
) {
  return `${environmentNamespace(applicationId, environment)}:balance-reservation-operation:${callerKey.trim()}`;
}

/** The legacy usage key, retained for recognizing retries recorded before
 * usage keys were scoped to a user and meter. */
export function apiUsageKey(
  applicationId: string,
  environment: ApiEnvironment,
  callerKey: string,
) {
  return environment === "production"
    ? callerKey.trim()
    : `${environmentNamespace(applicationId, environment)}:usage:${callerKey.trim()}`;
}

/**
 * A caller's operation id may legitimately repeat for different users or
 * meters. Scope it before it reaches the globally unique database column.
 */
export function scopedApiUsageKey(
  applicationId: string,
  environment: ApiEnvironment,
  appUserId: string,
  usageItemId: string,
  callerKey: string,
) {
  return `${environmentNamespace(applicationId, environment)}:usage:${appUserId}:${usageItemId}:${callerKey.trim()}`;
}
