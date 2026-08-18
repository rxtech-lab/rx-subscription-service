import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { completedWriteToolCallIds } from "./assistant-data-changes";

function assistant(parts: unknown[]): UIMessage {
  return {
    id: "m1",
    role: "assistant",
    parts: parts as UIMessage["parts"],
  };
}

describe("completedWriteToolCallIds", () => {
  it("reports an approved write that succeeded", () => {
    expect(
      completedWriteToolCallIds([
        assistant([
          {
            type: "tool-createPlan",
            toolCallId: "call-1",
            state: "output-available",
            approval: { id: "approval-1", approved: true },
            output: { ok: true, id: "plan_1" },
          },
        ]),
      ]),
    ).toEqual(["call-1"]);
  });

  it("ignores reads, confirmations, and unfinished writes", () => {
    expect(
      completedWriteToolCallIds([
        assistant([
          {
            type: "tool-listPlans",
            toolCallId: "call-1",
            state: "output-available",
            output: { ok: true, plans: [] },
          },
          {
            type: "tool-confirmation",
            toolCallId: "call-2",
            state: "output-available",
            approval: { id: "approval-1", approved: true },
            output: { ok: true },
          },
          {
            type: "tool-updatePlan",
            toolCallId: "call-3",
            state: "approval-requested",
            approval: { id: "approval-2" },
          },
        ]),
      ]),
    ).toEqual([]);
  });

  it("ignores writes that failed or were rejected", () => {
    expect(
      completedWriteToolCallIds([
        assistant([
          {
            type: "tool-createRole",
            toolCallId: "call-1",
            state: "output-available",
            approval: { id: "approval-1", approved: true },
            output: { ok: false, error: "Role already exists" },
          },
          {
            type: "tool-createPermission",
            toolCallId: "call-2",
            state: "output-denied",
            approval: { id: "approval-2", approved: false },
          },
          {
            type: "tool-createTopup",
            toolCallId: "call-3",
            state: "output-error",
            approval: { id: "approval-3", approved: true },
            errorText: "boom",
          },
        ]),
      ]),
    ).toEqual([]);
  });
});
