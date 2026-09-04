import "server-only";
import {
  Status,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  ledgerEntries,
  plans,
  purchases,
  storeTransactions,
  subscriptions,
  type ApiEnvironment,
  type AppleStoreIntegration,
  type AppUser,
  type StoreProductMapping,
} from "@/lib/db/schema";
import {
  getStoreProductMapping,
  findAppleAccountByToken,
} from "@/lib/iap/configuration";
import {
  newId,
  ValidationError,
} from "@/lib/subscription/shared";
import {
  assertPlanGroupAvailable,
  buildEntitlementSnapshot,
  grantPeriodBalances,
  replaceInternalDefaultForPlan,
} from "@/lib/subscription/subscriptions";
import {
  checkTopupEligibility,
  requireTopupProduct,
} from "@/lib/subscription/topups";
import {
  creditBalance,
  debitBalanceAllowingNegative,
} from "@/lib/subscription/users";
import {
  appleApiClient,
  verifyAppleRenewalInfo,
  verifyAppleTransaction,
} from "./client";
import {
  appleCancelAtPeriodEnd,
  assertAppleEnvironment,
  assertAppleTransaction,
  mapAppleSubscriptionStatus,
} from "./validation";

export interface AppleFulfillmentResult {
  processed: "new" | "already_complete";
  transaction: {
    transactionId: string;
    originalTransactionId: string;
    productId: string;
    productType: string;
    environment: ApiEnvironment;
    quantity: number;
    priceMilliunits: number | null;
    currency: string | null;
    purchaseAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
  };
  purchase: typeof purchases.$inferSelect | null;
  subscription: typeof subscriptions.$inferSelect | null;
}

function date(value: number | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

async function authoritativeState(input: {
  integration: AppleStoreIntegration;
  environment: ApiEnvironment;
  signedTransaction: string;
  fetchAuthoritative: boolean;
}) {
  let signedTransaction = input.signedTransaction;
  let transaction = await verifyAppleTransaction(
    input.integration,
    input.environment,
    signedTransaction,
  );
  let status: number | undefined;
  let renewal: JWSRenewalInfoDecodedPayload | null = null;

  if (
    input.fetchAuthoritative &&
    input.environment !== "xcode" &&
    process.env.IS_E2E !== "true"
  ) {
    if (!transaction.transactionId) {
      throw new ValidationError("Apple transaction ID is missing");
    }
    const client = appleApiClient(input.integration, input.environment);
    const info = await client.getTransactionInfo(transaction.transactionId);
    if (!info.signedTransactionInfo) {
      throw new ValidationError("Apple transaction lookup returned no signed data");
    }
    signedTransaction = info.signedTransactionInfo;
    transaction = await verifyAppleTransaction(
      input.integration,
      input.environment,
      signedTransaction,
    );
    if (transaction.type === "Auto-Renewable Subscription") {
      const subscriptionLookupId =
        transaction.originalTransactionId ?? transaction.transactionId;
      if (!subscriptionLookupId) {
        throw new ValidationError("Apple subscription identifier is missing");
      }
      const response = await client.getAllSubscriptionStatuses(
        subscriptionLookupId,
      );
      assertAppleEnvironment(response.environment, input.environment);
      if (response.bundleId !== input.integration.bundleId) {
        throw new ValidationError("Apple status bundle ID does not match");
      }
      if (
        input.environment === "production" &&
        response.appAppleId !== input.integration.appAppleId
      ) {
        throw new ValidationError("Apple status app ID does not match");
      }
      const latest = response.data
        ?.flatMap((group) => group.lastTransactions ?? [])
        .find(
          (item) => item.originalTransactionId === transaction.originalTransactionId,
        );
      status = latest?.status;
      if (latest?.signedTransactionInfo) {
        signedTransaction = latest.signedTransactionInfo;
        transaction = await verifyAppleTransaction(
          input.integration,
          input.environment,
          signedTransaction,
        );
      }
      if (latest?.signedRenewalInfo) {
        renewal = await verifyAppleRenewalInfo(
          input.integration,
          input.environment,
          latest.signedRenewalInfo,
        );
      }
    }
  }
  return { signedTransaction, transaction, status, renewal };
}

async function reverseTransactionGrants(input: {
  storeTransactionId: string;
  transactionId: string;
  previousPercentage: number;
  targetPercentage: number;
}) {
  const deltaPercentage = input.targetPercentage - input.previousPercentage;
  if (deltaPercentage === 0) return;
  const grants = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.referenceType, "store_transaction"),
        eq(ledgerEntries.referenceId, input.storeTransactionId),
      ),
    );
  for (const grant of grants.filter((entry) => entry.delta > 0)) {
    const amount = Math.floor(
      (grant.delta * Math.abs(deltaPercentage)) / 100_000,
    );
    if (amount <= 0) continue;
    const mutation = {
      appUserId: grant.appUserId,
      unitId: grant.unitId,
      amount,
      kind: (deltaPercentage > 0 ? "refund" : "dispute_reversal") as
        | "refund"
        | "dispute_reversal",
      description:
        deltaPercentage > 0
          ? "App Store refund"
          : "App Store refund reversal",
      idempotencyKey: `apple:refund:${input.transactionId}:${input.previousPercentage}:${input.targetPercentage}:${grant.id}`,
      referenceType: "store_transaction",
      referenceId: input.storeTransactionId,
    };
    if (deltaPercentage > 0) await debitBalanceAllowingNegative(mutation);
    else await creditBalance(mutation);
  }
}

