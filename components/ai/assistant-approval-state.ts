import { isToolUIPart, type UIMessage } from "ai";

export interface PendingApproval {
  messageId: string;
  messageIndex: number;
}

export function findLatestPendingApproval(
  messages: UIMessage[],
): PendingApproval | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const hasPendingApproval = message.parts.some(
      (part) =>
        isToolUIPart(part) &&
        (part.state === "approval-requested" ||
          part.state === "approval-responded"),
    );
    if (hasPendingApproval) {
      return { messageId: message.id, messageIndex };
    }
  }
  return null;
}

export function latestUserTextAfter(
  messages: UIMessage[],
  messageIndex: number,
): string | null {
  for (let index = messages.length - 1; index > messageIndex; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = message.parts.find((part) => part.type === "text");
    if (text?.type === "text" && text.text.trim()) return text.text;
  }
  return null;
}
