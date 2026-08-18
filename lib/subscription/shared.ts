import "server-only";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export function newId(): string {
  return crypto.randomUUID();
}

/** Keys are used in URLs, API payloads, and permission expressions. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export function assertKey(value: string, field = "key"): string {
  const key = value.trim().toLowerCase();
  if (!KEY_PATTERN.test(key)) {
    throw new ValidationError(
      `${field} must be lowercase alphanumeric with - or _, 1-64 characters`,
    );
  }
  return key;
}

export function assertNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

export function assertPositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return value;
}

export function assertCurrency(value: string): string {
  const currency = value.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new ValidationError("currency must be a 3-letter ISO code");
  }
  return currency;
}

export interface Actor {
  type: "user" | "ai" | "system";
  id: string | null;
  conversationId?: string | null;
}

/**
 * Record a configuration change. Both the console and the assistant write here,
 * so an AI-applied edit is traceable back to the conversation that produced it.
 */
export async function recordAudit(input: {
  applicationId: string | null;
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(auditLogs).values({
    id: newId(),
    applicationId: input.applicationId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    conversationId: input.actor.conversationId ?? null,
    createdAt: new Date(),
  });
}
