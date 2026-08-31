import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  balances,
  balanceUnits,
  ledgerEntries,
  type BalanceExpiryPolicy,
  type LedgerKind,
} from "@/lib/db/schema";
import {
  assertPositiveInteger,
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";
import { ensureBalanceRow, InsufficientBalanceError } from "./balance-core";
import { expireBalanceReservations } from "./balance-reservations";
import { drainLots, expireBalanceLots, openLot } from "./balance-lots";

export { InsufficientBalanceError } from "./balance-core";

export async function createAppUser(input: {
  applicationId: string;
  rxlabUserId: string;
  email?: string | null;
  displayName?: string | null;
  actor: Actor;
}) {
  const rxlabUserId = input.rxlabUserId.trim();
  if (!rxlabUserId) throw new ValidationError("rxlabUserId is required");

  const email = input.email?.trim() || null;
  const displayName = input.displayName?.trim() || null;
  if (displayName && displayName.length > 120) {
    throw new ValidationError("displayName must be at most 120 characters");
  }
  if (
    await getAppUserByRxlabId(input.applicationId, rxlabUserId, {
      isTest: false,
    })
  ) {
    throw new ValidationError("This RxLab user already belongs to the application");
  }

  const now = new Date();
  const [created] = await db
    .insert(appUsers)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      rxlabUserId,
      email,
      displayName,
      level: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    throw new ValidationError("This RxLab user already belongs to the application");
  }

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "user.create",
    entityType: "app_user",
    entityId: created.id,
    after: created,
  });
  return created;
}

/**
 * Find or create the application-scoped record for an rxlab identity. The same
 * person in two applications gets two rows, and therefore two independent sets
 * of balances, levels, and usage.
 */
