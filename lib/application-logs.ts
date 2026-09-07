import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export const logCategories = {
  iap: { label: "Apple IAP", prefixes: ["apple_iap", "apple_store", "store_product"] },
  subscription: { label: "Subscriptions", prefixes: ["subscription"] },
  usage: { label: "Usage and balances", prefixes: ["usage", "usage_item", "balance", "balance_unit", "point_rate"] },
  configuration: { label: "Plans and configuration", prefixes: ["plan", "topup", "coupon", "paywall", "application"] },
  access: { label: "Users and access", prefixes: ["user", "role", "permission", "api_key"] },
  testing: { label: "Testing", prefixes: ["test_user", "test_suite"] },
} as const;

export const applicationLogFilters = z.object({
  category: z.enum(["iap", "subscription", "usage", "configuration", "access", "testing"]).optional(),
  environment: z.enum(["xcode", "sandbox", "production"]).optional(),
  level: z.enum(["info", "warn", "error"]).optional(),
  action: z.string().max(128).optional(),
  entityType: z.string().max(128).optional(),
  entityId: z.string().max(128).optional(),
  transactionId: z.string().max(128).optional(),
  offset: z.number().int().min(0).max(100000).default(0),
});

// Audit snapshots can contain integration configuration. Never expose credentials
// through either the dashboard or the agent's log-reading tool.
export function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key,
      /secret|password|credential|private.?key|authorization|signed.*(payload|transaction)|jws|access.?token|refresh.?token|hashed.?key|api.?key/i.test(key)
        ? "[redacted]" : redactLogValue(item)]),
  );
  return value;
}

export async function listApplicationLogs(applicationId: string, input: z.input<typeof applicationLogFilters> = {}) {
  const filters = applicationLogFilters.parse(input);
  const rows = await db.select().from(auditLogs).where(and(
    eq(auditLogs.applicationId, applicationId),
    filters.category ? inArray(sql`split_part(${auditLogs.action}, '.', 1)`, [...logCategories[filters.category].prefixes]) : undefined,
    filters.environment ? eq(sql`coalesce(${auditLogs.after}->>'environment', ${auditLogs.before}->>'environment')`, filters.environment) : undefined,
    filters.level ? eq(sql`coalesce(${auditLogs.after}->>'level', 'info')`, filters.level) : undefined,
    filters.action ? eq(auditLogs.action, filters.action) : undefined,
    filters.entityType ? eq(auditLogs.entityType, filters.entityType) : undefined,
    filters.entityId ? eq(auditLogs.entityId, filters.entityId) : undefined,
    filters.transactionId ? or(eq(sql`${auditLogs.after}->>'transactionId'`, filters.transactionId), eq(sql`${auditLogs.after}->>'originalTransactionId'`, filters.transactionId)) : undefined,
  )).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(101).offset(filters.offset);
  return {
    logs: rows.slice(0, 100).map(row => ({ ...row,
      before: redactLogValue(row.before) as typeof row.before,
      after: redactLogValue(row.after) as typeof row.after,
    })),
    nextOffset: rows.length > 100 ? filters.offset + 100 : null,
  };
}
