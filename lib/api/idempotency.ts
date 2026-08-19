/** Caller keys are application-local; these prefixes isolate API operations. */
export function apiBalanceKey(applicationId: string, callerKey: string) {
  return `api:${applicationId}:${callerKey.trim()}`;
}

export function apiReservationKey(applicationId: string, callerKey: string) {
  return `api:${applicationId}:balance-reservation:${callerKey.trim()}`;
}

export function apiReservationOperationKey(
  applicationId: string,
  callerKey: string,
) {
  return `api:${applicationId}:balance-reservation-operation:${callerKey.trim()}`;
}
