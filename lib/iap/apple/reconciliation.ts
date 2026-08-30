import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  storeReconciliationCursors,
  subscriptions,
  type ApiEnvironment,
  type AppleStoreIntegration,
} from "@/lib/db/schema";
import { listEnabledAppleIntegrations } from "@/lib/iap/configuration";
import { newId } from "@/lib/subscription/shared";
import { appleApiClient } from "./client";
import {
  processStoredAppleNotification,
  verifyAndClaimAppleNotification,
} from "./notifications";
import { fulfillAppleTransaction } from "./service";

const OVERLAP_MS = 15 * 60_000;
const INITIAL_LOOKBACK_MS = 24 * 60 * 60_000;

async function replayNotificationHistory(
  integration: AppleStoreIntegration,
  environment: ApiEnvironment,
) {
  const [cursor] = await db
    .select()
    .from(storeReconciliationCursors)
    .where(
      and(
        eq(storeReconciliationCursors.applicationId, integration.applicationId),
        eq(storeReconciliationCursors.provider, "apple_app_store"),
        eq(storeReconciliationCursors.environment, environment),
      ),
    )
    .limit(1);
  const end = new Date();
  const start = new Date(
    (cursor?.lastSyncedAt.getTime() ?? end.getTime() - INITIAL_LOOKBACK_MS) -
      OVERLAP_MS,
  );
  const client = appleApiClient(integration, environment);
  let paginationToken: string | null = null;
  let processed = 0;
  do {
    const page = await client.getNotificationHistory(paginationToken, {
      startDate: start.getTime(),
      endDate: end.getTime(),
    });
    for (const item of page.notificationHistory ?? []) {
      if (!item.signedPayload) continue;
      const claim = await verifyAndClaimAppleNotification({
        applicationId: integration.applicationId,
        signedPayload: item.signedPayload,
      });
      if (!claim.duplicate) {
        await processStoredAppleNotification(claim.event.id);
        processed += 1;
      }
    }
    paginationToken = page.hasMore ? page.paginationToken ?? null : null;
  } while (paginationToken);

  const now = new Date();
  if (cursor) {
    await db
      .update(storeReconciliationCursors)
      .set({ lastSyncedAt: end, updatedAt: now })
      .where(eq(storeReconciliationCursors.id, cursor.id));
  } else {
    await db.insert(storeReconciliationCursors).values({
      id: newId(),
      applicationId: integration.applicationId,
      provider: "apple_app_store",
      environment,
      lastSyncedAt: end,
      updatedAt: now,
    });
  }
  return processed;
}

async function reconcileActiveSubscriptions(
  integration: AppleStoreIntegration,
  environment: ApiEnvironment,
) {
  const rows = await db
    .select({ originalTransactionId: subscriptions.providerSubscriptionId })
    .from(subscriptions)
    .innerJoin(appUsers, eq(subscriptions.appUserId, appUsers.id))
    .where(
      and(
        eq(subscriptions.applicationId, integration.applicationId),
        eq(subscriptions.billingProvider, "apple_app_store"),
        inArray(subscriptions.status, ["trialing", "active", "past_due"]),
        eq(appUsers.isTest, environment === "sandbox"),
      ),
    );
  const client = appleApiClient(integration, environment);
  let reconciled = 0;
  for (const row of rows) {
    if (!row.originalTransactionId) continue;
    const response = await client.getAllSubscriptionStatuses(row.originalTransactionId);
    const latest = response.data
      ?.flatMap((group) => group.lastTransactions ?? [])
      .find((item) => item.originalTransactionId === row.originalTransactionId);
    if (!latest?.signedTransactionInfo) continue;
    await fulfillAppleTransaction({
      integration,
      environment,
      signedTransaction: latest.signedTransactionInfo,
      signedRenewalInfo: latest.signedRenewalInfo,
      status: latest.status,
    });
    reconciled += 1;
  }
  return reconciled;
}

export async function reconcileApplePurchases() {
  const integrations = await listEnabledAppleIntegrations();
  let notifications = 0;
  let subscriptions = 0;
  for (const integration of integrations) {
    for (const environment of ["sandbox", "production"] as const) {
      notifications += await replayNotificationHistory(integration, environment);
      subscriptions += await reconcileActiveSubscriptions(integration, environment);
    }
  }
  return { applications: integrations.length, notifications, subscriptions };
}
