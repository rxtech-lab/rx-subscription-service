import { describe, expect, it } from "vitest";
import { drainLines, parseRunLine, PROTOCOL_VERSION } from "./protocol";

const marked = (event: Record<string, unknown>) =>
  JSON.stringify({ rxtest: PROTOCOL_VERSION, ...event });

describe("parseRunLine", () => {
  it("reads a protocol event", () => {
    const event = parseRunLine(
      marked({
        type: "test:end",
        suite: "Topups",
        test: "buys a pack",
        position: 0,
        status: "passed",
        durationMs: 12,
        error: null,
        steps: [],
      }),
    );

    expect(event).toMatchObject({
      type: "test:end",
      test: "buys a pack",
      status: "passed",
      durationMs: 12,
    });
  });

  it("keeps a suite's own console output instead of dropping it", () => {
    expect(parseRunLine("balance is 700")).toEqual({
      type: "log",
      stream: "stdout",
      message: "balance is 700",
    });
  });

  it("carries the stream a line arrived on", () => {
    expect(parseRunLine("boom", "stderr")).toEqual({
      type: "log",
      stream: "stderr",
      message: "boom",
    });
  });

  it("treats an unmarked JSON line as output, not as an event", () => {
    // A suite printing JSON must not be able to fabricate a result.
    const line = JSON.stringify({ type: "run:end", total: 99, passed: 99 });
    expect(parseRunLine(line)).toEqual({
      type: "log",
      stream: "stdout",
      message: line,
    });
  });

  it("falls back to output when a marked line does not match its schema", () => {
    const line = marked({ type: "test:end", suite: "A" });
    expect(parseRunLine(line)).toMatchObject({ type: "log" });
  });

  it("ignores blank lines", () => {
    expect(parseRunLine("   ")).toBeNull();
  });
});

describe("drainLines", () => {
  it("returns complete lines and keeps the unfinished tail", () => {
    expect(drainLines("one\ntwo\nthr")).toEqual({
      lines: ["one", "two"],
      rest: "thr",
    });
  });

  it("holds everything back until a newline arrives", () => {
    expect(drainLines("partial")).toEqual({ lines: [], rest: "partial" });
  });
});
