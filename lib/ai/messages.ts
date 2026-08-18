import { isToolUIPart, type UIMessage } from "ai";

/**
 * Remove tool calls that never produced a result. Stopping a response mid-run
 * leaves parts in `input-streaming` or `input-available`; replaying those would
 * send the model a tool call with no matching tool result. Parts waiting on an
 * approval keep their own states and are preserved.
 */
export function dropIncompleteToolCalls(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter(
        (part) =>
          !isToolUIPart(part) ||
          (part.state !== "input-streaming" && part.state !== "input-available"),
      ),
    }))
    .filter((message) => message.parts.length > 0);
}
