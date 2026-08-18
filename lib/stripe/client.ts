import "server-only";
import Stripe from "stripe";
import { secretKeyFor, type StripeMode } from "./accounts";

export {
  modeForUser,
  sandboxConfigured,
  stripeConfigured,
  stripeMode,
  webhookSecretFor,
  type StripeMode,
} from "./accounts";

const clients: Partial<Record<StripeMode, Stripe>> = {};

function e2eStripeConfig(): Stripe.StripeConfig {
  if (process.env.IS_E2E !== "true") return {};
  const value = process.env.E2E_STRIPE_API_BASE?.trim();
  if (!value) return {};
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("E2E_STRIPE_API_BASE_INVALID");
  }
  return {
    host: url.hostname,
    port: url.port || undefined,
    protocol: url.protocol === "http:" ? "http" : "https",
  };
}

/**
 * The SDK client for one Stripe account.
 *
 * Two accounts are kept side by side: `live` for real subscribers and `sandbox`
 * for test users. Each is constructed once per process, so changing a key
 * requires a restart.
 */
export function stripe(mode: StripeMode = "live"): Stripe {
  const key = secretKeyFor(mode);
  if (!key) {
    throw new Error(
      mode === "sandbox" ? "STRIPE_SANDBOX_NOT_CONFIGURED" : "STRIPE_NOT_CONFIGURED",
    );
  }
  clients[mode] ??= new Stripe(key, {
    ...e2eStripeConfig(),
    appInfo: { name: "rx-subscription" },
  });
  return clients[mode];
}

export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) throw new Error("NEXT_PUBLIC_SITE_URL_NOT_CONFIGURED");
  const url = new URL(configured);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SITE_URL_MUST_BE_HTTPS");
  }
  return url.origin;
}

export const automaticTax = () => process.env.STRIPE_AUTOMATIC_TAX === "true";

/** Stripe returns ids as either a string or an expanded object. */
export function referenceId(
  value: string | { id: string } | null | undefined,
): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}
