import {
  AutoRenewStatus,
  Environment,
  Status,
  Type,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import type {
  ApiEnvironment,
  StoreProductType,
  SubscriptionStatus,
} from "../../db/schema";

class AppleValidationError extends Error {
  override name = "ValidationError";
}

export const APPLE_TYPE_BY_PRODUCT_TYPE: Record<StoreProductType, Type> = {
  auto_renewable_subscription: Type.AUTO_RENEWABLE_SUBSCRIPTION,
  non_consumable: Type.NON_CONSUMABLE,
  consumable: Type.CONSUMABLE,
};

export function assertAppleEnvironment(
  actual: string | undefined,
  expected: ApiEnvironment,
) {
  const expectedApple =
    expected === "xcode"
      ? Environment.XCODE
      : expected === "sandbox"
        ? Environment.SANDBOX
        : Environment.PRODUCTION;
  if (actual !== expectedApple) {
    throw new AppleValidationError(
      `App Store environment mismatch: expected ${expectedApple}`,
    );
  }
}

export function assertAppleTransaction(input: {
  transaction: JWSTransactionDecodedPayload;
  bundleId: string;
  environment: ApiEnvironment;
  productId: string;
  productType: StoreProductType;
  accountToken: string;
}) {
  const transaction = input.transaction;
  if (!transaction.transactionId || !transaction.originalTransactionId) {
    throw new AppleValidationError("Apple transaction identifiers are missing");
  }
  if (!transaction.purchaseDate || !transaction.signedDate) {
    throw new AppleValidationError("Apple transaction dates are missing");
  }
  if (transaction.bundleId !== input.bundleId) {
    throw new AppleValidationError("Apple transaction bundle ID does not match");
  }
  assertAppleEnvironment(transaction.environment, input.environment);
  if (transaction.productId !== input.productId) {
    throw new AppleValidationError("Apple product ID does not match its mapping");
  }
  if (transaction.type !== APPLE_TYPE_BY_PRODUCT_TYPE[input.productType]) {
    throw new AppleValidationError("Apple product type does not match its mapping");
  }
  if (transaction.appAccountToken?.toLowerCase() !== input.accountToken.toLowerCase()) {
    throw new AppleValidationError("Apple account token does not belong to this user");
  }
  const quantity = transaction.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new AppleValidationError("Apple transaction quantity is invalid");
  }
}

export function mapAppleSubscriptionStatus(input: {
  status?: number;
  transaction: JWSTransactionDecodedPayload;
}): SubscriptionStatus {
  if (input.transaction.revocationDate || input.status === Status.REVOKED) {
    return "canceled";
  }
  if (input.status === Status.BILLING_RETRY) return "past_due";
  if (input.status === Status.EXPIRED) return "expired";
  if (input.status === Status.BILLING_GRACE_PERIOD) return "active";
  if (
    input.transaction.offerType === 1 &&
    (input.transaction.price ?? 0) === 0 &&
    (!input.transaction.expiresDate || input.transaction.expiresDate > Date.now())
  ) {
    return "trialing";
  }
  if (
    input.status === Status.ACTIVE ||
    !input.transaction.expiresDate ||
    input.transaction.expiresDate > Date.now()
  ) {
    return "active";
  }
  return "expired";
}

export function appleCancelAtPeriodEnd(
  renewal: JWSRenewalInfoDecodedPayload | null,
): boolean {
  return renewal?.autoRenewStatus === AutoRenewStatus.OFF;
}