export async function ensureAppUser(input: {
  applicationId: string;
  rxlabUserId: string;
  email?: string | null;
  displayName?: string | null;
  isTest: boolean;
}) {
  const rxlabUserId = input.rxlabUserId.trim();
  if (!rxlabUserId) throw new ValidationError("rxlabUserId is required");

  const existing = await getAppUserByRxlabId(input.applicationId, rxlabUserId, {
    isTest: input.isTest,
  });
  if (existing) {
    // Keep contact details fresh, but never overwrite with nothing.
    if (
      (input.email && input.email !== existing.email) ||
      (input.displayName && input.displayName !== existing.displayName)
    ) {
      const [updated] = await db
        .update(appUsers)
        .set({
          email: input.email ?? existing.email,
          displayName: input.displayName ?? existing.displayName,
          updatedAt: new Date(),
        })
        .where(eq(appUsers.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const now = new Date();
  const [created] = await db
    .insert(appUsers)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      rxlabUserId,
      email: input.email ?? null,
      displayName: input.displayName ?? null,
      level: 0,
      isTest: input.isTest,
      testNote: input.isTest ? "Created by sandbox API" : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  // A concurrent request may have won the insert; re-read rather than fail.
  return (
    created ??
    (await requireAppUserByRxlabId(
      input.applicationId,
      rxlabUserId,
      input.isTest,
    ))
  );
}

export async function getAppUserByRxlabId(
  applicationId: string,
  rxlabUserId: string,
  options: { isTest: boolean },
) {
  const [user] = await db
    .select()
    .from(appUsers)
    .where(
      and(
        eq(appUsers.applicationId, applicationId),
        eq(appUsers.rxlabUserId, rxlabUserId),
        eq(appUsers.isTest, options.isTest),
      ),
    )
    .limit(1);
  return user ?? null;
}

async function requireAppUserByRxlabId(
  applicationId: string,
  rxlabUserId: string,
  isTest: boolean,
) {
  const user = await getAppUserByRxlabId(applicationId, rxlabUserId, { isTest });
  if (!user) throw new NotFoundError("app user", rxlabUserId);
  return user;
}

export async function requireAppUser(applicationId: string, appUserId: string) {
  const [user] = await db
    .select()
    .from(appUsers)
    .where(
      and(eq(appUsers.id, appUserId), eq(appUsers.applicationId, applicationId)),
    )
    .limit(1);
  if (!user) throw new NotFoundError("app user", appUserId);
  return user;
}

export const USERS_PAGE_SIZE = 25;

/**
 * Test users live in the same table but belong to the Test tab, not the real
 * directory, so they are excluded from both listings unless asked for.
 */
function usersScope(applicationId: string, includeTest: boolean) {
  return includeTest
    ? eq(appUsers.applicationId, applicationId)
    : and(eq(appUsers.applicationId, applicationId), eq(appUsers.isTest, false));
}

export async function listAppUserOptions(
  applicationId: string,
  options: { includeTest?: boolean } = {},
) {
  return db
    .select({
      id: appUsers.id,
      rxlabUserId: appUsers.rxlabUserId,
      email: appUsers.email,
      displayName: appUsers.displayName,
      isTest: appUsers.isTest,
    })
    .from(appUsers)
    .where(usersScope(applicationId, options.includeTest ?? false))
    .orderBy(asc(appUsers.displayName), asc(appUsers.email), asc(appUsers.rxlabUserId));
}

export async function listAppUsers(
  applicationId: string,
  page = 1,
  options: { includeTest?: boolean } = {},
) {
  const safePage = Math.max(1, page);
  const where = usersScope(applicationId, options.includeTest ?? false);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(appUsers)
    .where(where);

  const rows = await db
    .select()
    .from(appUsers)
    .where(where)
    .orderBy(desc(appUsers.createdAt))
    .limit(USERS_PAGE_SIZE)
    .offset((safePage - 1) * USERS_PAGE_SIZE);

  return {
    users: rows,
    pagination: {
      page: safePage,
      pageSize: USERS_PAGE_SIZE,
      totalCount: count,
      totalPages: Math.max(1, Math.ceil(count / USERS_PAGE_SIZE)),
    },
  };
}

export async function setUserLevel(input: {
  applicationId: string;
  appUserId: string;
  level: number;
  levelKey?: string | null;
  actor: Actor;
}) {
  const before = await requireAppUser(input.applicationId, input.appUserId);
  if (!Number.isSafeInteger(input.level)) {
    throw new ValidationError("level must be an integer");
  }

  const [user] = await db
    .update(appUsers)
    .set({
      level: input.level,
      levelKey:
        input.levelKey === undefined ? before.levelKey : input.levelKey?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(appUsers.id, input.appUserId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "user.set_level",
    entityType: "app_user",
    entityId: user.id,
    before,
    after: user,
  });
  return user;
}

export async function getBalances(appUserId: string) {
  await expireBalanceReservations({ appUserId });
  // Reading is the other moment a stale balance would be visible, so the same
  // lazy sweep the debit path runs happens here too.
  await expireBalanceLots({ appUserId });
  return db
    .select({
      balanceId: balances.id,
      unitId: balanceUnits.id,
      unitKey: balanceUnits.key,
      unitName: balanceUnits.name,
      symbol: balanceUnits.symbol,
      precision: balanceUnits.precision,
      amount: balances.amount,
      reserved: balances.reserved,
    })
    .from(balances)
    .innerJoin(balanceUnits, eq(balances.unitId, balanceUnits.id))
    .where(eq(balances.appUserId, appUserId))
    .orderBy(asc(balanceUnits.key));
}

async function findLedgerEntry(idempotencyKey: string) {
  const [entry] = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
    .limit(1);
  return entry ?? null;
}

export interface BalanceMutation {
  appUserId: string;
  unitId: string;
  amount: number;
  kind: LedgerKind;
  description: string;
  idempotencyKey: string;
  referenceType?: string | null;
  referenceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * How the units this credit adds should expire.
 *
 * Omitted entirely by callers that grant units which never lapse — a topup, a
 * manual adjustment, a reversal — so their lots are opened open-ended.
 */
export interface CreditExpiry {
  expiresAt?: Date | null;
  expiryPolicy?: BalanceExpiryPolicy;
  expiryMonths?: number | null;
  subscriptionId?: string | null;
  planId?: string | null;
}

/**
 * Add units to a balance.
 *
 * Idempotent on `idempotencyKey`: a retried Stripe webhook or API call returns
 * the original ledger entry instead of crediting twice.
 */
export async function creditBalance(input: BalanceMutation & CreditExpiry) {
  const amount = assertPositiveInteger(input.amount, "amount");
  const existing = await findLedgerEntry(input.idempotencyKey);
  if (existing) return { entry: existing, duplicate: true as const };

  await ensureBalanceRow(input.appUserId, input.unitId);
  const now = new Date();

  const entry = await db.transaction(async (tx) => {
    // Read before the increment so a negative balance — units clawed back after
    // they were already spent — can be settled out of this credit rather than
    // opening a lot for units that only cover an existing debt.
    const [before] = await tx
      .select()
      .from(balances)
      .where(
        and(
          eq(balances.appUserId, input.appUserId),
          eq(balances.unitId, input.unitId),
        ),
      )
      .limit(1);
    const debt = before && before.amount < 0 ? -before.amount : 0;

    const [updated] = await tx
      .update(balances)
      .set({ amount: sql`${balances.amount} + ${amount}`, updatedAt: now })
      .where(
        and(
          eq(balances.appUserId, input.appUserId),
          eq(balances.unitId, input.unitId),
        ),
      )
      .returning();

    const [row] = await tx
      .insert(ledgerEntries)
      .values({
        id: newId(),
        appUserId: input.appUserId,
        unitId: input.unitId,
        kind: input.kind,
        delta: amount,
        balanceAfter: updated.amount,
        description: input.description,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? null,
        createdAt: now,
      })
      .returning();

    await openLot(
      tx,
      {
        appUserId: input.appUserId,
        unitId: input.unitId,
        amount,
        ledgerEntryId: row.id,
        expiresAt: input.expiresAt ?? null,
        expiryPolicy: input.expiryPolicy,
        expiryMonths: input.expiryMonths,
        subscriptionId: input.subscriptionId,
        planId: input.planId,
        now,
      },
      debt,
    );

    return row;
  });

  return { entry, duplicate: false as const };
}

/**
 * Remove units from a balance.
 *
 * The decrement is a single conditional UPDATE — it only applies while
 * `amount - reserved` still covers the request — so two concurrent debits can
 * never drive a balance negative.
 */
export async function debitBalance(input: BalanceMutation) {
  const amount = assertPositiveInteger(input.amount, "amount");
  const existing = await findLedgerEntry(input.idempotencyKey);
  if (existing) return { entry: existing, duplicate: true as const };

  await expireBalanceReservations({
    appUserId: input.appUserId,
    unitId: input.unitId,
  });
  await ensureBalanceRow(input.appUserId, input.unitId);
  // Lapsed units must be gone before the sufficiency guard runs, or a debit
  // between two sweeps would spend a balance the user no longer has.
  await expireBalanceLots({
    appUserId: input.appUserId,
    unitId: input.unitId,
  });
  const now = new Date();

  const entry = await db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(balances)
      .set({ amount: sql`${balances.amount} - ${amount}`, updatedAt: now })
      .where(
        and(
          eq(balances.appUserId, input.appUserId),
          eq(balances.unitId, input.unitId),
          sql`${balances.amount} - ${balances.reserved} >= ${amount}`,
        ),
      )
      .returning();

    if (updatedRows.length === 0) {
      const [current] = await tx
        .select()
        .from(balances)
        .where(
          and(
            eq(balances.appUserId, input.appUserId),
            eq(balances.unitId, input.unitId),
          ),
        )
        .limit(1);
      throw new InsufficientBalanceError(
        current ? current.amount - current.reserved : 0,
        amount,
      );
    }

    // Spend the tranches that lapse soonest, so the units a user is about to
    // lose go first and the ones they could have kept survive.
    await drainLots(tx, input.appUserId, input.unitId, amount, now);

    const [row] = await tx
      .insert(ledgerEntries)
      .values({
        id: newId(),
        appUserId: input.appUserId,
        unitId: input.unitId,
        kind: input.kind,
        delta: -amount,
        balanceAfter: updatedRows[0].amount,
        description: input.description,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? null,
        createdAt: now,
      })
      .returning();
    return row;
  });

  return { entry, duplicate: false as const };
}

/**
 * Reverse a provider grant even after the user spent it. Any uncovered amount
 * becomes a negative balance and is settled by later credits.
 */
export async function debitBalanceAllowingNegative(input: BalanceMutation) {
  const amount = assertPositiveInteger(input.amount, "amount");
  const existing = await findLedgerEntry(input.idempotencyKey);
  if (existing) return { entry: existing, duplicate: true as const };

  await ensureBalanceRow(input.appUserId, input.unitId);
  const now = new Date();
  const entry = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(balances)
      .set({ amount: sql`${balances.amount} - ${amount}`, updatedAt: now })
      .where(
        and(
          eq(balances.appUserId, input.appUserId),
          eq(balances.unitId, input.unitId),
        ),
      )
      .returning();
    await drainLots(tx, input.appUserId, input.unitId, amount, now);
    const [row] = await tx
      .insert(ledgerEntries)
      .values({
        id: newId(),
        appUserId: input.appUserId,
        unitId: input.unitId,
        kind: input.kind,
        delta: -amount,
        balanceAfter: updated.amount,
        description: input.description,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? null,
        createdAt: now,
      })
      .returning();
    return row;
  });
  return { entry, duplicate: false as const };
}

export const LEDGER_PAGE_SIZE = 25;

export async function getLedger(appUserId: string, page = 1) {
  const safePage = Math.max(1, page);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.appUserId, appUserId));

  const entries = await db
    .select({
      id: ledgerEntries.id,
      kind: ledgerEntries.kind,
      delta: ledgerEntries.delta,
      balanceAfter: ledgerEntries.balanceAfter,
      description: ledgerEntries.description,
      unitKey: balanceUnits.key,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .innerJoin(balanceUnits, eq(ledgerEntries.unitId, balanceUnits.id))
    .where(eq(ledgerEntries.appUserId, appUserId))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(LEDGER_PAGE_SIZE)
    .offset((safePage - 1) * LEDGER_PAGE_SIZE);

  return {
    entries,
    pagination: {
      page: safePage,
      pageSize: LEDGER_PAGE_SIZE,
      totalCount: count,
      totalPages: Math.max(1, Math.ceil(count / LEDGER_PAGE_SIZE)),
    },
  };
}

/** Application API ledger history with caller-controlled, bounded pagination. */
export async function getLedgerHistory(input: {
  appUserId: string;
  unitId?: string | null;
  page: number;
  pageSize: number;
}) {
  await expireBalanceReservations({
    appUserId: input.appUserId,
    unitId: input.unitId ?? undefined,
  });
  const where = and(
    eq(ledgerEntries.appUserId, input.appUserId),
    input.unitId ? eq(ledgerEntries.unitId, input.unitId) : undefined,
  );
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(ledgerEntries)
    .where(where);
  const entries = await db
    .select({
      id: ledgerEntries.id,
      kind: ledgerEntries.kind,
      unit: balanceUnits.key,
      delta: ledgerEntries.delta,
      balanceAfter: ledgerEntries.balanceAfter,
      description: ledgerEntries.description,
      referenceType: ledgerEntries.referenceType,
      referenceId: ledgerEntries.referenceId,
      createdAt: ledgerEntries.createdAt,
      metadata: ledgerEntries.metadata,
    })
    .from(ledgerEntries)
    .innerJoin(balanceUnits, eq(ledgerEntries.unitId, balanceUnits.id))
    .where(where)
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  return {
    entries,
    total: count,
    page: input.page,
    pageSize: input.pageSize,
    pageCount: Math.ceil(count / input.pageSize),
  };
}

/** Console-initiated correction. Always audited with the acting admin. */
export async function adjustBalance(input: {
  applicationId: string;
  appUserId: string;
  unitId: string;
  delta: number;
  reason: string;
  actor: Actor;
}) {
  await requireAppUser(input.applicationId, input.appUserId);
  if (!Number.isSafeInteger(input.delta) || input.delta === 0) {
    throw new ValidationError("delta must be a non-zero integer");
  }
  if (!input.reason.trim()) throw new ValidationError("reason is required");

  const mutation: BalanceMutation = {
    appUserId: input.appUserId,
    unitId: input.unitId,
    amount: Math.abs(input.delta),
    kind: "adjustment",
    description: input.reason.trim(),
    idempotencyKey: `adjustment:${newId()}`,
    referenceType: "manual_adjustment",
    referenceId: input.actor.id,
  };

  const result =
    input.delta > 0 ? await creditBalance(mutation) : await debitBalance(mutation);

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "balance.adjust",
    entityType: "app_user",
    entityId: input.appUserId,
    after: { delta: input.delta, reason: input.reason, entryId: result.entry.id },
  });
  return result.entry;
}
