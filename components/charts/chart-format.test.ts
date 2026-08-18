import { describe, expect, it } from "vitest";
import {
  barPath,
  formatCents,
  formatCompact,
  formatDateLabel,
  formatTick,
  niceTicks,
  seriesColor,
  SERIES_COLORS,
  tickIndexes,
} from "./chart-format";

describe("formatCompact", () => {
  it("keeps small numbers exact and shortens large ones", () => {
    expect(formatCompact(1_284)).toBe("1,284");
    expect(formatCompact(12_900)).toBe("12.9K");
    expect(formatCompact(4_200_000)).toBe("4.2M");
    expect(formatCompact(-12_900)).toBe("-12.9K");
  });
});

describe("formatCents", () => {
  it("drops decimals past a hundred units", () => {
    expect(formatCents(421_000)).toBe("$4,210");
    expect(formatCents(999)).toBe("$9.99");
    expect(formatCents(0)).toBe("$0");
  });

  it("survives an unknown currency code", () => {
    expect(formatCents(1_000, "zzz")).toContain("ZZZ");
  });
});

describe("formatTick", () => {
  it("renders currency ticks as a compact symbol and amount", () => {
    expect(formatTick(1_250_000, "currency", "usd")).toBe("$12.5K");
    expect(formatTick(0, "currency", "usd")).toBe("$0");
  });

  it("leaves plain numbers compact", () => {
    expect(formatTick(2_000)).toBe("2,000");
  });
});

describe("niceTicks", () => {
  it("rounds to 1/2/5 steps", () => {
    expect(niceTicks(2_274)).toEqual([0, 1_000, 2_000, 3_000]);
    expect(niceTicks(8)).toEqual([0, 2, 4, 6, 8]);
  });

  it("spans zero when values go negative", () => {
    const ticks = niceTicks(100, -100);
    expect(ticks[0]).toBeLessThanOrEqual(-100);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(100);
    expect(ticks).toContain(0);
  });

  it("still produces an axis for a flat series", () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });
});

describe("tickIndexes", () => {
  it("returns every index when they all fit", () => {
    expect(tickIndexes(4, 6)).toEqual([0, 1, 2, 3]);
  });

  it("keeps the first and last when thinning a long axis", () => {
    const indexes = tickIndexes(90, 5);
    expect(indexes[0]).toBe(0);
    expect(indexes[indexes.length - 1]).toBe(89);
    expect(indexes.length).toBeLessThanOrEqual(5);
  });
});

describe("seriesColor", () => {
  it("assigns slots in fixed order and never cycles", () => {
    expect(seriesColor(0)).toBe(SERIES_COLORS[0]);
    expect(seriesColor(1)).toBe(SERIES_COLORS[1]);
    expect(seriesColor(99)).toBe(SERIES_COLORS[SERIES_COLORS.length - 1]);
  });
});

describe("formatDateLabel", () => {
  it("shortens ISO dates and leaves other labels alone", () => {
    expect(formatDateLabel("2026-08-18")).toBe("Aug 18");
    expect(formatDateLabel("Pro plan")).toBe("Pro plan");
  });
});

describe("barPath", () => {
  it("never rounds more than half the bar", () => {
    const path = barPath(0, 0, 10, 1, 4, "up");
    expect(path).toContain("Q0,0 1,0");
  });

  it("starts a column at its baseline", () => {
    expect(barPath(5, 10, 12, 40, 4, "up").startsWith("M5,50")).toBe(true);
  });
});
