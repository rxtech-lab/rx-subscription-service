import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, balanceUnits, ledgerEntries } from "@/lib/db/schema";
import { userCreditGrantSchema } from "./credit-grant-schema";
import { NotFoundError, recordAudit, ValidationError, type Actor } from "./shared";
import { creditBalance } from "./users";

/** Positive, non-expiring administrative credits, isolated by application and environment. */
export async function grantUserCredits(input: {
  applicationId: string;
  appUserId: string;
  environment: "sandbox" | "production";
  unitId: string;
  amount: number;
  reason: string;
  operationId: string;
  actor: Actor;
}) {
  const parsed = userCreditGrantSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const args = parsed.data;
  if (!input.operationId.trim() || input.operationId.length > 200) {
    throw new ValidationError("A valid credit operation ID is required");
  }

  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(appUsers).where(and(
      eq(appUsers.id, args.appUserId), eq(appUsers.applicationId, input.applicationId),
    )).limit(1).for("update");
    if (!user) throw new NotFoundError("app user", args.appUserId);
    if (user.environment !== args.environment) {
      throw new ValidationError(`User belongs to ${user.environment}, not ${args.environment}`);
    }
    const [unit] = await tx.select().from(balanceUnits).where(and(
      eq(balanceUnits.id, args.unitId), eq(balanceUnits.applicationId, input.applicationId),
    )).limit(1);
    if (!unit) throw new NotFoundError("balance unit", args.unitId);

    const idempotencyKey = `admin_credit:${input.applicationId}:${user.id}:${input.operationId}`;
    const [previous] = await tx.select().from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, idempotencyKey)).limit(1);
    if (previous) {
      if (previous.unitId !== unit.id || previous.delta !== args.amount || previous.description !== args.reason) {
        throw new ValidationError("This credit operation was already used with different details");
      }
      return { entry: previous, environment: user.environment, duplicate: true };
    }

    const result = await creditBalance({
      appUserId: user.id, unitId: unit.id, amount: args.amount,
      kind: "adjustment", description: args.reason, idempotencyKey,
      referenceType: "admin_credit_grant", referenceId: input.operationId,
      metadata: { environment: user.environment },
    }, tx);
    await recordAudit({
      applicationId: input.applicationId, actor: input.actor, action: "balance.grant_credits",
      entityType: "ledger_entry", entityId: result.entry.id,
      after: { ...result.entry, environment: user.environment, reason: args.reason },
    }, tx);
    return { ...result, environment: user.environment };
  });
}
