import "server-only";
import { and, desc, eq, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  applicationApiKeys,
  type ApiEnvironment,
  type ApiKeyKind,
} from "@/lib/db/schema";
import { newId, NotFoundError, recordAudit, ValidationError, type Actor } from "@/lib/subscription/shared";
import {
  apiKeySecretPrefix,
  isApiEnvironment,
  isApiKeyKind,
  looksLikeApiKey,
  parseAllowedClientIds,
} from "./key-format";

export {
  apiKeySecretPrefix,
  isApiEnvironment,
  isApiKeyKind,
  parseAllowedClientIds,
} from "./key-format";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashApiKey(value: string): Promise<string> {
  return sha256(value);
}

export const API_KEYS_PAGE_SIZE = 10;

/**
 * Active keys only, newest first. Revoked keys — the ephemeral ones a test run
 * mints and throws away — are never listed, so the console shows nothing but
 * credentials that still work.
 */
export async function listApiKeys(
  applicationId: string,
  options: { page?: number; query?: string } = {},
) {
  const requestedPage = Math.max(1, options.page ?? 1);
  const needle = options.query?.trim() ?? "";

  const filters: SQL[] = [
    eq(applicationApiKeys.applicationId, applicationId),
    isNull(applicationApiKeys.revokedAt),
  ];
  if (needle) {
    // SQLite's LIKE is case-insensitive for ASCII, and `_`/`%` in a search box
    // are meant literally rather than as wildcards.
    const pattern = `%${needle.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const matches = or(
      like(applicationApiKeys.name, sql`${pattern} ESCAPE '\\'`),
      like(applicationApiKeys.keyPrefix, sql`${pattern} ESCAPE '\\'`),
      like(applicationApiKeys.environment, sql`${pattern} ESCAPE '\\'`),
    );
    if (matches) filters.push(matches);
  }
  const where = and(...filters);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(applicationApiKeys)
    .where(where);

  // Deleting the last key on the last page would otherwise leave the reader on
  // an out-of-range page staring at an empty table.
  const totalPages = Math.max(1, Math.ceil(count / API_KEYS_PAGE_SIZE));
  const safePage = Math.min(requestedPage, totalPages);

  const keys = await db
    .select({
      id: applicationApiKeys.id,
      name: applicationApiKeys.name,
      environment: applicationApiKeys.environment,
      kind: applicationApiKeys.kind,
      allowedClientIds: applicationApiKeys.allowedClientIds,
      keyPrefix: applicationApiKeys.keyPrefix,
      lastUsedAt: applicationApiKeys.lastUsedAt,
      createdAt: applicationApiKeys.createdAt,
    })
    .from(applicationApiKeys)
    .where(where)
    .orderBy(desc(applicationApiKeys.createdAt))
    .limit(API_KEYS_PAGE_SIZE)
    .offset((safePage - 1) * API_KEYS_PAGE_SIZE);

  return {
    keys,
    pagination: {
      page: safePage,
      pageSize: API_KEYS_PAGE_SIZE,
      totalCount: count,
      totalPages,
    },
  };
}

/**
 * Mint an API key. The plaintext is returned exactly once — only its SHA-256
 * hash is stored, so a leaked database cannot be replayed against the API.
 *
 * A publishable key must name the OAuth clients whose user tokens it accepts.
 * Minting one without that list would produce a credential that any signed-in
 * rxlab user could point at this application, so it is rejected rather than
 * defaulted to "all".
 */
export async function createApiKey(input: {
  applicationId: string;
  name: string;
  environment: ApiEnvironment;
  kind?: ApiKeyKind;
  allowedClientIds?: string[];
  actor: Actor;
}) {
  if (!input.name.trim()) throw new ValidationError("name is required");
  if (!isApiEnvironment(input.environment)) {
    throw new ValidationError("environment must be sandbox or production");
  }
  const kind = input.kind ?? "secret";
  if (!isApiKeyKind(kind)) {
    throw new ValidationError("kind must be secret or publishable");
  }

  const clientIds = Array.from(
    new Set((input.allowedClientIds ?? []).map((value) => value.trim()).filter(Boolean)),
  );
  if (kind === "publishable" && clientIds.length === 0) {
    throw new ValidationError(
      "a publishable key must list at least one allowed OAuth client id",
    );
  }
  if (kind === "secret" && clientIds.length > 0) {
    throw new ValidationError("allowedClientIds only applies to publishable keys");
  }

  const secretPrefix = apiKeySecretPrefix(input.environment, kind);
  const secret = `${secretPrefix}${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const hashedKey = await hashApiKey(secret);
  const keyPrefix = secret.slice(0, secretPrefix.length + 8);

  const [row] = await db
    .insert(applicationApiKeys)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      name: input.name.trim(),
      environment: input.environment,
      kind,
      allowedClientIds: kind === "publishable" ? JSON.stringify(clientIds) : null,
      keyPrefix,
      hashedKey,
      createdAt: new Date(),
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "api_key.create",
    entityType: "application_api_key",
    entityId: row.id,
    after: {
      id: row.id,
      name: row.name,
      environment: row.environment,
      kind: row.kind,
      allowedClientIds: clientIds,
      keyPrefix,
    },
  });

  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    kind: row.kind,
    allowedClientIds: clientIds,
    keyPrefix,
    secret,
  };
}

