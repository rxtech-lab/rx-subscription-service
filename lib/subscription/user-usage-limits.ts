import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, appUserUsageLimits } from "@/lib/db/schema";
import { assertNonNegativeInteger, newId, recordAudit, ValidationError, type Actor } from "./shared";
import { requireAppUser } from "./users";
import { requireUsageItem } from "./usage-items";

/** Overrides persist across periods and replace only this user's allowance. */
export async function updateUserUsageLimit(input: {
  applicationId: string;
  appUserId: string;
  usageItemId: string;
  mode: string;
  limitValue?: number;
  actor: Actor;
}) {
  if (!["custom", "unlimited", "default"].includes(input.mode)) {
    throw new ValidationError("Choose a usage limit option");
  }
  const limitValue = input.mode === "custom"
    ? assertNonNegativeInteger(input.limitValue ?? NaN, "Usage limit")
    : null;
  const user = await requireAppUser(input.applicationId, input.appUserId);
  const item = await requireUsageItem(input.applicationId, input.usageItemId);

  await db.transaction(async (tx) => {
    await tx.select({ id: appUsers.id }).from(appUsers)
      .where(eq(appUsers.id, user.id)).for("update");
    const scope = and(
      eq(appUserUsageLimits.appUserId, user.id),
      eq(appUserUsageLimits.usageItemId, item.id),
    );
    const [before] = await tx.select().from(appUserUsageLimits).where(scope);
    if (input.mode === "default") {
      await tx.delete(appUserUsageLimits).where(scope);
    } else {
      const now = new Date();
      await tx.insert(appUserUsageLimits).values({
        id: newId(), appUserId: user.id, usageItemId: item.id,
        limitValue, createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [appUserUsageLimits.appUserId, appUserUsageLimits.usageItemId],
        set: { limitValue, updatedAt: now },
      });
    }
    await recordAudit({
      applicationId: input.applicationId, actor: input.actor,
      action: input.mode === "default" ? "user.clear_usage_limit" : "user.set_usage_limit",
      entityType: "app_user", entityId: user.id,
      before: { usageItemId: item.id, hasOverride: Boolean(before), limitValue: before?.limitValue ?? null },
      after: { usageItemId: item.id, hasOverride: input.mode !== "default", limitValue },
    }, tx);
  });
}
