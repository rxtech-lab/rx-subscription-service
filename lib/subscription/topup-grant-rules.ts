/**
 * What a topup's bonus grants credit and how the catalog describes them,
 * decided without touching the database.
 *
 * Stripe, the App Store, and the test harness all fulfil through here, so a
 * bonus is keyed, described, and referenced the same way whichever store sold
 * the pack. Free of `server-only` so the arithmetic is unit-testable on its own.
 */

export interface TopupGrantLike {
  unitId: string;
  amount: number;
}

interface UnitLike {
  key: string;
  name: string;
}

/** One bonus grant as `GET /api/v1/catalog` lists it. */
export interface CatalogTopupGrant {
  unit: string;
  name: string;
  amount: number;
}

/** The ledger credit one bonus grant turns into. */
export interface TopupGrantCredit {
  unitId: string;
  amount: number;
  kind: "topup";
  description: string;
  idempotencyKey: string;
}

/**
 * The credits a fulfilled pack's bonuses add, `quantity` packs at a time.
 *
 * Each key is the primary credit's key plus the unit, so a replayed webhook or
 * a re-sent App Store transaction is a no-op per bonus exactly as it is for the
 * pack itself. Grants are ordered by unit so the credits land deterministically.
 */
export function topupGrantCredits(input: {
  grants: TopupGrantLike[];
  quantity: number;
  productName: string;
  /** The primary credit's idempotency key, e.g. `topup:<purchaseId>`. */
  idempotencyPrefix: string;
}): TopupGrantCredit[] {
  const quantity = Math.max(1, Math.trunc(input.quantity));
  return [...input.grants]
    .sort((a, b) => a.unitId.localeCompare(b.unitId))
    .map((grant) => ({
      unitId: grant.unitId,
      amount: grant.amount * quantity,
      kind: "topup" as const,
      description: `Topup bonus — ${input.productName}`,
      idempotencyKey: `${input.idempotencyPrefix}:grant:${grant.unitId}`,
    }))
    .filter((credit) => credit.amount > 0);
}

/**
 * A pack's bonuses for the catalog. A grant whose unit is missing from the map
 * is dropped rather than sent with a null key the client could not render.
 */
export function catalogTopupGrants(
  grants: TopupGrantLike[],
  unitsById: Map<string, UnitLike>,
): CatalogTopupGrant[] {
  return grants.flatMap((grant) => {
    const unit = unitsById.get(grant.unitId);
    return unit ? [{ unit: unit.key, name: unit.name, amount: grant.amount }] : [];
  });
}

/** Group grant rows by pack so a list of topups loads its bonuses in one query. */
export function grantsByTopup<T extends { topupProductId: string }>(
  grants: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const grant of grants) {
    const list = grouped.get(grant.topupProductId);
    if (list) list.push(grant);
    else grouped.set(grant.topupProductId, [grant]);
  }
  return grouped;
}
