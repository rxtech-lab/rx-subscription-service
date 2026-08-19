import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { testRunIdsInMessages } from "./test-run-parts";

function assistant(parts: unknown[]): UIMessage {
  return { id: "m", role: "assistant", parts: parts as UIMessage["parts"] };
}

function runPart(runId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "tool-runTestSuite",
    state: "output-available",
    output: { ok: true, result: { runId, suiteName: "Subscription lifecycle" } },
    ...overrides,
  };
}

describe("testRunIdsInMessages", () => {
  it("finds the runs a transcript shows a card for", () => {
    expect(
      testRunIdsInMessages([
        assistant([{ type: "text", text: "Running it now." }, runPart("run-a")]),
        assistant([runPart("run-b")]),
      ]),
    ).toEqual(["run-a", "run-b"]);
  });

  it("keeps each run once, in the order it first appears", () => {
    expect(
      testRunIdsInMessages([assistant([runPart("run-a"), runPart("run-a")])]),
    ).toEqual(["run-a"]);
  });

  it("ignores a call that has not produced a run", () => {
    expect(
      testRunIdsInMessages([
        assistant([runPart("run-a", { state: "input-available" })]),
        assistant([runPart("run-b", { output: { ok: false } })]),
        assistant([{ type: "tool-createPlan", state: "output-available", output: {} }]),
      ]),
    ).toEqual([]);
  });

  it("survives a message with no parts", () => {
    expect(testRunIdsInMessages([{ id: "m", role: "user" } as UIMessage])).toEqual([]);
  });
});
