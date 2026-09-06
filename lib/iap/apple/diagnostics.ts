import { createHash } from "node:crypto";
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import type { AppUser } from "../../db/schema";

// Stable correlations without logging account tokens or external login identities.
export function appleDiagnosticFingerprint(value: string | undefined | null) {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 20) : null;
}

export function appleUserDiagnostic(user: Pick<AppUser,
  "id" | "applicationId" | "environment" | "rxlabUserId"
> | undefined | null) {
  return user ? {
    appUserId: user.id,
    applicationId: user.applicationId,
    environment: user.environment,
    identityFingerprint: appleDiagnosticFingerprint(user.rxlabUserId),
  } : null;
}

export function appleTransactionDiagnostic(transaction: JWSTransactionDecodedPayload) {
  // Explicit allowlist: never spread a decoded payload into logs.
  return {
    transactionFingerprint: appleDiagnosticFingerprint(transaction.transactionId),
    originalTransactionFingerprint: appleDiagnosticFingerprint(transaction.originalTransactionId),
    accountTokenFingerprint: appleDiagnosticFingerprint(transaction.appAccountToken?.toLowerCase()),
    environment: transaction.environment,
    productId: transaction.productId,
    purchaseDate: transaction.purchaseDate,
    expiresDate: transaction.expiresDate,
    revocationDate: transaction.revocationDate,
  };
}
