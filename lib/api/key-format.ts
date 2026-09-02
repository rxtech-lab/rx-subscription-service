// Imported by relative path rather than the `@/` alias: this module is
// deliberately free of database imports so it stays unit-testable, and the
// alias is not resolved under vitest.
import {
  API_ENVIRONMENTS,
  API_KEY_KINDS,
  type ApiEnvironment,
  type ApiKeyKind,
} from "../db/schema/applications";

const PREFIX = "rxs_";
/** Publishable keys are visibly different so a leaked one is recognisable. */
const PUBLISHABLE_INFIX = "pk_";

export function isApiEnvironment(value: string): value is ApiEnvironment {
  return API_ENVIRONMENTS.some((environment) => environment === value);
}

export function isApiKeyKind(value: string): value is ApiKeyKind {
  return API_KEY_KINDS.some((kind) => kind === value);
}

export function apiKeySecretPrefix(
  environment: ApiEnvironment,
  kind: ApiKeyKind = "secret",
) {
  const infix = kind === "publishable" ? PUBLISHABLE_INFIX : "";
  return `${PREFIX}${infix}${environment}_`;
}

/** Whether a presented credential is shaped like one of ours at all. */
export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Parse the stored JSON array back into client ids, tolerating the null and
 * malformed cases rather than throwing mid-request: a key whose allow-list
 * cannot be read grants nothing, which is the safe direction to fail.
 */
export function parseAllowedClientIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  } catch {
    return [];
  }
}