async function fulfillSubscription(input: {
  integration: AppleStoreIntegration;
  user: AppUser;
  mapping: StoreProductMapping;
  transaction: JWSTransactionDecodedPayload;
  status?: number;
  renewal: JWSRenewalInfoDecodedPayload | null;
  storeTransactionId: string;
  stateSignedAt?: Date;
}) {
  if (!input.mapping.planId) throw new ValidationError("Plan mapping is incomplete");
  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.id, input.mapping.planId))
    .limit(1);
  if (!plan || plan.billingInterval === "one_time") {
    throw new ValidationError("Apple subscription is not mapped to a recurring plan");
  }
  const originalTransactionId = input.transaction.originalTransactionId!;
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.billingProvider, "apple_app_store"),
        eq(subscriptions.appUserId, input.user.id),
        eq(subscriptions.providerSubscriptionId, originalTransactionId),
      ),
    )
    .limit(1);
  const status = mapAppleSubscriptionStatus({
    status: input.status,
    transaction: input.transaction,
  });
  const signedAt =
    input.stateSignedAt ??
    (input.renewal?.signedDate
      ? new Date(input.renewal.signedDate)
      : new Date(input.transaction.signedDate!));
  if (existing?.providerSignedAt && existing.providerSignedAt > signedAt) return existing;

  if (["trialing", "active", "past_due"].includes(status)) {
    await assertPlanGroupAvailable({
      applicationId: input.integration.applicationId,
      appUserId: input.user.id,
      plan,
      excludeSubscriptionId: existing?.id,
    });
  }
  const now = new Date();
  const snapshot =
    !existing || existing.planId !== plan.id
      ? await buildEntitlementSnapshot(plan.id)
      : existing.entitlementSnapshot;
  const values = {
    planId: plan.id,
    status,
    currentPeriodStart: date(input.transaction.purchaseDate),
    currentPeriodEnd:
      input.status === Status.BILLING_GRACE_PERIOD &&
      input.renewal?.gracePeriodExpiresDate
        ? date(input.renewal.gracePeriodExpiresDate)
        : date(input.transaction.expiresDate),
    cancelAtPeriodEnd: appleCancelAtPeriodEnd(input.renewal),
    providerProductId: input.transaction.productId!,
    providerSignedAt: signedAt,
    entitlementSnapshot: snapshot,
    endedAt:
      status === "canceled" || status === "expired"
        ? existing?.endedAt ?? now
        : null,
    updatedAt: now,
  };
  const [saved] = existing
    ? await db
        .update(subscriptions)
        .set(values)
        .where(eq(subscriptions.id, existing.id))
        .returning()
    : await db
        .insert(subscriptions)
        .values({
          id: newId(),
          applicationId: input.integration.applicationId,
          appUserId: input.user.id,
          billingProvider: "apple_app_store",
          providerSubscriptionId: originalTransactionId,
          startedAt: date(input.transaction.originalPurchaseDate) ?? now,
          createdAt: now,
          ...values,
        })
        .returning();

  if (["trialing", "active", "past_due"].includes(status)) {
    await replaceInternalDefaultForPlan({
      applicationId: input.integration.applicationId,
      appUserId: input.user.id,
      planId: plan.id,
    });
  }

  if (status === "active" || status === "trialing") {
    await grantPeriodBalances({
      applicationId: input.integration.applicationId,
      appUserId: input.user.id,
      planId: plan.id,
      periodKey: input.transaction.transactionId!,
      periodEnd: date(input.transaction.expiresDate),
      subscriptionId: saved.id,
      status,
      entitlements: (snapshot?.entitlements ?? []) as never[],
      idempotencyPrefix: "apple_plan_grant",
      referenceType: "store_transaction",
      referenceId: input.storeTransactionId,
    });
  }
  return saved;
}

