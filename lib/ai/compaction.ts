import { generateText, type ModelMessage } from "ai";

/**
 * Keeps a long assistant session inside a sane context window.
 *
 * Nothing is thrown away: the stored conversation and the panel keep every
 * message, including every tool call and its result. Only the copy handed to the
 * model shrinks — once it crosses the token threshold, the older messages are
 * replaced by a summary that a cheaper model writes, and the recent turns are
 * passed through untouched.
 *
 * Triggering on an estimate rather than provider usage is deliberate: the
 * decision has to be made *before* the request, and being a few percent off only
 * moves the compaction one turn either way.
 */

/** Compact once the prompt is estimated to be this large. */
const DEFAULT_THRESHOLD_TOKENS = 50_000;
/** Recent messages always survive verbatim, so the model keeps its working set. */
const KEEP_RECENT_MESSAGES = 8;
/** A single tool result can be enormous; the summarizer only needs its shape. */
const TOOL_TEXT_LIMIT = 2_000;
const SUMMARY_MAX_OUTPUT_TOKENS = 1_500;

export type CompactionState = {
  /** The summary standing in for the messages that were folded away. */
  summary: string;
  /** How many leading model messages that summary covers. */
  messageCount: number;
};

export function compactionThreshold(): number {
  const configured = Number(process.env.AI_COMPACT_THRESHOLD_TOKENS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_THRESHOLD_TOKENS;
}

/**
 * Summarizing is a cheap, mechanical job, so it can run on a smaller model than
 * the chat. Falls back to the chat model when nothing is configured.
 */
export function compactionModel(chatModel: string): string {
  return process.env.AI_COMPACT_MODEL?.trim() || chatModel;
}

/** Rough token count at ~4 characters per token. */
export function estimateTokens(value: unknown): number {
  if (value === undefined) return 0;
  return Math.ceil(JSON.stringify(value).length / 4);
}

function hasToolCall(message: ModelMessage): boolean {
  return (
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "tool-call")
  );
}

/**
 * A cut here must not leave a tool result whose call was summarized away —
 * providers reject an unmatched result. Walking backwards only ever keeps more
 * than asked for, which is the safe direction.
 */
export function safeCutIndex(
  messages: ModelMessage[],
  keepRecent: number = KEEP_RECENT_MESSAGES,
): number {
  let cut = messages.length - keepRecent;
  while (cut > 0) {
    const orphansResult =
      messages[cut].role === "tool" || hasToolCall(messages[cut - 1]);
    if (!orphansResult) break;
    cut--;
  }
  return Math.max(cut, 0);
}

function truncate(text: string): string {
  return text.length > TOOL_TEXT_LIMIT
    ? `${text.slice(0, TOOL_TEXT_LIMIT)}… [truncated]`
    : text;
}

/**
 * Flatten messages into a transcript for the summarizer. Tool calls are replayed
 * as text rather than as real tool messages: the summarizer has no tool
 * definitions, and providers reject tool blocks that reference unknown tools.
 */
export function renderTranscript(messages: ModelMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system":
        lines.push(`[system] ${truncate(message.content)}`);
        break;

      case "user":
      case "assistant": {
        const content = message.content;
        if (typeof content === "string") {
          lines.push(`[${message.role}] ${truncate(content)}`);
          break;
        }
        for (const part of content) {
          if (part.type === "text") {
            lines.push(`[${message.role}] ${truncate(part.text)}`);
          } else if (part.type === "tool-call") {
            lines.push(
              `[tool call] ${part.toolName}(${truncate(JSON.stringify(part.input) ?? "")})`,
            );
          } else if (part.type === "tool-result") {
            lines.push(
              `[tool result] ${part.toolName} -> ${truncate(JSON.stringify(part.output) ?? "")}`,
            );
          }
        }
        break;
      }

      case "tool":
        for (const part of message.content) {
          if (part.type !== "tool-result") continue;
          lines.push(
            `[tool result] ${part.toolName} -> ${truncate(JSON.stringify(part.output) ?? "")}`,
          );
        }
        break;
    }
  }

  return lines.join("\n");
}

