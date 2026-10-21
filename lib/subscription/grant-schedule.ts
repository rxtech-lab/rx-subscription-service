import type { BalanceGrantInterval } from "@/lib/db/schema/plans";

export function grantIntervalDays(interval?: BalanceGrantInterval | null, days?: number | null) {
  if (interval === "day") return 1;
  if (interval === "week") return 7;
  if (interval === "custom_days" && Number.isSafeInteger(days) && days! >= 1 && days! <= 3650) return days!;
  return null;
}

export function balanceGrantScheduleLabel(grant: { balanceGrantInterval?: BalanceGrantInterval | null; balanceGrantIntervalDays?: number | null }) {
  const days = grantIntervalDays(grant.balanceGrantInterval, grant.balanceGrantIntervalDays);
  return days === null ? "period" : days === 1 ? "day" : days === 7 ? "week" : `${days} days`;
}

/** Fixed UTC durations, clipped to the billing window; no grant at its end. */
export function dueGrantInstants(input: {
  periodStart: Date; periodEnd: Date; now: Date; days: number; configuredAt?: Date;
}) {
  const start = input.periodStart.getTime();
  const end = input.periodEnd.getTime();
  const step = input.days * 86_400_000;
  if (![start, end, step, input.now.getTime()].every(Number.isFinite) || step <= 0 || end <= start) return [];
  const first = Math.max(0, Math.ceil(((input.configuredAt?.getTime() ?? start) - start) / step));
  const last = Math.min(Math.floor((input.now.getTime() - start) / step), Math.ceil((end - start) / step) - 1);
  if (last - first > 10000) throw new Error("Balance grant schedule exceeds 10000 intervals");
  const result: Date[] = [];
  for (let index = first; index <= last; index++) result.push(new Date(start + index * step));
  return result;
}
