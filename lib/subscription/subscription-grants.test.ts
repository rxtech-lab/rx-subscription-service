import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  grants: [] as Record<string, unknown>[],
  ledger: new Map<string, { id: string; delta: number; idempotencyKey: string }>(),
  credit: vi.fn(),
}));
vi.mock("./users", () => ({ creditBalance: mocks.credit }));
vi.mock("./balance-lots", () => ({ stampLotsForPlanEnd: vi.fn() }));
vi.mock("./plans", () => ({ requirePlan: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  select: () => {
    let table: unknown;
    let condition: SQL;
    const query = {
      from: (value: unknown) => { table = value; return query; },
      where: (value: SQL) => { condition = value; return query; },
      limit: () => query,
      then: (resolve: (rows: unknown[]) => unknown) => {
        const keys = condition ? new PgDialect().sqlToQuery(condition).params : [];
        const rows = table === planEntitlements ? mocks.grants
          : [...mocks.ledger.values()].filter((row) => keys.includes(row.idempotencyKey));
        return Promise.resolve(rows).then(resolve);
      },
    };
    return query;
  },
} }));

import { planEntitlements } from "@/lib/db/schema";
import { grantPeriodBalances } from "./subscriptions";

const oldGrant = { kind: "balance_grant", unitId: "points", amount: 100, trialAmount: 100 };
const renewal = {
  applicationId: "app", appUserId: "user", planId: "plan", subscriptionId: "sub",
  periodKey: "period-1", periodEnd: new Date("2026-10-07T00:00:00Z"), status: "active",
  entitlements: [oldGrant],
};

beforeEach(() => {
  mocks.grants = [{ ...oldGrant, amount: 1000, trialAmount: 1000, balanceExpiryPolicy: "period_end" }];
  mocks.ledger.clear(); vi.clearAllMocks();
  mocks.credit.mockImplementation(async (input) => {
    const existing = mocks.ledger.get(input.idempotencyKey);
    if (existing) return { entry: existing, duplicate: true };
    const entry = { id: String(mocks.ledger.size), delta: input.amount, idempotencyKey: input.idempotencyKey };
    mocks.ledger.set(input.idempotencyKey, entry);
    return { entry, duplicate: false };
  });
});

it.each(["plan_grant", "apple_plan_grant", "internal_plan_grant"])("uses current recurring grants for %s despite an old snapshot", async (idempotencyPrefix) => {
  await grantPeriodBalances({ ...renewal, idempotencyPrefix });
  expect(mocks.credit).toHaveBeenCalledWith(expect.objectContaining({
    amount: 1000, expiryPolicy: "period_end", expiresAt: renewal.periodEnd,
    subscriptionId: "sub", idempotencyKey: `${idempotencyPrefix}:user:plan:points:period-1`,
  }), expect.anything());
});

it("does not replay an already credited period after changing its amount", async () => {
  await grantPeriodBalances(renewal);
  mocks.grants = [{ ...oldGrant, amount: 2000, trialAmount: 2000 }];
  expect(await grantPeriodBalances(renewal)).toMatchObject([{ duplicate: true }]);
  await grantPeriodBalances({ ...renewal, periodKey: "period-2" });
  expect([...mocks.ledger.values()].map((row) => row.delta)).toEqual([1000, 2000]);
});

it.each([false, true])("does not duplicate a period when editing trial amounts changes the key format (was distinct: %s)", async (wasDistinct) => {
  mocks.grants = [{ ...oldGrant, amount: 1000, trialAmount: wasDistinct ? 100 : 1000 }];
  await grantPeriodBalances(renewal);
  mocks.grants = [{ ...oldGrant, amount: 2000, trialAmount: wasDistinct ? 2000 : 100 }];
  expect(await grantPeriodBalances(renewal)).toMatchObject([{ duplicate: true }]);
  expect(mocks.ledger.size).toBe(1);
});

it("retains separate trial and paid grants when their period anchor is shared", async () => {
  mocks.grants = [{ ...oldGrant, amount: 1000, trialAmount: 100 }];
  await grantPeriodBalances({ ...renewal, status: "trialing" });
  await grantPeriodBalances(renewal);
  expect([...mocks.ledger.values()].map((row) => row.delta)).toEqual([100, 1000]);
});

it("uses zero trial grants and picks up added or removed balance units for future periods", async () => {
  mocks.grants = [{ ...oldGrant, amount: 1000, trialAmount: 0 }];
  expect(await grantPeriodBalances({ ...renewal, status: "trialing" })).toEqual([]);
  mocks.grants = [{ kind: "balance_grant", unitId: "tokens", amount: 500 }];
  await grantPeriodBalances(renewal);
  expect(mocks.credit).toHaveBeenCalledWith(expect.objectContaining({ unitId: "tokens", amount: 500 }), expect.anything());
  mocks.grants = [];
  expect(await grantPeriodBalances({ ...renewal, periodKey: "period-2" })).toEqual([]);
});

it("preserves one-time purchased balance grants", async () => {
  await grantPeriodBalances({ ...renewal, subscriptionId: null });
  expect(mocks.credit).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, subscriptionId: null }), expect.anything());
});
