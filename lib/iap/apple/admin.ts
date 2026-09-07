import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, auditLogs, storeAccountLinks, storeTransactions } from "@/lib/db/schema";
import { newId, ValidationError, type Actor } from "@/lib/subscription/shared";
import { requireAppUser } from "@/lib/subscription/users";
import { requireAppleIntegration } from "@/lib/iap/configuration";
import { appleApiClient, verifyAppleTransaction } from "./client";
import { assertAppleEnvironment } from "./validation";
import { recordAppleLog } from "./logs";
import { appleTokenActionSchema } from "./admin-schema";

export async function getAppleUserAccount(applicationId: string, appUserId: string) {
  const user = await requireAppUser(applicationId, appUserId);
  const [account] = await db.select().from(storeAccountLinks).where(and(
    eq(storeAccountLinks.applicationId, applicationId), eq(storeAccountLinks.appUserId, user.id),
    eq(storeAccountLinks.provider, "apple_app_store"),
  )).limit(1);
  return { appUserId: user.id, environment: user.environment, account: account ?? null };
}

export async function manageAppleAccountToken(applicationId: string, actor: Actor, raw: unknown) {
  const input = appleTokenActionSchema.parse(raw);
  const user = await requireAppUser(applicationId, input.appUserId);
  if (user.environment !== input.environment) throw new ValidationError("User environment changed; reload before continuing");
  const integration = input.operation === "repair" ? await requireAppleIntegration(applicationId) : null;

  try { return await db.transaction(async (tx) => {
    // Serialize operations on this user, including the Apple update. No grants
    // or transaction ownership are moved by these administrative controls.
    await tx.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.id, user.id)).for("update");
    const [before] = await tx.select().from(storeAccountLinks).where(and(
      eq(storeAccountLinks.applicationId, applicationId), eq(storeAccountLinks.appUserId, user.id),
      eq(storeAccountLinks.provider, "apple_app_store"),
    )).limit(1);
    if ((before?.providerAccountToken.toLowerCase() ?? "") !== input.expectedToken.toLowerCase()) throw new ValidationError("Token changed; reload the user before continuing");
    let token: string | undefined = before?.providerAccountToken;

    if (input.operation === "repair") {
      if (!token || !integration) throw new ValidationError("Create or bind a local token first");
      const client = appleApiClient(integration, user.environment);
      const response = await client.getTransactionInfo(input.originalTransactionId!);
      if (!response.signedTransactionInfo) throw new ValidationError("Apple returned no transaction");
      const transaction = await verifyAppleTransaction(integration, user.environment, response.signedTransactionInfo);
      assertAppleEnvironment(transaction.environment, user.environment);
      if (transaction.bundleId !== integration.bundleId || transaction.originalTransactionId !== input.originalTransactionId) throw new ValidationError("Apple transaction does not match the selected application and original transaction ID");
      if (transaction.inAppOwnershipType === "FAMILY_SHARED") throw new ValidationError("Family Sharing transactions cannot be rebound");
      if (transaction.appAccountToken) {
        const [owner] = await tx.select({ applicationId: storeAccountLinks.applicationId, identity: appUsers.rxlabUserId })
          .from(storeAccountLinks).leftJoin(appUsers, eq(appUsers.id, storeAccountLinks.appUserId))
          .where(eq(sql`lower(${storeAccountLinks.providerAccountToken})`, transaction.appAccountToken.toLowerCase())).limit(1);
        if (owner && (owner.applicationId !== applicationId || owner.identity !== user.rxlabUserId)) throw new ValidationError("This purchase token belongs to another identity; automatic transfer is blocked");
      }
      const [otherFulfillment] = await tx.select({ id: storeTransactions.id }).from(storeTransactions).where(and(
        eq(storeTransactions.applicationId, applicationId),
        eq(storeTransactions.originalTransactionId, input.originalTransactionId!),
        ne(storeTransactions.appUserId, user.id),
      )).limit(1);
      if (otherFulfillment) throw new ValidationError("This purchase was fulfilled for another user record; reconcile its grants before repairing to avoid duplicate credits");
      await recordAppleLog(applicationId, user.id, "token_repair_requested", {
        level: "info", environment: user.environment, accountToken: token,
        originalTransactionId: input.originalTransactionId,
        info: { actorType: actor.type, actorId: actor.id, ownershipAcknowledged: true },
      });
      await client.setAppAccountToken(input.originalTransactionId!, { appAccountToken: token });
      // Persist independently: Apple cannot roll back if our local transaction
      // subsequently fails. Repeating this exact update is safe.
      await recordAppleLog(applicationId, user.id, "token_repair_accepted", {
        level: "info", environment: user.environment, accountToken: token,
        originalTransactionId: input.originalTransactionId,
        info: { grantsChanged: false, actorType: actor.type, actorId: actor.id },
      });
    } else if (input.operation === "remove") {
      if (!before) throw new ValidationError("No token mapping to remove");
      await tx.delete(storeAccountLinks).where(eq(storeAccountLinks.id, before.id));
      token = undefined;
    } else {
      if (input.operation === "create" && before) throw new ValidationError("A token already exists; use Bind token to replace it");
      token = input.operation === "create" ? crypto.randomUUID() : input.token!.toLowerCase();
      const [existingOwner] = await tx.select({ id: storeAccountLinks.id }).from(storeAccountLinks)
        .where(and(eq(storeAccountLinks.provider, "apple_app_store"), eq(sql`lower(${storeAccountLinks.providerAccountToken})`, token.toLowerCase()), ne(storeAccountLinks.appUserId, user.id))).limit(1);
      if (existingOwner) throw new ValidationError("Token is already bound to another user; it cannot be reassigned here");
      if (before) await tx.update(storeAccountLinks).set({ providerAccountToken: token, updatedAt: new Date() }).where(eq(storeAccountLinks.id, before.id));
      else await tx.insert(storeAccountLinks).values({ id: newId(), applicationId, appUserId: user.id, provider: "apple_app_store", providerAccountToken: token, createdAt: new Date(), updatedAt: new Date() });
    }
    await tx.insert(auditLogs).values({ id: newId(), applicationId, actorType: actor.type, actorId: actor.id,
      conversationId: actor.conversationId ?? null, action: `apple_iap.token_${input.operation}`, entityType: "apple_iap", entityId: user.id,
      before: { accountToken: before?.providerAccountToken ?? null },
      after: { level: "info", environment: user.environment, accountToken: token ?? null, originalTransactionId: input.originalTransactionId ?? null,
        info: { operation: input.operation, acknowledged: true, grantsChanged: false } }, createdAt: new Date() });
    return { operation: input.operation, accountToken: token ?? null, environment: user.environment,
      message: input.operation === "repair" ? "Apple accepted the token update. Refresh or restore in iOS; historical transactions are unchanged. No credits were granted by this action." : "Local token mapping updated. Apple purchase history is unchanged." };
  }); } catch (error) {
    await recordAppleLog(applicationId, user.id, "token_action_failed", {
      level: "error", environment: user.environment,
      error: error instanceof Error && error.name === "ValidationError" ? error.message : "Token operation failed; inspect the repair acceptance log before retrying an Apple update.",
      originalTransactionId: input.originalTransactionId,
      info: { operation: input.operation, actorType: actor.type, actorId: actor.id },
    });
    if (error instanceof Error && error.name === "ValidationError") throw error;
    throw new ValidationError("Token operation failed. Check IAP logs; if Apple already accepted a repair, repeating the same repair is safe.");
  }
}