const SUMMARY_SYSTEM = [
  "You compact the history of a conversation between an admin and an AI assistant that manages subscription settings (plans, roles, balance units, usage items, topups, test users, test suites).",
  "Rewrite the transcript as a summary the assistant can work from without re-reading it.",
  "",
  "Keep, in this order:",
  "- What the user asked for, in their own terms, and any constraint they set.",
  "- Every tool call that ran, what it did, and whether it succeeded. Copy ids, keys, and names verbatim — a later step will need them to make an edit.",
  "- Decisions taken and options rejected, plus anything the user approved or declined.",
  "- Anything still pending, unanswered, or half-finished.",
  "",
  "Rules: state only what the transcript shows, never infer or invent. Never abbreviate or reformat an id. Prefer short bullets over prose. Output the summary only, with no preamble.",
].join("\n");

/**
 * Carry the summary as a leading user message. A system message would work for a
 * one-shot compaction, but providers require the first message to be a user
 * turn, and this shape stays valid however the surviving tail begins.
 */
export function summaryMessage(summary: string): ModelMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          "<conversation-summary>",
          "Earlier messages in this session were compacted to save context. What",
          "follows is an accurate record of everything that happened before the",
          "messages below — treat it as the conversation so far. Do not mention",
          "compaction unless the user asks about it.",
          "",
          summary,
          "</conversation-summary>",
        ].join("\n"),
      },
    ],
  };
}

async function summarize(input: {
  previous: string | null;
  messages: ModelMessage[];
  model: string;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const prompt = [
    input.previous
      ? `Summary of everything before this transcript:\n${input.previous}\n`
      : null,
    "Transcript to fold in:",
    renderTranscript(input.messages),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { text } = await generateText({
      model: input.model,
      system: SUMMARY_SYSTEM,
      prompt,
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      abortSignal: input.abortSignal,
    });
    return text.trim() || null;
  } catch (error) {
    // A failed compaction is not a failed turn: the run continues on the full
    // history, which is correct, just more expensive.
    console.error("Context compaction failed:", error);
    return null;
  }
}

/**
 * Build the `prepareStep` handler that compacts the prompt when it gets too big.
 *
 * Step 0 sees exactly the stored history, so a summary made there can be
 * anchored by message count and reused on the next turn instead of paying for a
 * summary every time. Later steps see a list this handler already rewrote, so
 * their compactions fold the previous summary back in and stay in memory.
 */
export function createContextCompactor(options: {
  chatModel: string;
  state?: CompactionState | null;
  abortSignal?: AbortSignal;
  onCompacted?: (state: CompactionState) => void | Promise<void>;
}) {
  const threshold = compactionThreshold();
  const model = compactionModel(options.chatModel);
  const carried = options.state?.summary.trim()
    ? { summary: options.state.summary.trim(), count: options.state.messageCount }
    : null;

  return async function prepareStep({
    messages,
    stepNumber,
  }: {
    messages: ModelMessage[];
    stepNumber: number;
  }): Promise<{ messages?: ModelMessage[] }> {
    if (stepNumber > 0) {
      if (estimateTokens(messages) <= threshold) return {};
      const cut = safeCutIndex(messages);
      if (cut <= 0) return {};

      const summary = await summarize({
        previous: null,
        messages: messages.slice(0, cut),
        model,
        abortSignal: options.abortSignal,
      });
      if (!summary) return {};
      return { messages: [summaryMessage(summary), ...messages.slice(cut)] };
    }

    // A stored count from a longer history than the one in hand means the two
    // no longer line up; summarizing again from scratch is always correct.
    const reusable = carried && carried.count > 0 && carried.count < messages.length;
    const covered = reusable ? carried.count : 0;
    const asIs = reusable
      ? [summaryMessage(carried.summary), ...messages.slice(covered)]
      : messages;
    const unchanged = () => (reusable ? { messages: asIs } : {});

    if (estimateTokens(asIs) <= threshold) return unchanged();

    const cut = safeCutIndex(messages);
    // Nothing new to fold in — the recent messages alone are over the threshold.
    if (cut <= covered) return unchanged();

    const summary = await summarize({
      previous: reusable ? carried.summary : null,
      messages: messages.slice(covered, cut),
      model,
      abortSignal: options.abortSignal,
    });
    if (!summary) return unchanged();

    await options.onCompacted?.({ summary, messageCount: cut });
    return { messages: [summaryMessage(summary), ...messages.slice(cut)] };
  };
}