/**
 * Remove a key outright. Console-facing deletes drop the row rather than
 * flagging it, so the list only ever holds keys that still work; the audit log
 * keeps the record of what was removed.
 */
export async function deleteApiKey(input: {
  applicationId: string;
  keyId: string;
  actor: Actor;
}) {
  const [before] = await db
    .select()
    .from(applicationApiKeys)
    .where(
      and(
        eq(applicationApiKeys.id, input.keyId),
        eq(applicationApiKeys.applicationId, input.applicationId),
      ),
    )
    .limit(1);
  if (!before) throw new NotFoundError("api key", input.keyId);

  await db
    .delete(applicationApiKeys)
    .where(eq(applicationApiKeys.id, input.keyId));

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "api_key.delete",
    entityType: "application_api_key",
    entityId: input.keyId,
    before: {
      id: before.id,
      name: before.name,
      environment: before.environment,
      keyPrefix: before.keyPrefix,
    },
  });
}

/** Soft-revoke, used for the ephemeral keys a test run mints for itself. */
export async function revokeApiKey(input: {
  applicationId: string;
  keyId: string;
  actor: Actor;
}) {
  const [before] = await db
    .select()
    .from(applicationApiKeys)
    .where(
      and(
        eq(applicationApiKeys.id, input.keyId),
        eq(applicationApiKeys.applicationId, input.applicationId),
      ),
    )
    .limit(1);
  if (!before) throw new NotFoundError("api key", input.keyId);

  await db
    .update(applicationApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(applicationApiKeys.id, input.keyId));

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "api_key.revoke",
    entityType: "application_api_key",
    entityId: input.keyId,
    before: { id: before.id, name: before.name },
  });
}

/** Resolve a presented key to its application, or null when it is invalid. */
export async function resolveApiKey(secret: string) {
  const trimmed = secret.trim();
  if (!looksLikeApiKey(trimmed)) return null;

  const hashedKey = await hashApiKey(trimmed);
  const [row] = await db
    .select()
    .from(applicationApiKeys)
    .where(
      and(
        eq(applicationApiKeys.hashedKey, hashedKey),
        isNull(applicationApiKeys.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Best-effort usage stamp; never block a request on it.
  void db
    .update(applicationApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(applicationApiKeys.id, row.id))
    .catch(() => {});

  return {
    applicationId: row.applicationId,
    keyId: row.id,
    environment: row.environment,
    kind: row.kind,
    allowedClientIds: parseAllowedClientIds(row.allowedClientIds),
  };
}
