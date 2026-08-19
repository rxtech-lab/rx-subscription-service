import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  balanceReservationOperations,
  balanceReservations,
  balances,
  balanceUnits,
  ledgerEntries,
  type BalanceReservationOperationKind,
} from "@/lib/db/schema";
import { ensureBalanceRow, InsufficientBalanceError } from "./balance-core";
import {
  assertNonNegativeInteger,
  assertPositiveInteger,
  newId,
  ValidationError,
} from "./shared";

export const DEFAULT_RESERVATION_TTL_SECONDS = 30 * 60;
export const MAX_RESERVATION_TTL_SECONDS = 24 * 60 * 60;

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotencyKey was already used for a different request");
    this.name = "IdempotencyConflictError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor(id: string) {
    super(`Balance reservation not found: ${id}`);
    this.name = "ReservationNotFoundError";
  }
}

export class ReservationStateError extends Error {
  constructor(readonly status: string) {
    super(`Balance reservation is ${status}`);
    this.name = "ReservationStateError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function validateTtl(seconds: number): number {
  const ttl = assertPositiveInteger(seconds, "expiresInSeconds");
  if (ttl > MAX_RESERVATION_TTL_SECONDS) {
    throw new ValidationError(
      `expiresInSeconds must be at most ${MAX_RESERVATION_TTL_SECONDS}`,
    );
  }
  return ttl;
}

function iso(date: Date): string {
  return date.toISOString();
}

async function findReservationByKey(applicationId: string, idempotencyKey: string) {
  const [reservation] = await db
    .select()
    .from(balanceReservations)
    .where(
      and(
        eq(balanceReservations.applicationId, applicationId),
        eq(balanceReservations.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return reservation ?? null;
}

async function replayReservation(
  applicationId: string,
  idempotencyKey: string,
  requestFingerprint: string,
) {
  const existing = await findReservationByKey(applicationId, idempotencyKey);
  if (!existing) return null;
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new IdempotencyConflictError();
  }
  return {
    reservationId: existing.id,
    amount: existing.initialAmount,
    available: existing.availableAfterReserve,
    expiresAt: iso(existing.expiresAt),
    duplicate: true as const,
  };
}

async function findOperation(idempotencyKey: string) {
  const [operation] = await db
    .select()
    .from(balanceReservationOperations)
    .where(eq(balanceReservationOperations.idempotencyKey, idempotencyKey))
    .limit(1);
  return operation ?? null;
}

async function replayOperation<T extends Record<string, unknown>>(input: {
  applicationId: string;
  reservationId: string;
  kind: BalanceReservationOperationKind;
  idempotencyKey: string;
  requestFingerprint: string;
}): Promise<(T & { duplicate: true }) | null> {
  const existing = await findOperation(input.idempotencyKey);
  if (!existing) return null;
  if (
    existing.applicationId !== input.applicationId ||
    existing.reservationId !== input.reservationId ||
    existing.kind !== input.kind ||
    existing.requestFingerprint !== input.requestFingerprint
  ) {
    throw new IdempotencyConflictError();
  }
  return { ...(existing.response as T), duplicate: true as const };
}

async function requireReservation(applicationId: string, reservationId: string) {
  const [reservation] = await db
    .select()
    .from(balanceReservations)
    .where(
      and(
        eq(balanceReservations.id, reservationId),
        eq(balanceReservations.applicationId, applicationId),
      ),
    )
    .limit(1);
  if (!reservation) throw new ReservationNotFoundError(reservationId);
  return reservation;
}

/**
 * Lazily release expired holds. The status claim and aggregate decrement share
 * one transaction, so concurrent reads/reapers can release each row only once.
 */
export async function expireBalanceReservations(input: {
  applicationId?: string;
  appUserId?: string;
  unitId?: string;
  reservationId?: string;
  now?: Date;
} = {}) {
  const now = input.now ?? new Date();
  const expired = await db
    .select({
      id: balanceReservations.id,
      appUserId: balanceReservations.appUserId,
      unitId: balanceReservations.unitId,
      amount: balanceReservations.amount,
    })
    .from(balanceReservations)
    .where(
      and(
        eq(balanceReservations.status, "open"),
        lte(balanceReservations.expiresAt, now),
        input.applicationId
          ? eq(balanceReservations.applicationId, input.applicationId)
          : undefined,
        input.appUserId
          ? eq(balanceReservations.appUserId, input.appUserId)
          : undefined,
        input.unitId ? eq(balanceReservations.unitId, input.unitId) : undefined,
        input.reservationId
          ? eq(balanceReservations.id, input.reservationId)
          : undefined,
      ),
    );

  for (const candidate of expired) {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(balanceReservations)
        .set({
          status: "expired",
          amount: 0,
          releasedAmount: sql`${balanceReservations.releasedAmount} + ${candidate.amount}`,
          releaseReason: "expired",
          updatedAt: now,
          closedAt: now,
        })
        .where(
          and(
            eq(balanceReservations.id, candidate.id),
            eq(balanceReservations.status, "open"),
            lte(balanceReservations.expiresAt, now),
          ),
        )
        .returning();
      if (!claimed) return;

      const [balance] = await tx
        .update(balances)
        .set({
          reserved: sql`${balances.reserved} - ${candidate.amount}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(balances.appUserId, candidate.appUserId),
            eq(balances.unitId, candidate.unitId),
            sql`${balances.reserved} >= ${candidate.amount}`,
          ),
        )
        .returning();
      if (!balance) throw new Error("Reservation aggregate is inconsistent");

      await tx
        .update(balanceReservations)
        .set({ balanceAfter: balance.amount })
        .where(eq(balanceReservations.id, candidate.id));
    });
  }

  return expired.length;
}

export async function reserveBalance(input: {
  applicationId: string;
  appUserId: string;
  unitId: string;
  amount: number;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | null;
  expiresInSeconds?: number;
}) {
  const amount = assertPositiveInteger(input.amount, "amount");
  const ttlSeconds = validateTtl(
    input.expiresInSeconds ?? DEFAULT_RESERVATION_TTL_SECONDS,
  );
  const requestFingerprint = fingerprint({
    appUserId: input.appUserId,
    unitId: input.unitId,
    amount,
    description: input.description,
    metadata: input.metadata ?? null,
    expiresInSeconds: ttlSeconds,
  });
  const replay = await replayReservation(
    input.applicationId,
    input.idempotencyKey,
    requestFingerprint,
  );
  if (replay) return replay;

  await expireBalanceReservations({ appUserId: input.appUserId, unitId: input.unitId });
  await ensureBalanceRow(input.appUserId, input.unitId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);

  try {
    const result = await db.transaction(async (tx) => {
      const [balance] = await tx
        .update(balances)
        .set({
          reserved: sql`${balances.reserved} + ${amount}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(balances.appUserId, input.appUserId),
            eq(balances.unitId, input.unitId),
            sql`${balances.amount} - ${balances.reserved} >= ${amount}`,
          ),
        )
        .returning();
      if (!balance) {
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

      const available = balance.amount - balance.reserved;
      const reservationId = newId();
      await tx.insert(balanceReservations).values({
        id: reservationId,
        applicationId: input.applicationId,
        appUserId: input.appUserId,
        unitId: input.unitId,
        initialAmount: amount,
        amount,
        status: "open",
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        metadata: input.metadata ?? null,
        availableAfterReserve: available,
        ttlSeconds,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return {
        reservationId,
        amount,
        available,
        expiresAt: iso(expiresAt),
        duplicate: false as const,
      };
    });
    return result;
  } catch (error) {
    const raced = await replayReservation(
      input.applicationId,
      input.idempotencyKey,
      requestFingerprint,
    );
    if (raced) return raced;
    throw error;
  }
}

export async function increaseBalanceReservation(input: {
  applicationId: string;
  reservationId: string;
  amount: number;
  idempotencyKey: string;
}) {
  const amount = assertPositiveInteger(input.amount, "amount");
  const requestFingerprint = fingerprint({ amount });
  const replay = await replayOperation<{
    reservationId: string;
    amount: number;
    available: number;
    expiresAt: string;
    status: "open";
  }>({ ...input, kind: "increase", requestFingerprint });
  if (replay) return replay;

  try {
    await expireBalanceReservations({
      applicationId: input.applicationId,
      reservationId: input.reservationId,
    });
    const before = await requireReservation(
      input.applicationId,
      input.reservationId,
    );
    if (before.status !== "open") throw new ReservationStateError(before.status);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + before.ttlSeconds * 1_000);

    return await db.transaction(async (tx) => {
      const [reservation] = await tx
        .update(balanceReservations)
        .set({
          amount: sql`${balanceReservations.amount} + ${amount}`,
          expiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(balanceReservations.id, input.reservationId),
            eq(balanceReservations.applicationId, input.applicationId),
            eq(balanceReservations.status, "open"),
          ),
        )
        .returning();
      if (!reservation) throw new ReservationStateError("not_open");

      const [balance] = await tx
        .update(balances)
        .set({
          reserved: sql`${balances.reserved} + ${amount}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(balances.appUserId, reservation.appUserId),
            eq(balances.unitId, reservation.unitId),
            sql`${balances.amount} - ${balances.reserved} >= ${amount}`,
          ),
        )
        .returning();
      if (!balance) {
        const [current] = await tx
          .select()
          .from(balances)
          .where(
            and(
              eq(balances.appUserId, reservation.appUserId),
              eq(balances.unitId, reservation.unitId),
            ),
          )
          .limit(1);
        throw new InsufficientBalanceError(
          current ? current.amount - current.reserved : 0,
          amount,
        );
      }

      const response = {
        reservationId: reservation.id,
        amount: reservation.amount,
        available: balance.amount - balance.reserved,
        expiresAt: iso(expiresAt),
        status: "open" as const,
        duplicate: false as const,
      };
      await tx.insert(balanceReservationOperations).values({
        id: newId(),
        applicationId: input.applicationId,
        reservationId: input.reservationId,
        kind: "increase",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        response,
        createdAt: now,
      });
      return response;
    });
  } catch (error) {
    const raced = await replayOperation<{
      reservationId: string;
      amount: number;
      available: number;
      expiresAt: string;
      status: "open";
    }>({ ...input, kind: "increase", requestFingerprint });
    if (raced) return raced;
    throw error;
  }
}

type SettleResponse = {
  reservationId: string;
  entryId: string;
  operationRequestedAmount: number;
  operationSettledAmount: number;
  operationShortfallAmount: number;
  requestedAmount: number;
  settledAmount: number;
  shortfallAmount: number;
  remainingReserved: number;
  balanceAfter: number;
  status: "open" | "closed" | "expired";
  expiresAt: string | null;
  duplicate: boolean;
};

export async function settleBalanceReservation(input: {
  applicationId: string;
  reservationId: string;
  amount: number;
  final?: boolean;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey: string;
}) {
  const amount = assertNonNegativeInteger(input.amount, "amount");
  const final = input.final ?? false;
  const requestFingerprint = fingerprint({
    amount,
    final,
    description: input.description ?? null,
    metadata: input.metadata ?? null,
  });
  const replay = await replayOperation<SettleResponse>({
    ...input,
    kind: "settle",
    requestFingerprint,
  });
  if (replay) return replay;

  try {
    const now = new Date();
    await expireBalanceReservations({
      applicationId: input.applicationId,
      reservationId: input.reservationId,
      now,
    });
    const before = await requireReservation(
      input.applicationId,
      input.reservationId,
    );
    if (before.status === "closed" || before.status === "released") {
      throw new ReservationStateError(before.status);
    }

    return await db.transaction(async (tx) => {
      const [reservation] = await tx
        .select()
        .from(balanceReservations)
        .where(
          and(
            eq(balanceReservations.id, input.reservationId),
            eq(balanceReservations.applicationId, input.applicationId),
          ),
        )
        .limit(1);
      if (!reservation) throw new ReservationNotFoundError(input.reservationId);
      if (reservation.status === "closed" || reservation.status === "released") {
        throw new ReservationStateError(reservation.status);
      }

      const [currentBalance] = await tx
        .select()
        .from(balances)
        .where(
          and(
            eq(balances.appUserId, reservation.appUserId),
            eq(balances.unitId, reservation.unitId),
          ),
        )
        .limit(1);
      if (!currentBalance) throw new Error("Reservation balance is missing");

      const hold = reservation.status === "open" ? reservation.amount : 0;
      const unreservedAvailable = Math.max(
        0,
        currentBalance.amount - currentBalance.reserved,
      );
      const chargeCapacity = hold + unreservedAvailable;
      const operationSettledAmount = Math.min(amount, chargeCapacity);
      const operationShortfallAmount = amount - operationSettledAmount;
      const heldConsumed = Math.min(operationSettledAmount, hold);
      const remainingBeforeFinal = hold - heldConsumed;
      const releasedOnFinal = reservation.status === "open" && final
        ? remainingBeforeFinal
        : 0;
      const reservedDecrease = heldConsumed + releasedOnFinal;
      const remainingReserved = reservation.status === "open" && !final
        ? remainingBeforeFinal
        : 0;
      const status: SettleResponse["status"] =
        reservation.status === "expired" ? "expired" : final ? "closed" : "open";
      const expiresAt = status === "open"
        ? new Date(now.getTime() + reservation.ttlSeconds * 1_000)
        : null;

      const [balance] = await tx
        .update(balances)
        .set({
          amount: sql`${balances.amount} - ${operationSettledAmount}`,
          reserved: sql`${balances.reserved} - ${reservedDecrease}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(balances.appUserId, reservation.appUserId),
            eq(balances.unitId, reservation.unitId),
            sql`${balances.amount} >= ${operationSettledAmount}`,
            sql`${balances.reserved} >= ${reservedDecrease}`,
          ),
        )
        .returning();
      if (!balance) throw new Error("Reservation aggregate is inconsistent");

      const entryId = newId();
      await tx.insert(ledgerEntries).values({
        id: entryId,
        appUserId: reservation.appUserId,
        unitId: reservation.unitId,
        kind: "usage",
        delta: -operationSettledAmount,
        balanceAfter: balance.amount,
        description: input.description?.trim() || reservation.description,
        referenceType: "balance_reservation",
        referenceId: reservation.id,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? reservation.metadata,
        createdAt: now,
      });

      const requestedAmount = reservation.requestedAmount + amount;
      const settledAmount = reservation.settledAmount + operationSettledAmount;
      const shortfallAmount = reservation.shortfallAmount + operationShortfallAmount;
      await tx
        .update(balanceReservations)
        .set({
          amount: remainingReserved,
          status: status === "closed" ? "closed" : reservation.status,
          requestedAmount,
          settledAmount,
          shortfallAmount,
          releasedAmount: reservation.releasedAmount + releasedOnFinal,
          entryId,
          balanceAfter: balance.amount,
          expiresAt: expiresAt ?? reservation.expiresAt,
          releaseReason: status === "closed" ? "final_settle" : reservation.releaseReason,
          updatedAt: now,
          closedAt: status === "closed" ? now : reservation.closedAt,
        })
        .where(eq(balanceReservations.id, reservation.id));

      const response: SettleResponse = {
        reservationId: reservation.id,
        entryId,
        operationRequestedAmount: amount,
        operationSettledAmount,
        operationShortfallAmount,
        requestedAmount,
        settledAmount,
        shortfallAmount,
        remainingReserved,
        balanceAfter: balance.amount,
        status,
        expiresAt: expiresAt ? iso(expiresAt) : null,
        duplicate: false,
      };
      await tx.insert(balanceReservationOperations).values({
        id: newId(),
        applicationId: input.applicationId,
        reservationId: reservation.id,
        kind: "settle",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        response,
        createdAt: now,
      });
      return response;
    });
  } catch (error) {
    const raced = await replayOperation<SettleResponse>({
      ...input,
      kind: "settle",
      requestFingerprint,
    });
    if (raced) return raced;
    throw error;
  }
}

type ReleaseResponse = {
  reservationId: string;
  released: boolean;
  releasedAmount: number;
  remainingReserved: number;
  balanceAfter: number;
  status: "closed" | "expired";
  duplicate: boolean;
};

export async function releaseBalanceReservation(input: {
  applicationId: string;
  reservationId: string;
  idempotencyKey: string;
  reason?: string | null;
}) {
  const requestFingerprint = fingerprint({ reason: input.reason ?? null });
  const replay = await replayOperation<ReleaseResponse>({
    ...input,
    kind: "release",
    requestFingerprint,
  });
  if (replay) return replay;

  try {
    const now = new Date();
    await expireBalanceReservations({
      applicationId: input.applicationId,
      reservationId: input.reservationId,
      now,
    });
    const before = await requireReservation(
      input.applicationId,
      input.reservationId,
    );
    if (before.status === "closed" || before.status === "released") {
      throw new ReservationStateError(before.status);
    }

    return await db.transaction(async (tx) => {
      const [reservation] = await tx
        .select()
        .from(balanceReservations)
        .where(
          and(
            eq(balanceReservations.id, input.reservationId),
            eq(balanceReservations.applicationId, input.applicationId),
          ),
        )
        .limit(1);
      if (!reservation) throw new ReservationNotFoundError(input.reservationId);
      if (reservation.status === "closed" || reservation.status === "released") {
        throw new ReservationStateError(reservation.status);
      }

      const [currentBalance] = await tx
        .select()
        .from(balances)
        .where(
          and(
            eq(balances.appUserId, reservation.appUserId),
            eq(balances.unitId, reservation.unitId),
          ),
        )
        .limit(1);
      if (!currentBalance) throw new Error("Reservation balance is missing");

      let balanceAfter = currentBalance.amount;
      let releasedAmount = 0;
      let released = false;
      let status: ReleaseResponse["status"] = "expired";
      if (reservation.status === "open") {
        const [balance] = await tx
          .update(balances)
          .set({
            reserved: sql`${balances.reserved} - ${reservation.amount}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(balances.appUserId, reservation.appUserId),
              eq(balances.unitId, reservation.unitId),
              sql`${balances.reserved} >= ${reservation.amount}`,
            ),
          )
          .returning();
        if (!balance) throw new Error("Reservation aggregate is inconsistent");
        balanceAfter = balance.amount;
        releasedAmount = reservation.amount;
        released = true;
        status = "closed";
        await tx
          .update(balanceReservations)
          .set({
            amount: 0,
            status: "released",
            releasedAmount: reservation.releasedAmount + releasedAmount,
            releaseReason: input.reason?.trim() || "released",
            balanceAfter,
            updatedAt: now,
            closedAt: now,
          })
          .where(eq(balanceReservations.id, reservation.id));
      }

      const response: ReleaseResponse = {
        reservationId: reservation.id,
        released,
        releasedAmount,
        remainingReserved: 0,
        balanceAfter,
        status,
        duplicate: false,
      };
      await tx.insert(balanceReservationOperations).values({
        id: newId(),
        applicationId: input.applicationId,
        reservationId: reservation.id,
        kind: "release",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        response,
        createdAt: now,
      });
      return response;
    });
  } catch (error) {
    const raced = await replayOperation<ReleaseResponse>({
      ...input,
      kind: "release",
      requestFingerprint,
    });
    if (raced) return raced;
    throw error;
  }
}

export async function getBalanceReservation(
  applicationId: string,
  reservationId: string,
) {
  await expireBalanceReservations({ applicationId, reservationId });
  const [row] = await db
    .select({
      reservation: balanceReservations,
      rxlabUserId: appUsers.rxlabUserId,
      unit: balanceUnits.key,
      balanceAmount: balances.amount,
      balanceReserved: balances.reserved,
    })
    .from(balanceReservations)
    .innerJoin(appUsers, eq(balanceReservations.appUserId, appUsers.id))
    .innerJoin(balanceUnits, eq(balanceReservations.unitId, balanceUnits.id))
    .innerJoin(
      balances,
      and(
        eq(balanceReservations.appUserId, balances.appUserId),
        eq(balanceReservations.unitId, balances.unitId),
      ),
    )
    .where(
      and(
        eq(balanceReservations.id, reservationId),
        eq(balanceReservations.applicationId, applicationId),
      ),
    )
    .limit(1);
  if (!row) throw new ReservationNotFoundError(reservationId);
  const reservation = row.reservation;
  return {
    reservationId: reservation.id,
    rxlabUserId: row.rxlabUserId,
    unit: row.unit,
    initialAmount: reservation.initialAmount,
    remainingReserved: reservation.amount,
    status: reservation.status,
    description: reservation.description,
    metadata: reservation.metadata,
    requestedAmount: reservation.requestedAmount,
    settledAmount: reservation.settledAmount,
    shortfallAmount: reservation.shortfallAmount,
    releasedAmount: reservation.releasedAmount,
    available: row.balanceAmount - row.balanceReserved,
    balanceAfter: reservation.balanceAfter,
    expiresAt: iso(reservation.expiresAt),
    releaseReason: reservation.releaseReason,
    entryId: reservation.entryId,
    createdAt: iso(reservation.createdAt),
    updatedAt: iso(reservation.updatedAt),
    closedAt: reservation.closedAt ? iso(reservation.closedAt) : null,
  };
}

export async function getBalanceReservationByIdempotencyKey(
  applicationId: string,
  idempotencyKey: string,
) {
  const reservation = await findReservationByKey(applicationId, idempotencyKey);
  if (!reservation) throw new ReservationNotFoundError(idempotencyKey);
  return getBalanceReservation(applicationId, reservation.id);
}
