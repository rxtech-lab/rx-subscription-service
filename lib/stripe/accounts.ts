import type { AppUser, Plan, TopupProduct } from "@/lib/db/schema";

/**
 * Which Stripe account a call belongs to, and which stored ids go with it.
 *
 * Deliberately free of `server-only` and of any database or SDK import, so the
 * routing rules — the ones that decide whether a charge lands in the live
 * account or the sandbox — are unit-testable on their own.
 */
export type StripeMode = "live" | "sandbox";

export function secretKeyFor(mode: StripeMode): string | undefined {
  return (
    mode === "sandbox"
      ? process.env.STRIPE_SANDBOX_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY
  )?.trim();
}

export function webhookSecretFor(mode: StripeMode): string | undefined {
  return (
    mode === "sandbox"
      ? process.env.STRIPE_SANDBOX_WEBHOOK_SECRET
      : process.env.STRIPE_WEBHOOK_SECRET
  )?.trim();
}

export const stripeConfigured = (mode: StripeMode = "live") =>
  Boolean(secretKeyFor(mode));

export const sandboxConfigured = () => stripeConfigured("sandbox");

/** Test users always bill against the sandbox; everyone else against live. */
export const modeForUser = (user: Pick<AppUser, "isTest">): StripeMode =>
  user.isTest ? "sandbox" : "live";

export function stripeMode(mode: StripeMode = "live"): "test" | "live" | "unknown" {
  const key = secretKeyFor(mode) ?? "";
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  return "unknown";
}

/** Namespace sandbox idempotency keys so the two accounts never collide. */
export function idempotencyScope(mode: StripeMode): string {
  return mode === "sandbox" ? "sandbox:" : "";
}

type StripePointers = Pick<
  Plan | TopupProduct,
  "stripeProductId" | "stripePriceId" | "stripeSandboxProductId" | "stripeSandboxPriceId"
>;

/** The (product, price) pair mirrored into `mode`'s account, if any. */
export function stripePointers(row: StripePointers, mode: StripeMode) {
  return mode === "sandbox"
    ? { productId: row.stripeSandboxProductId, priceId: row.stripeSandboxPriceId }
    : { productId: row.stripeProductId, priceId: row.stripePriceId };
}

/** The column update that stores a freshly minted pair for `mode`. */
export function stripePointerColumns(
  mode: StripeMode,
  productId: string,
  priceId: string,
) {
  return mode === "sandbox"
    ? { stripeSandboxProductId: productId, stripeSandboxPriceId: priceId }
    : { stripeProductId: productId, stripePriceId: priceId };
}
