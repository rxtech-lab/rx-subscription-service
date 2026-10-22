import { z } from "zod";

export const SCOPE_LABELS = {
  "projects:read": "List approved projects",
  "subscriptions:read":
    "Read subscription configuration, users, logs and analytics",
  "subscriptions:write":
    "Change subscriptions, balances, configuration and tests",
  "paywalls:read": "Read shared paywall templates",
  "paywalls:write": "Create and update shared paywall templates",
} as const;
export const scopeSchema = z.enum(
  Object.keys(SCOPE_LABELS) as [
    keyof typeof SCOPE_LABELS,
    ...(keyof typeof SCOPE_LABELS)[],
  ],
);
export const scopesSchema = z
  .array(scopeSchema)
  .min(1)
  .max(5)
  .transform((v) => [...new Set(v)]);
export const DEFAULT_SCOPES = ["projects:read", "subscriptions:read"];
export function parseScopes(value: string | null) {
  return scopesSchema.parse(
    value == null ? DEFAULT_SCOPES : value.split(/\s+/).filter(Boolean),
  );
}