async function fulfillOneTime(input: {
  integration: AppleStoreIntegration;
  user: AppUser;
  mapping: StoreProductMapping;
  transaction: JWSTransactionDecodedPayload;
  storeTransactionId: string;
}) {
  const [existing] = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.billingProvider, "apple_app_store"),
        eq(purchases.appUserId, input.user.id),
        eq(purchases.providerTransactionId, input.transaction.transactionId!),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const quantity = input.transaction.quantity ?? 1;
  const now = new Date();
  let unitsGranted = 0;
  let unitId: string | null = null;
  const amountCents = Math.max(0, Math.round((input.transaction.price ?? 0) / 10));
  const currency = input.transaction.currency?.toLowerCase() ?? "usd";
  let kind: "plan_one_time" | "topup";
  let failure: string | null = null;
  let snapshot: Record<string, unknown> | null = null;

  if (input.mapping.topupProductId) {
    kind = "topup";
    const topup = await requireTopupProduct(
      input.integration.applicationId,
      input.mapping.topupProductId,
    );
    unitId = topup.unitId;
    unitsGranted = topup.amount * quantity;
    const eligibility = await checkTopupEligibility({
      applicationId: input.integration.applicationId,
      topupId: topup.id,
      appUserId: input.user.id,
    });
    if (!eligibility.eligible) {
      failure = eligibility.failed.some(
        (blocker) => blocker.ruleType === "purchase_limit",
      )
        ? "topup_purchase_limit"
        : "topup_not_eligible";
    }
  } else if (input.mapping.planId) {
    kind = "plan_one_time";
    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, input.mapping.planId))
      .limit(1);
    if (!plan || plan.billingInterval !== "one_time") {
      throw new ValidationError("Apple non-consumable is not mapped to a one-time plan");
    }
    try {
      await assertPlanGroupAvailable({
        applicationId: input.integration.applicationId,
        appUserId: input.user.id,
        plan,
      });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      failure = "plan_group_unavailable";
    }
    snapshot = await buildEntitlementSnapshot(plan.id);
  } else {
    throw new ValidationError("Apple product mapping has no target");
  }

  const values = {
    status: failure ? ("failed" as const) : ("paid" as const),
    unitId,
    unitsGranted: failure ? 0 : unitsGranted,
    amountCents,
    currency,
    quantity,
    priceMilliunits: input.transaction.price ?? null,
    entitlementSnapshot: snapshot,
    fulfillmentFailureCode: failure,
    paidAt: date(input.transaction.purchaseDate),
    updatedAt: now,
  };
  const [saved] = await db
    .insert(purchases)
    .values({
      id: newId(),
      applicationId: input.integration.applicationId,
      appUserId: input.user.id,
      kind,
      planId: input.mapping.planId,
      topupProductId: input.mapping.topupProductId,
      billingProvider: "apple_app_store",
      providerTransactionId: input.transaction.transactionId!,
      providerOriginalTransactionId: input.transaction.originalTransactionId!,
      providerProductId: input.transaction.productId!,
      refundedAmountCents: 0,
      reversedUnits: 0,
      createdAt: now,
      ...values,
    })
    .returning();

  if (!failure && !existing) {
    if (kind === "topup" && unitId && unitsGranted > 0) {
      await creditBalance({
        appUserId: input.user.id,
        unitId,
        amount: unitsGranted,
        kind: "topup",
        description: "App Store top-up",
        idempotencyKey: `apple:topup:${input.transaction.transactionId}`,
        referenceType: "store_transaction",
        referenceId: input.storeTransactionId,
      });
    } else if (input.mapping.planId) {
      await replaceInternalDefaultForPlan({
        applicationId: input.integration.applicationId,
        appUserId: input.user.id,
        planId: input.mapping.planId,
      });
      await grantPeriodBalances({
        applicationId: input.integration.applicationId,
        appUserId: input.user.id,
        planId: input.mapping.planId,
        periodKey: input.transaction.transactionId!,
        entitlements: (snapshot?.entitlements ?? []) as never[],
        idempotencyPrefix: "apple_one_time_grant",
        referenceType: "store_transaction",
        referenceId: input.storeTransactionId,
      });
    }
  }
  return saved;
}

