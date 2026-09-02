import type { ApiKeyKind } from "@/lib/db/schema";
import { ApiError } from "./errors";

/**
 * What a publishable key may do.
 *
 * A publishable key ships inside a client binary, so the list is deliberately
 * short: read the signed-in user's own state, and start or fulfil a purchase
 * for them. Everything that moves value — crediting a balance, recording
 * usage, reserving or settling a hold — stays behind a secret key held by a
 * backend, because a client that could call those endpoints could grant itself
 * anything.
 *
 * `POST /iap/apple/transactions` is on the list even though it grants
 * entitlements: the App Store signs the transaction and the server verifies
 * that signature, so a forged call cannot manufacture a purchase.
 */
export const PUBLISHABLE_KEY_OPERATIONS = [
  "catalog.read",
  "paywall.read",
  "entitlements.read",
  "usage.read",
  "usage.statistics.read",
  "balances.read",
  "balances.ledger.read",
  "balances.consumption.read",
  "invoices.read",
  "purchases.read",
  "coupons.validate",
  "checkout.create",
  "apple.account-token",
  "apple.consumption-consent",
  "apple.transactions.submit",
] as const;

export type PublishableOperation = (typeof PUBLISHABLE_KEY_OPERATIONS)[number];

export function isPublishableOperation(value: string): value is PublishableOperation {
  return (PUBLISHABLE_KEY_OPERATIONS as readonly string[]).includes(value);
}

/**
 * Whether a key of this kind may perform an operation. Secret keys may do
 * anything; publishable keys are held to the list above.
 */
export function keyKindAllows(kind: ApiKeyKind, operation: string): boolean {
  if (kind === "secret") return true;
  return isPublishableOperation(operation);
}

/**
 * Guard an operation. Routes that no publishable key may reach pass their own
 * name and get a 403 rather than leaking behaviour through a later error.
 */
export function assertKeyKindAllows(kind: ApiKeyKind, operation: string): void {
  if (keyKindAllows(kind, operation)) return;
  throw new ApiError(
    403,
    "insufficient_key_scope",
    `A publishable key cannot perform "${operation}". Use a secret key from your backend.`,
    { operation },
  );
}
