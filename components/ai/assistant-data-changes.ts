import { isToolUIPart, type UIMessage } from "ai";

/** Asking for confirmation is the one approval tool that writes nothing. */
const NON_WRITE_TOOL_TYPES = new Set(["tool-confirmation"]);

interface WriteToolPart {
  toolCallId: string;
  state: string;
  approval?: { id: string };
  output?: { ok?: boolean } | null;
}

/**
 * Tool calls that changed application data. Only write tools ask for approval,
 * so an approved call that returned a successful output has touched the
 * database and the page behind the panel is now stale.
 */
export function completedWriteToolCallIds(messages: UIMessage[]): string[] {
  const toolCallIds: string[] = [];

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || NON_WRITE_TOOL_TYPES.has(part.type)) continue;

      const toolPart = part as typeof part & WriteToolPart;
      if (!toolPart.approval || toolPart.state !== "output-available") continue;
      if (toolPart.output?.ok === false) continue;

      toolCallIds.push(toolPart.toolCallId);
    }
  }

  return toolCallIds;
}
