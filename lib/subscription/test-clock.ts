/**
 * The simulated clock a test user lives on.
 *
 * Usage periods and coupon validity windows are resolved by arithmetic on
 * `now` — nothing waits on a background timer — so moving one user's `now`
 * forward is the whole of time travel: a daily allowance can roll over, or a
 * scheduled coupon can start or expire, in a second rather than a day.
 *
 * Kept pure and free of `server-only` so the arithmetic is unit-testable, and
 * because both the storefront and the console need to describe an offset.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** A day either side of a decade — enough to test any reset policy, and a cap
 * that keeps a mistyped date from producing a nonsense timestamp. */
export const MAX_CLOCK_OFFSET_MS = 3_650 * DAY_MS;

export function clampClockOffset(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0;
  const rounded = Math.trunc(offsetMs);
  if (rounded > MAX_CLOCK_OFFSET_MS) return MAX_CLOCK_OFFSET_MS;
  if (rounded < -MAX_CLOCK_OFFSET_MS) return -MAX_CLOCK_OFFSET_MS;
  return rounded;
}

/** What time it is for a user carrying this offset. */
export function simulatedNow(offsetMs: number, realNow: Date = new Date()): Date {
  return offsetMs === 0
    ? realNow
    : new Date(realNow.getTime() + clampClockOffset(offsetMs));
}

/** The offset that puts a user's clock at `target`. */
export function offsetForTime(target: Date, realNow: Date = new Date()): number {
  return clampClockOffset(target.getTime() - realNow.getTime());
}

/**
 * A short, human description of an offset: "2 days 3 hours ahead". Rounded down
 * to the minute — the exact millisecond is never what the reader wants.
 */
export function describeClockOffset(offsetMs: number): string {
  const offset = clampClockOffset(offsetMs);
  if (offset === 0) return "real time";

  const direction = offset > 0 ? "ahead" : "behind";
  let remaining = Math.abs(offset);

  const parts: string[] = [];
  for (const [unit, size] of [
    ["day", DAY_MS],
    ["hour", HOUR_MS],
    ["minute", 60_000],
  ] as const) {
    const value = Math.floor(remaining / size);
    remaining -= value * size;
    if (value > 0) parts.push(`${value} ${unit}${value === 1 ? "" : "s"}`);
    if (parts.length === 2) break;
  }
  if (parts.length === 0) return `less than a minute ${direction}`;

  return `${parts.join(" ")} ${direction}`;
}
