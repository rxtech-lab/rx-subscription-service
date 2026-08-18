import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { applicationApiKeys } from "@/lib/db/schema";
import { newId, NotFoundError, recordAudit, ValidationError, type Actor } from "@/lib/subscription/shared";

const PREFIX = "rxs_";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashApiKey(value: string): Promise<string> {
  return sha256(value);
}

export async function listApiKeys(applicationId: string) {
  return db
    .select({
      id: applicationApiKeys.id,
      name: applicationApiKeys.name,
      keyPrefix: applicationApiKeys.keyPrefix,
      lastUsedAt: applicationApiKeys.lastUsedAt,
      revokedAt: applicationApiKeys.revokedAt,
      createdAt: applicationApiKeys.createdAt,
    })
    .from(applicationApiKeys)
    .where(eq(applicationApiKeys.applicationId, applicationId))
    .orderBy(asc(applicationApiKeys.createdAt));
}

/**
 * Mint an API key. The plaintext is returned exactly once — only its SHA-256
 * hash is stored, so a leaked database cannot be replayed against the API.
 */
export async function createApiKey(input: {
  applicationId: string;
  name: string;
  actor: Actor;
}) {
  if (!input.name.trim()) throw new ValidationError("name is required");

  const secret = `${PREFIX}${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const hashedKey = await hashApiKey(secret);
  const keyPrefix = secret.slice(0, PREFIX.length + 8);

  const [row] = await db
    .insert(applicationApiKeys)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      name: input.name.trim(),
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
    after: { id: row.id, name: row.name, keyPrefix },
  });

  return { id: row.id, name: row.name, keyPrefix, secret };
}

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
  if (!trimmed.startsWith(PREFIX)) return null;

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

  return { applicationId: row.applicationId, keyId: row.id };
}
