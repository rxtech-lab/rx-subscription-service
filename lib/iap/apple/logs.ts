import "server-only";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { db } from "@/lib/db";
import { auditLogs, type ApiEnvironment } from "@/lib/db/schema";
import { recordAudit } from "@/lib/subscription/shared";
import { requireAppUser } from "@/lib/subscription/users";

export type AppleLog = {
  level: "info" | "error";
  environment: ApiEnvironment;
  error?: string;
  accountToken?: string;
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  info?: Record<string, unknown>;
};

export function appleLogTransaction(transaction: JWSTransactionDecodedPayload) {
  return {
    accountToken: transaction.appAccountToken,
    transactionId: transaction.transactionId,
    originalTransactionId: transaction.originalTransactionId,
    productId: transaction.productId,
  };
}

// Full identifiers belong only in the authorized console/agent audit view,
// never in public API responses or infrastructure logs. Do not store signed JWS.
export async function recordAppleLog(applicationId: string, appUserId: string | null, event: string, data: AppleLog) {
  try {
    await recordAudit({ applicationId, actor: { type: "system", id: null },
      action: `apple_iap.${event}`, entityType: "apple_iap", entityId: appUserId,
      after: data,
    });
  } catch {
    console.warn("apple_iap.log_write_failed", { applicationId, event });
  }
}

export async function listAppleLogs(applicationId: string, appUserId?: string, filters: { environment?: ApiEnvironment; level?: "info" | "error"; transactionId?: string } = {}) {
  if (appUserId) await requireAppUser(applicationId, appUserId);
  return db.select().from(auditLogs).where(and(
    eq(auditLogs.applicationId, applicationId),
    eq(auditLogs.entityType, "apple_iap"),
    like(auditLogs.action, "apple_iap.%"),
    appUserId ? eq(auditLogs.entityId, appUserId) : undefined,
    filters.environment ? eq(sql`${auditLogs.after}->>'environment'`, filters.environment) : undefined,
    filters.level ? eq(sql`${auditLogs.after}->>'level'`, filters.level) : undefined,
    filters.transactionId ? or(eq(sql`${auditLogs.after}->>'transactionId'`, filters.transactionId), eq(sql`${auditLogs.after}->>'originalTransactionId'`, filters.transactionId)) : undefined,
  )).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(100);
}
