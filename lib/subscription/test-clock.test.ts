import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  MAX_CLOCK_OFFSET_MS,
  clampClockOffset,
  describeClockOffset,
  offsetForTime,
  simulatedNow,
} from "./test-clock";

const REAL_NOW = new Date("2026-08-18T12:00:00.000Z");

describe("simulatedNow", () => {
  it("returns real time when the user is not time travelling", () => {
    expect(simulatedNow(0, REAL_NOW)).toBe(REAL_NOW);
  });

  it("shifts forward and backward", () => {
    expect(simulatedNow(DAY_MS, REAL_NOW).toISOString()).toBe(
      "2026-08-19T12:00:00.000Z",
    );
    expect(simulatedNow(-2 * HOUR_MS, REAL_NOW).toISOString()).toBe(
      "2026-08-18T10:00:00.000Z",
    );
  });

  it("refuses to be pushed past the cap", () => {
    expect(simulatedNow(Number.MAX_SAFE_INTEGER, REAL_NOW).getTime()).toBe(
      REAL_NOW.getTime() + MAX_CLOCK_OFFSET_MS,
    );
  });
});

describe("offsetForTime", () => {
  it("is the difference from real time", () => {
    const target = new Date("2026-08-20T12:00:00.000Z");
    expect(offsetForTime(target, REAL_NOW)).toBe(2 * DAY_MS);
  });

  it("round-trips through simulatedNow", () => {
    const target = new Date("2026-09-01T08:30:00.000Z");
    const offset = offsetForTime(target, REAL_NOW);
    expect(simulatedNow(offset, REAL_NOW).toISOString()).toBe(target.toISOString());
  });
});

describe("clampClockOffset", () => {
  it("treats a nonsense value as real time rather than a huge jump", () => {
    expect(clampClockOffset(Number.NaN)).toBe(0);
    expect(clampClockOffset(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("clamps a merely enormous value to the cap", () => {
    expect(clampClockOffset(Number.MAX_VALUE)).toBe(MAX_CLOCK_OFFSET_MS);
    expect(clampClockOffset(-Number.MAX_VALUE)).toBe(-MAX_CLOCK_OFFSET_MS);
  });

  it("keeps whole milliseconds", () => {
    expect(clampClockOffset(1_500.9)).toBe(1_500);
  });
});

describe("describeClockOffset", () => {
  it("names real time", () => {
    expect(describeClockOffset(0)).toBe("real time");
  });

  it("uses the two largest units, and no more", () => {
    expect(describeClockOffset(DAY_MS)).toBe("1 day ahead");
    expect(describeClockOffset(2 * DAY_MS + 3 * HOUR_MS + 4 * 60_000)).toBe(
      "2 days 3 hours ahead",
    );
    expect(describeClockOffset(-90 * 60_000)).toBe("1 hour 30 minutes behind");
  });

  it("does not round a small shift away to nothing", () => {
    expect(describeClockOffset(5_000)).toBe("less than a minute ahead");
  });
});
