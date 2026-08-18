import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { dropIncompleteToolCalls } from "./messages";

function assistant(parts: UIMessage["parts"]): UIMessage {
  return { id: "m1", role: "assistant", parts };
}

describe("dropIncompleteToolCalls", () => {
  it("removes tool calls that never got a result", () => {
    const [message] = dropIncompleteToolCalls([
      assistant([
        { type: "text", text: "Creating the plan" },
        {
          type: "tool-createPlan",
          toolCallId: "call-1",
          state: "input-available",
          input: { name: "Pro" },
        },
      ] as UIMessage["parts"]),
    ]);

    expect(message.parts).toHaveLength(1);
    expect(message.parts[0].type).toBe("text");
  });

  it("keeps completed calls and calls waiting on an approval", () => {
    const parts = [
      {
        type: "tool-createPlan",
        toolCallId: "call-1",
        state: "output-available",
        input: { name: "Pro" },
        output: { ok: true },
      },
      {
        type: "tool-createTopup",
        toolCallId: "call-2",
        state: "approval-requested",
        input: { name: "Points" },
        approval: { id: "approval-1" },
      },
    ] as UIMessage["parts"];

    expect(dropIncompleteToolCalls([assistant(parts)])[0].parts).toHaveLength(2);
  });

  it("drops messages left without any parts", () => {
    const messages = dropIncompleteToolCalls([
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
      assistant([
        {
          type: "tool-createPlan",
          toolCallId: "call-1",
          state: "input-streaming",
          input: undefined,
        },
      ] as UIMessage["parts"]),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });
});
