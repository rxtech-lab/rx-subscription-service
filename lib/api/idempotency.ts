import type { ApiEnvironment } from "@/lib/db/schema";

/**
 * Production retains its original namespace so in-flight retries from existing
 * clients remain idempotent after this feature ships. Sandbox adds an explicit
 * segment so the same caller key can safely be exercised in both environments.
 */
function environmentNamespace(
  applicationId: string,
  environment: ApiEnvironment,
) {
  return environment === "production"
    ? `api:${applicationId}`
    : `api:${applicationId}:sandbox`;
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

/** Keep production usage retry semantics unchanged while isolating sandbox. */
export function apiUsageKey(
  applicationId: string,
  environment: ApiEnvironment,
  callerKey: string,
) {
  return environment === "production"
    ? callerKey.trim()
    : `${environmentNamespace(applicationId, environment)}:usage:${callerKey.trim()}`;
}
