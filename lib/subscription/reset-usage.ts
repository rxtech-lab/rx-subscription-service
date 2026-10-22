import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, usageCounters, type ApiEnvironment } from "@/lib/db/schema";
import { isApiEnvironment } from "@/lib/api/keys";
import { newId, recordAudit, ValidationError, type Actor } from "./shared";
import { MAX_CLOCK_OFFSET_MS } from "./test-clock";
import { requireAppUser } from "./users";
import { requireUsageItem } from "./usage-items";

/** Reset active counters only; historical records and billing remain intact. */
export async function resetUserUsage(input: {
  applicationId: string;
  environment: ApiEnvironment;
  userScope: "user" | "all";
  usageScope: "item" | "all";
  appUserId?: string;
  usageItemId?: string;
  actor: Actor;
}) {
  if (!isApiEnvironment(input.environment) ||
      !["user", "all"].includes(input.userScope) ||
      !["item", "all"].includes(input.usageScope)) {
    throw new ValidationError("Choose a valid reset scope and environment");
  }
  if (input.userScope === "user") {
    if (!input.appUserId) throw new ValidationError("Choose a user");
    const user = await requireAppUser(input.applicationId, input.appUserId);
    if (user.environment !== input.environment) {
      throw new ValidationError("User does not belong to the selected environment");
    }
  }
  if (input.usageScope === "item") {
    if (!input.usageItemId) throw new ValidationError("Choose a usage item");
    await requireUsageItem(input.applicationId, input.usageItemId);
  }
  const now = new Date();
  const users = db.select({ id: appUsers.id }).from(appUsers).where(and(
    eq(appUsers.applicationId, input.applicationId),
    eq(appUsers.environment, input.environment),
    input.userScope === "user" ? eq(appUsers.id, input.appUserId!) : undefined,
  ));
  // Test users can have a simulated clock; use the same time as usage reads.
  const effectiveNow = sql`${now.toISOString()}::timestamptz + greatest(${-MAX_CLOCK_OFFSET_MS}, least(${MAX_CLOCK_OFFSET_MS}, coalesce((select ${appUsers.testClockOffsetMs} from ${appUsers} where ${appUsers.id} = ${usageCounters.appUserId}), 0))) * interval '1 millisecond'`;
  return db.transaction(async (tx) => {
    const counters = await tx.select().from(usageCounters).where(and(
      inArray(usageCounters.appUserId, users),
      input.usageScope === "item" ? eq(usageCounters.usageItemId, input.usageItemId!) : undefined,
      sql`${usageCounters.periodStart} <= ${effectiveNow}`,
      sql`(${usageCounters.periodEnd} is null or ${usageCounters.periodEnd} > ${effectiveNow})`,
    )).orderBy(usageCounters.id).for("update");
    const resetId = newId();
    for (const counter of counters) {
      await tx.update(usageCounters).set({ used: 0, updatedAt: now })
        .where(eq(usageCounters.id, counter.id));
      await recordAudit({
        applicationId: input.applicationId, actor: input.actor,
        action: "usage.reset", entityType: "usage_counter", entityId: counter.id,
        before: { used: counter.used, appUserId: counter.appUserId, usageItemId: counter.usageItemId },
        after: { used: 0, resetId, environment: input.environment, userScope: input.userScope, usageScope: input.usageScope },
      }, tx);
    }
    return counters.length;
  });
}
