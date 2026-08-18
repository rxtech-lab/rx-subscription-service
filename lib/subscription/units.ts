import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { balanceUnits, pointRates } from "@/lib/db/schema";
import {
  assertCurrency,
  assertKey,
  assertNonNegativeInteger,
  assertPositiveInteger,
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";

export const NANO = 1_000_000_000;

export async function listBalanceUnits(applicationId: string) {
  return db
    .select()
    .from(balanceUnits)
    .where(eq(balanceUnits.applicationId, applicationId))
    .orderBy(asc(balanceUnits.key));
}

export async function getBalanceUnit(applicationId: string, unitId: string) {
  const [unit] = await db
    .select()
    .from(balanceUnits)
    .where(
      and(eq(balanceUnits.id, unitId), eq(balanceUnits.applicationId, applicationId)),
    )
    .limit(1);
  return unit ?? null;
}

export async function getBalanceUnitByKey(applicationId: string, key: string) {
  const [unit] = await db
    .select()
    .from(balanceUnits)
    .where(
      and(
        eq(balanceUnits.applicationId, applicationId),
        eq(balanceUnits.key, key.trim().toLowerCase()),
      ),
    )
    .limit(1);
  return unit ?? null;
}

export async function requireBalanceUnit(applicationId: string, unitId: string) {
  const unit = await getBalanceUnit(applicationId, unitId);
  if (!unit) throw new NotFoundError("balance unit", unitId);
  return unit;
}

export async function createBalanceUnit(input: {
  applicationId: string;
  key: string;
  name: string;
  symbol?: string | null;
  precision?: number;
  kind?: "points" | "currency" | "custom";
  actor: Actor;
}) {
  const key = assertKey(input.key);
  const precision = assertNonNegativeInteger(input.precision ?? 0, "precision");
  if (precision > 9) throw new ValidationError("precision must be 9 or less");
  if (!input.name.trim()) throw new ValidationError("name is required");

  if (await getBalanceUnitByKey(input.applicationId, key)) {
    throw new ValidationError(`a balance unit with key "${key}" already exists`);
  }

  const now = new Date();
  const [unit] = await db
    .insert(balanceUnits)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      key,
      name: input.name.trim(),
      symbol: input.symbol?.trim() || null,
      precision,
      kind: input.kind ?? "points",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "balance_unit.create",
    entityType: "balance_unit",
    entityId: unit.id,
    after: unit,
  });
  return unit;
}

export async function updateBalanceUnit(input: {
  applicationId: string;
  unitId: string;
  name?: string;
  symbol?: string | null;
  actor: Actor;
}) {
  const before = await requireBalanceUnit(input.applicationId, input.unitId);
  const [unit] = await db
    .update(balanceUnits)
    .set({
      name: input.name?.trim() || before.name,
      symbol:
        input.symbol === undefined ? before.symbol : input.symbol?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(balanceUnits.id, input.unitId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "balance_unit.update",
    entityType: "balance_unit",
    entityId: unit.id,
    before,
    after: unit,
  });
  return unit;
}

export async function deleteBalanceUnit(input: {
  applicationId: string;
  unitId: string;
  actor: Actor;
}) {
  const before = await requireBalanceUnit(input.applicationId, input.unitId);
  await db.delete(balanceUnits).where(eq(balanceUnits.id, input.unitId));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "balance_unit.delete",
    entityType: "balance_unit",
    entityId: input.unitId,
    before,
  });
}

export async function listPointRates(applicationId: string) {
  return db
    .select()
    .from(pointRates)
    .where(eq(pointRates.applicationId, applicationId));
}

/**
 * Set what one balance unit is worth in a currency.
 *
 * Callers think in "N units cost M cents", which is the shape the console and
 * the assistant both use; the stored value is the exact integer rate in
 * billionths of a minor currency unit. 1000 points for 150 cents becomes
 * 150,000,000 — no floating point anywhere in the conversion.
 */
export async function setPointRate(input: {
  applicationId: string;
  unitId: string;
  currency: string;
  units: number;
  amountMinor: number;
  actor: Actor;
}) {
  await requireBalanceUnit(input.applicationId, input.unitId);
  const currency = assertCurrency(input.currency);
  const units = assertPositiveInteger(input.units, "units");
  const amountMinor = assertPositiveInteger(input.amountMinor, "amountMinor");

  const nanoMinorPerUnit = Math.round((amountMinor * NANO) / units);
  if (nanoMinorPerUnit <= 0) {
    throw new ValidationError("rate rounds to zero — use a larger amount");
  }

  const now = new Date();
  const [existing] = await db
    .select()
    .from(pointRates)
    .where(and(eq(pointRates.unitId, input.unitId), eq(pointRates.currency, currency)))
    .limit(1);

  const [rate] = existing
    ? await db
        .update(pointRates)
        .set({ nanoMinorPerUnit, updatedAt: now })
        .where(eq(pointRates.id, existing.id))
        .returning()
    : await db
        .insert(pointRates)
        .values({
          id: newId(),
          applicationId: input.applicationId,
          unitId: input.unitId,
          currency,
          nanoMinorPerUnit,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "point_rate.set",
    entityType: "point_rate",
    entityId: rate.id,
    before: existing ?? null,
    after: rate,
  });
  return rate;
}

/** Money value of `units`, in minor currency units, rounded up. */
export function unitsToMinor(units: number, nanoMinorPerUnit: number): number {
  return Math.ceil((units * nanoMinorPerUnit) / NANO);
}

/** How many whole units `amountMinor` buys, rounded down. */
export function minorToUnits(amountMinor: number, nanoMinorPerUnit: number): number {
  return Math.floor((amountMinor * NANO) / nanoMinorPerUnit);
}
