import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  findLatestPendingApproval,
  latestUserTextAfter,
} from "./assistant-approval-state";

function pendingAssistant(state: "approval-requested" | "approval-responded") {
  return {
    id: "assistant-approval",
    role: "assistant",
    parts: [
      {
        type: "tool-createPlan",
        toolCallId: "call-1",
        state,
        input: { name: "Pro" },
        approval: {
          id: "approval-1",
          ...(state === "approval-responded" ? { approved: true } : {}),
        },
      },
    ],
  } as UIMessage;
}

describe("assistant approval recovery", () => {
  it("finds a stuck approval behind a failed follow-up message", () => {
    const messages: UIMessage[] = [
      pendingAssistant("approval-responded"),
      {
        id: "failed-user-message",
        role: "user",
        parts: [{ type: "text", text: "What happened?" }],
      },
    ];

    expect(findLatestPendingApproval(messages)).toEqual({
      messageId: "assistant-approval",
      messageIndex: 0,
    });
    expect(latestUserTextAfter(messages, 0)).toBe("What happened?");
  });

  it("finds an approval that still needs a decision", () => {
    expect(findLatestPendingApproval([pendingAssistant("approval-requested")]))
      .toEqual({ messageId: "assistant-approval", messageIndex: 0 });
  });

  it("ignores completed tool calls", () => {
    const messages = [
      {
        ...pendingAssistant("approval-responded"),
        parts: [
          {
            type: "tool-createPlan",
            toolCallId: "call-1",
            state: "output-available",
            input: { name: "Pro" },
            output: { ok: true },
            approval: { id: "approval-1", approved: true },
          },
        ],
      } as UIMessage,
    ];

    expect(findLatestPendingApproval(messages)).toBeNull();
  });
});
