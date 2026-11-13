import { afterEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/db", () => ({ db: {
  select: () => {
    let table: unknown;
    const query = {
      from: (value: unknown) => { table = value; return query; },
      innerJoin: () => query, leftJoin: () => query,
      where: async () => table === subscriptions ? m.rows : [],
    };
    return query;
  },
} }));
import { subscriptions } from "@/lib/db/schema";
import { getApplicationAnalytics } from "./analytics";

afterEach(() => vi.useRealTimers());

it("uses the same cancellation classification for dashboard totals and daily bars", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T00:00:00Z`);
  const base = { appUserId: "user", planGroup: "default", autoSubscribe: false,
    planPriceAmountCents: 2000, priceAmountCents: 2000, currency: "usd",
    billingInterval: "month", intervalCount: 1, planName: "Pro" };
  m.rows = [
    { ...base, id: "free", planPriceAmountCents: 0, autoSubscribe: true,
      status: "canceled", startedAt: at(1), endedAt: at(10) },
    { ...base, id: "pro", status: "canceled", startedAt: at(10), endedAt: at(11) },
    { ...base, id: "plus", status: "canceled", startedAt: at(11), endedAt: at(12) },
    { ...base, id: "free-again", planPriceAmountCents: 0, autoSubscribe: true,
      status: "active", startedAt: at(12), endedAt: null },
  ];
  const result = await getApplicationAnalytics("app", { days: 7 });
  expect(result.totals.canceledSubscriptions).toBe(1);
  expect(result.series.canceledSubscriptions.points.filter((point) => point.y > 0)).toEqual([
    { x: "2026-11-12", y: 1 },
  ]);
});
