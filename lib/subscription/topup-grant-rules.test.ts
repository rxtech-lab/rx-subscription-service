import { describe, expect, it } from "vitest";
import {
  catalogTopupGrants,
  grantsByTopup,
  topupGrantCredits,
} from "./topup-grant-rules";

const GOLD = { unitId: "unit_gold", amount: 500 };
const GEMS = { unitId: "unit_gems", amount: 3 };

describe("topupGrantCredits", () => {
  it("keys each bonus off the primary credit's key and unit", () => {
    expect(
      topupGrantCredits({
        grants: [GOLD],
        quantity: 1,
        productName: "5,000 points",
        idempotencyPrefix: "topup:purchase_1",
      }),
    ).toEqual([
      {
        unitId: "unit_gold",
        amount: 500,
        kind: "topup",
        description: "Topup bonus — 5,000 points",
        idempotencyKey: "topup:purchase_1:grant:unit_gold",
      },
    ]);
  });

  it("multiplies by quantity and orders by unit", () => {
    const credits = topupGrantCredits({
      grants: [GOLD, GEMS],
      quantity: 3,
      productName: "Pack",
      idempotencyPrefix: "apple:topup:2000000123",
    });
    expect(credits.map(({ unitId, amount, idempotencyKey }) => ({ unitId, amount, idempotencyKey }))).toEqual([
      { unitId: "unit_gems", amount: 9, idempotencyKey: "apple:topup:2000000123:grant:unit_gems" },
      { unitId: "unit_gold", amount: 1500, idempotencyKey: "apple:topup:2000000123:grant:unit_gold" },
    ]);
  });

  it("treats a missing or nonsensical quantity as one pack", () => {
    const [credit] = topupGrantCredits({
      grants: [GOLD],
      quantity: 0,
      productName: "Pack",
      idempotencyPrefix: "topup:p",
    });
    expect(credit.amount).toBe(500);
  });

  it("credits nothing for a pack without bonuses", () => {
    expect(
      topupGrantCredits({ grants: [], quantity: 2, productName: "Pack", idempotencyPrefix: "topup:p" }),
    ).toEqual([]);
  });
});

describe("catalogTopupGrants", () => {
  const units = new Map([
    ["unit_gold", { key: "gold", name: "Gold" }],
    ["unit_gems", { key: "gems", name: "Gems" }],
  ]);

  it("names each bonus by unit key and display name", () => {
    expect(catalogTopupGrants([GOLD, GEMS], units)).toEqual([
      { unit: "gold", name: "Gold", amount: 500 },
      { unit: "gems", name: "Gems", amount: 3 },
    ]);
  });

  it("drops a grant whose unit is unknown", () => {
    expect(catalogTopupGrants([{ unitId: "unit_gone", amount: 1 }], units)).toEqual([]);
  });
});

describe("grantsByTopup", () => {
  it("groups rows by pack, preserving order", () => {
    const rows = [
      { topupProductId: "a", unitId: "x", amount: 1 },
      { topupProductId: "b", unitId: "y", amount: 2 },
      { topupProductId: "a", unitId: "z", amount: 3 },
    ];
    const grouped = grantsByTopup(rows);
    expect(grouped.get("a")).toEqual([rows[0], rows[2]]);
    expect(grouped.get("b")).toEqual([rows[1]]);
    expect(grouped.get("c")).toBeUndefined();
  });
});
