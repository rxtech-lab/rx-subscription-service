import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { balances } from "@/lib/db/schema";
import { newId } from "./shared";

export class InsufficientBalanceError extends Error {
  constructor(
    readonly available: number,
    readonly requested: number,
  ) {
    super(`Insufficient balance: ${available} available, ${requested} required`);
    this.name = "InsufficientBalanceError";
  }
}

/** Create a balance row on demand so callers never have to pre-provision one. */
export async function ensureBalanceRow(appUserId: string, unitId: string) {
  const [existing] = await db
    .select()
    .from(balances)
    .where(and(eq(balances.appUserId, appUserId), eq(balances.unitId, unitId)))
    .limit(1);
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(balances)
    .values({
      id: newId(),
      appUserId,
      unitId,
      amount: 0,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(balances)
    .where(and(eq(balances.appUserId, appUserId), eq(balances.unitId, unitId)))
    .limit(1);
  if (!raced) throw new Error("Balance row was not created");
  return raced;
}
