import type { ModelMessage } from "ai";
import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compactionModel,
  compactionThreshold,
  createContextCompactor,
  estimateTokens,
  renderTranscript,
  safeCutIndex,
} from "./compaction";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(async () => ({ text: "SUMMARY" })),
}));

const mockedGenerateText = vi.mocked(generateText);

function user(text: string): ModelMessage {
  return { role: "user", content: text };
}

function assistantCall(toolName: string, id: string): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: id, toolName, input: { a: 1 } }],
  };
}

function toolResult(toolName: string, id: string): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName,
        output: { type: "json", value: { ok: true } },
      },
    ],
  };
}

/** A message list long and heavy enough to cross any sane threshold. */
function bulkyHistory(turns: number): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let index = 0; index < turns; index++) {
    messages.push(user(`question ${index} ${"x".repeat(6_000)}`));
    messages.push(assistantCall("listPlans", `call-${index}`));
    messages.push(toolResult("listPlans", `call-${index}`));
    messages.push({ role: "assistant", content: `answer ${index}` });
  }
  return messages;
}

beforeEach(() => {
  mockedGenerateText.mockClear();
  mockedGenerateText.mockResolvedValue({ text: "SUMMARY" } as never);
});

afterEach(() => {
  delete process.env.AI_COMPACT_MODEL;
  delete process.env.AI_COMPACT_THRESHOLD_TOKENS;
});

describe("configuration", () => {
  it("defaults to a 50k threshold and the chat model", () => {
    expect(compactionThreshold()).toBe(50_000);
    expect(compactionModel("anthropic/claude-sonnet-5")).toBe(
      "anthropic/claude-sonnet-5",
    );
  });

  it("uses the dedicated summarizer model and threshold when configured", () => {
    process.env.AI_COMPACT_MODEL = "anthropic/claude-haiku-4.5";
    process.env.AI_COMPACT_THRESHOLD_TOKENS = "1000";
    expect(compactionModel("anthropic/claude-sonnet-5")).toBe(
      "anthropic/claude-haiku-4.5",
    );
    expect(compactionThreshold()).toBe(1_000);
  });

  it("ignores a threshold that is not a positive number", () => {
    process.env.AI_COMPACT_THRESHOLD_TOKENS = "not-a-number";
    expect(compactionThreshold()).toBe(50_000);
  });
});

describe("estimateTokens", () => {
  it("grows with the size of the payload", () => {
    expect(estimateTokens([user("hi")])).toBeLessThan(
      estimateTokens([user("hi".repeat(500))]),
    );
  });
});

describe("safeCutIndex", () => {
  it("never cuts a tool result away from the call that produced it", () => {
    const messages = [
      user("one"),
      user("two"),
      assistantCall("listPlans", "call-1"),
      toolResult("listPlans", "call-1"),
      { role: "assistant", content: "done" } as ModelMessage,
    ];

    // Asking to keep the last 2 would land the cut on the tool result.
    const cut = safeCutIndex(messages, 2);
    expect(messages[cut].role).not.toBe("tool");
    expect(cut).toBe(2);
  });

  it("returns 0 when there is nothing safe to drop", () => {
    expect(safeCutIndex([user("one"), user("two")], 8)).toBe(0);
  });
});

describe("renderTranscript", () => {
  it("keeps tool calls and their results in the text handed to the summarizer", () => {
    const transcript = renderTranscript([
      user("make a pro plan"),
      assistantCall("createPlan", "call-1"),
      toolResult("createPlan", "call-1"),
    ]);

    expect(transcript).toContain("[user] make a pro plan");
    expect(transcript).toContain("[tool call] createPlan(");
    expect(transcript).toContain("[tool result] createPlan ->");
  });

  it("truncates an oversized tool result instead of forwarding all of it", () => {
    const transcript = renderTranscript([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "listPurchases",
            output: { type: "text", value: "y".repeat(10_000) },
          },
        ],
      },
    ]);

    expect(transcript).toContain("[truncated]");
    expect(transcript.length).toBeLessThan(3_000);
  });
});

describe("createContextCompactor", () => {
  it("leaves a short conversation alone", async () => {
    const prepareStep = createContextCompactor({ chatModel: "chat/model" });
    const result = await prepareStep({ messages: bulkyHistory(1), stepNumber: 0 });

    expect(result).toEqual({});
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it("summarizes the older turns and keeps the recent ones verbatim", async () => {
    const messages = bulkyHistory(40);
    const onCompacted = vi.fn();
    const prepareStep = createContextCompactor({
      chatModel: "chat/model",
      onCompacted,
    });

    const result = await prepareStep({ messages, stepNumber: 0 });
    const compacted = result.messages ?? [];

    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
    expect(compacted.length).toBeLessThan(messages.length);
    expect(compacted[0].role).toBe("user");
    expect(JSON.stringify(compacted[0].content)).toContain("SUMMARY");
    // The tail survives untouched, tool calls included.
    expect(compacted.slice(1)).toEqual(messages.slice(messages.length - 8));
    expect(onCompacted).toHaveBeenCalledWith({
      summary: "SUMMARY",
      messageCount: messages.length - 8,
    });
  });

  it("runs the summarizer on the dedicated model", async () => {
    process.env.AI_COMPACT_MODEL = "cheap/model";
    const prepareStep = createContextCompactor({ chatModel: "chat/model" });
    await prepareStep({ messages: bulkyHistory(40), stepNumber: 0 });

    expect(mockedGenerateText.mock.calls[0][0].model).toBe("cheap/model");
  });

  it("reuses a stored summary without calling the summarizer again", async () => {
    const messages = bulkyHistory(40);
    const prepareStep = createContextCompactor({
      chatModel: "chat/model",
      state: { summary: "EARLIER", messageCount: messages.length - 4 },
    });

    const result = await prepareStep({ messages, stepNumber: 0 });

    expect(mockedGenerateText).not.toHaveBeenCalled();
    expect(JSON.stringify(result.messages?.[0].content)).toContain("EARLIER");
    expect(result.messages?.slice(1)).toEqual(messages.slice(messages.length - 4));
  });

  it("folds a stale summary into a new one when the tail grew past the threshold", async () => {
    const messages = bulkyHistory(40);
    const prepareStep = createContextCompactor({
      chatModel: "chat/model",
      state: { summary: "EARLIER", messageCount: 4 },
    });

    const result = await prepareStep({ messages, stepNumber: 0 });

    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
    // The old summary is handed to the summarizer rather than dropped.
    expect(mockedGenerateText.mock.calls[0][0].prompt).toContain("EARLIER");
    expect(JSON.stringify(result.messages?.[0].content)).toContain("SUMMARY");
  });

  it("keeps the full history when the summarizer fails", async () => {
    mockedGenerateText.mockRejectedValue(new Error("gateway down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const prepareStep = createContextCompactor({ chatModel: "chat/model" });

    expect(await prepareStep({ messages: bulkyHistory(40), stepNumber: 0 })).toEqual(
      {},
    );
    error.mockRestore();
  });

  it("compacts again mid-run without persisting the in-run summary", async () => {
    const onCompacted = vi.fn();
    const prepareStep = createContextCompactor({
      chatModel: "chat/model",
      onCompacted,
    });

    const result = await prepareStep({ messages: bulkyHistory(40), stepNumber: 3 });

    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
    expect(result.messages?.[0].role).toBe("user");
    expect(onCompacted).not.toHaveBeenCalled();
  });
});
