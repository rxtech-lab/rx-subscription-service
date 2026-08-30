import "server-only";
import {
  DeliveryStatus,
  NotificationTypeV2,
  RefundPreference,
} from "@apple/app-store-server-library";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  balanceLots,
  ledgerEntries,
  storeAccountLinks,
  storeProviderEvents,
  storeTransactions,
} from "@/lib/db/schema";
import { getAppleIntegration } from "@/lib/iap/configuration";
import { newId, ValidationError } from "@/lib/subscription/shared";
import { appleApiClient, verifyAppleNotification } from "./client";
import { fulfillAppleTransaction } from "./service";

const STALE_EVENT_MS = 15 * 60_000;

export async function verifyAndClaimAppleNotification(input: {
  applicationId: string;
  signedPayload: string;
}) {
  const integration = await getAppleIntegration(input.applicationId);
  if (!integration) throw new ValidationError("App Store integration is not configured");
  const verified = await verifyAppleNotification(integration, input.signedPayload);
  const payload = verified.payload;
  if (!payload.notificationUUID || !payload.notificationType) {
    throw new ValidationError("App Store notification identity is missing");
  }
  if (payload.data) {
    if (payload.data.bundleId !== integration.bundleId) {
      throw new ValidationError("App Store notification bundle ID does not match");
    }
    if (
      verified.environment === "production" &&
      payload.data.appAppleId !== integration.appAppleId
    ) {
      throw new ValidationError("App Store notification app ID does not match");
    }
  }
  const now = new Date();
  const [created] = await db
    .insert(storeProviderEvents)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      provider: "apple_app_store",
      environment: verified.environment,
      providerEventId: payload.notificationUUID,
      type: payload.notificationType,
      subtype: payload.subtype ?? null,
      status: "processing",
      signedAt: payload.signedDate ? new Date(payload.signedDate) : null,
      signedPayload: input.signedPayload,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return { event: created, duplicate: false as const };

  const [existing] = await db
    .select()
    .from(storeProviderEvents)
    .where(
      and(
        eq(storeProviderEvents.provider, "apple_app_store"),
        eq(storeProviderEvents.providerEventId, payload.notificationUUID),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("APPLE_EVENT_CLAIM_FAILED");
  if (existing.status === "processed" || existing.status === "ignored") {
    return { event: existing, duplicate: true as const };
  }
  const [reclaimed] = await db
    .update(storeProviderEvents)
    .set({ status: "processing", failureCode: null, processedAt: null })
    .where(
      and(
        eq(storeProviderEvents.id, existing.id),
        existing.status === "failed"
          ? eq(storeProviderEvents.status, "failed")
          : lt(
              storeProviderEvents.createdAt,
              new Date(now.getTime() - STALE_EVENT_MS),
            ),
      ),
    )
    .returning();
  return { event: reclaimed ?? existing, duplicate: reclaimed ? false : true };
}

async function sendConsumptionIfConsented(input: {
  applicationId: string;
  transactionId: string;
  environment: "sandbox" | "production";
}) {
  const [transaction] = await db
    .select()
    .from(storeTransactions)
    .where(
      and(
        eq(storeTransactions.provider, "apple_app_store"),
        eq(storeTransactions.transactionId, input.transactionId),
      ),
    )
    .limit(1);
  if (!transaction) throw new ValidationError("Consumption transaction is unknown");
  const [account] = await db
    .select()
    .from(storeAccountLinks)
    .where(
      and(
        eq(storeAccountLinks.appUserId, transaction.appUserId),
        eq(storeAccountLinks.provider, "apple_app_store"),
      ),
    )
    .limit(1);
  if (!account?.consumptionDataConsent) return false;

  const grants = await db
    .select({ originalAmount: balanceLots.originalAmount, remaining: balanceLots.remaining })
    .from(balanceLots)
    .innerJoin(ledgerEntries, eq(balanceLots.ledgerEntryId, ledgerEntries.id))
    .where(
      and(
        eq(ledgerEntries.referenceType, "store_transaction"),
        eq(ledgerEntries.referenceId, transaction.id),
      ),
    );
  const original = grants.reduce((sum, lot) => sum + lot.originalAmount, 0);
  const remaining = grants.reduce((sum, lot) => sum + lot.remaining, 0);
  const consumed = original > 0 ? Math.max(0, original - remaining) : 0;
  const percentage =
    original > 0 ? Math.min(100_000, Math.floor((consumed * 100_000) / original)) : 0;
  const integration = await getAppleIntegration(input.applicationId);
  if (!integration) throw new ValidationError("App Store integration is missing");
  await appleApiClient(integration, input.environment).sendConsumptionInformation(
    input.transactionId,
    {
      customerConsented: true,
      consumptionPercentage: percentage,
      deliveryStatus:
        transaction.purchaseId || transaction.subscriptionId
          ? DeliveryStatus.DELIVERED
          : DeliveryStatus.UNDELIVERED_OTHER,
      sampleContentProvided: false,
      refundPreference:
        percentage === 0
          ? RefundPreference.GRANT_FULL
          : percentage < 100_000
            ? RefundPreference.GRANT_PRORATED
            : RefundPreference.DECLINE,
    },
  );
  return true;
}

export async function processStoredAppleNotification(eventId: string) {
  const [event] = await db
    .select()
    .from(storeProviderEvents)
    .where(eq(storeProviderEvents.id, eventId))
    .limit(1);
  if (!event || event.status === "processed" || event.status === "ignored") return;
  const integration = await getAppleIntegration(event.applicationId);
  if (!integration) throw new ValidationError("App Store integration is missing");

  try {
    const { payload, environment } = await verifyAppleNotification(
      integration,
      event.signedPayload,
    );
    const signedTransaction = payload.data?.signedTransactionInfo;
    if (signedTransaction) {
      const result = await fulfillAppleTransaction({
        integration,
        environment,
        signedTransaction,
        status: payload.data?.status,
        signedRenewalInfo: payload.data?.signedRenewalInfo,
        refundReversed:
          payload.notificationType === NotificationTypeV2.REFUND_REVERSED,
        stateSignedAt: payload.signedDate ? new Date(payload.signedDate) : undefined,
      });
      if (payload.notificationType === NotificationTypeV2.CONSUMPTION_REQUEST) {
        await sendConsumptionIfConsented({
          applicationId: event.applicationId,
          transactionId: result.transaction.transactionId,
          environment,
        });
      }
    }
    await db
      .update(storeProviderEvents)
      .set({
        status: signedTransaction ? "processed" : "ignored",
        processedAt: new Date(),
        failureCode: null,
      })
      .where(eq(storeProviderEvents.id, event.id));
  } catch (error) {
    await db
      .update(storeProviderEvents)
      .set({
        status: "failed",
        failureCode: error instanceof Error ? error.name : "unknown_error",
        processedAt: null,
      })
      .where(eq(storeProviderEvents.id, event.id));
    throw error;
  }
}

export async function markAppleNotificationDispatchFailed(eventId: string) {
  await db
    .update(storeProviderEvents)
    .set({ status: "failed", failureCode: "workflow_dispatch_failed" })
    .where(eq(storeProviderEvents.id, eventId));
}