export async function fulfillAppleTransaction(input: {
  integration: AppleStoreIntegration;
  environment: ApiEnvironment;
  signedTransaction: string;
  expectedUser?: AppUser;
  status?: number;
  signedRenewalInfo?: string | null;
  fetchAuthoritative?: boolean;
  refundReversed?: boolean;
  stateSignedAt?: Date;
}): Promise<AppleFulfillmentResult> {
  const authoritative = await authoritativeState({
    integration: input.integration,
    environment: input.environment,
    signedTransaction: input.signedTransaction,
    fetchAuthoritative: input.fetchAuthoritative ?? false,
  });
  const transaction = authoritative.transaction;
  const token = transaction.appAccountToken;
  if (!token) throw new ValidationError("Apple transaction has no appAccountToken");
  const account = await findAppleAccountByToken(token);
  if (!account || account.applicationId !== input.integration.applicationId) {
    throw new ValidationError("Apple account token is unknown");
  }
  if (input.expectedUser && account.appUserId !== input.expectedUser.id) {
    throw new ValidationError("Apple account token belongs to another user");
  }
  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.id, account.appUserId))
    .limit(1);
  if (!user) throw new ValidationError("Apple account user no longer exists");
  const mapping = await getStoreProductMapping({
    applicationId: input.integration.applicationId,
    provider: "apple_app_store",
    productId: transaction.productId ?? "",
  });
  if (!mapping) throw new ValidationError("Apple product ID is not mapped");
  assertAppleTransaction({
    transaction,
    bundleId: input.integration.bundleId,
    environment: input.environment,
    productId: mapping.productId,
    productType: mapping.productType,
    accountToken: account.providerAccountToken,
  });
  const effectiveTransaction = input.refundReversed
    ? {
        ...transaction,
        revocationDate: undefined,
        revocationPercentage: undefined,
      }
    : transaction;
  let renewal = authoritative.renewal;
  if (input.signedRenewalInfo) {
    renewal = await verifyAppleRenewalInfo(
      input.integration,
      input.environment,
      input.signedRenewalInfo,
    );
  }
  if (renewal?.environment) assertAppleEnvironment(renewal.environment, input.environment);

  const [existingTransaction] = await db
    .select()
    .from(storeTransactions)
    .where(
      and(
        eq(storeTransactions.provider, "apple_app_store"),
        eq(storeTransactions.appUserId, user.id),
        eq(storeTransactions.transactionId, transaction.transactionId!),
      ),
    )
    .limit(1);
  const signedAt = new Date(transaction.signedDate!);
  const targetRevocationPercentage = input.refundReversed
    ? 0
    : transaction.revocationDate
      ? Math.max(0, Math.min(100_000, transaction.revocationPercentage ?? 100_000))
      : 0;
  const now = new Date();
  const values = {
    productId: transaction.productId!,
    productType: mapping.productType,
    quantity: transaction.quantity ?? 1,
    priceMilliunits: transaction.price ?? null,
    currency: transaction.currency?.toLowerCase() ?? null,
    purchaseAt: new Date(transaction.purchaseDate!),
    expiresAt: date(transaction.expiresDate),
    revokedAt: targetRevocationPercentage > 0 ? date(transaction.revocationDate) ?? now : null,
    revocationPercentage: targetRevocationPercentage,
    signedAt,
    signedTransaction: authoritative.signedTransaction,
    updatedAt: now,
  };
  const stale =
    existingTransaction?.signedAt && existingTransaction.signedAt > signedAt;
  if (stale) {
    return {
      processed: "already_complete",
      transaction: {
        transactionId: existingTransaction.transactionId,
        originalTransactionId: existingTransaction.originalTransactionId,
        productId: existingTransaction.productId,
        productType: existingTransaction.productType,
        environment: existingTransaction.environment,
        quantity: existingTransaction.quantity,
        priceMilliunits: existingTransaction.priceMilliunits,
        currency: existingTransaction.currency,
        purchaseAt: existingTransaction.purchaseAt,
        expiresAt: existingTransaction.expiresAt,
        revokedAt: existingTransaction.revokedAt,
      },
      purchase: null,
      subscription: null,
    };
  }
  const [storeTransaction] = existingTransaction
    ? await db
        .update(storeTransactions)
        .set(values)
        .where(eq(storeTransactions.id, existingTransaction.id))
        .returning()
    : await db
        .insert(storeTransactions)
        .values({
          id: newId(),
          applicationId: input.integration.applicationId,
          appUserId: user.id,
          provider: "apple_app_store",
          environment: input.environment,
          transactionId: transaction.transactionId!,
          originalTransactionId: transaction.originalTransactionId!,
          createdAt: now,
          ...values,
        })
        .returning();

  let purchase: typeof purchases.$inferSelect | null = null;
  let subscription: typeof subscriptions.$inferSelect | null = null;
  if (mapping.productType === "auto_renewable_subscription") {
    subscription = await fulfillSubscription({
      integration: input.integration,
      user,
      mapping,
      transaction: effectiveTransaction,
      status: input.status ?? authoritative.status,
      renewal,
      storeTransactionId: storeTransaction.id,
      stateSignedAt: input.stateSignedAt,
    });
  } else {
    purchase = await fulfillOneTime({
      integration: input.integration,
      user,
      mapping,
      transaction: effectiveTransaction,
      storeTransactionId: storeTransaction.id,
    });
  }

  await reverseTransactionGrants({
    storeTransactionId: storeTransaction.id,
    transactionId: transaction.transactionId!,
    previousPercentage: existingTransaction?.revocationPercentage ?? 0,
    targetPercentage: targetRevocationPercentage,
  });
  if (purchase && purchase.status !== "failed") {
    const refunded = targetRevocationPercentage > 0;
    [purchase] = await db
      .update(purchases)
      .set({
        status: refunded ? "refunded" : "paid",
        refundedAmountCents: refunded
          ? Math.round((purchase.amountCents * targetRevocationPercentage) / 100_000)
          : 0,
        reversedUnits: refunded
          ? Math.round((purchase.unitsGranted * targetRevocationPercentage) / 100_000)
          : 0,
        updatedAt: now,
      })
      .where(eq(purchases.id, purchase.id))
      .returning();
  }
  await db
    .update(storeTransactions)
    .set({ subscriptionId: subscription?.id, purchaseId: purchase?.id, updatedAt: now })
    .where(eq(storeTransactions.id, storeTransaction.id));

  return {
    processed: existingTransaction ? "already_complete" : "new",
    transaction: {
      transactionId: transaction.transactionId!,
      originalTransactionId: transaction.originalTransactionId!,
      productId: transaction.productId!,
      productType: mapping.productType,
      environment: input.environment,
      quantity: transaction.quantity ?? 1,
      priceMilliunits: transaction.price ?? null,
      currency: transaction.currency?.toLowerCase() ?? null,
      purchaseAt: new Date(transaction.purchaseDate!),
      expiresAt: date(transaction.expiresDate),
      revokedAt: targetRevocationPercentage > 0 ? date(transaction.revocationDate) ?? now : null,
    },
    purchase,
    subscription,
  };
}
