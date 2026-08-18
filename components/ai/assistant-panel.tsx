"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import {
  Bot,
  Check,
  CheckCircle2,
  Loader2,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { clearAssistantConversationAction } from "@/app/actions/assistant";
import {
  findLatestPendingApproval,
  latestUserTextAfter,
} from "@/components/ai/assistant-approval-state";
import { MarkdownMessage } from "@/components/ai/markdown-message";
import {
  calculatePinnedBottomSpacing,
  shouldReleasePinnedMessage,
} from "@/components/ai/pinned-message-layout";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface DisplayToolPart {
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean };
}

interface ConfirmationInput {
  title?: unknown;
  description?: unknown;
}

const PINNED_MESSAGE_TOP_INSET = 16;

/** Turn `createPlan` into `Create plan` for the approval card. */
function humanizeTool(name: string): string {
  const bare = name.replace(/^tool-/, "");
  const spaced = bare.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ArgumentList({ input }: { input: unknown }) {
  if (!input || typeof input !== "object") return null;
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (entries.length === 0) return null;

  return (
    <dl className="mt-2 space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs">
          <dt className="shrink-0 text-neutral-500">{key}</dt>
          <dd className="min-w-0 flex-1 break-words font-mono text-neutral-800">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ConfirmationCard({
  toolPart,
  onResponse,
}: {
  toolPart: DisplayToolPart;
  onResponse: (approved: boolean) => void;
}) {
  const input = (toolPart.input ?? {}) as ConfirmationInput;
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title
      : "Confirm change";
  const description =
    typeof input.description === "string" ? input.description : "";
  const cancelled =
    toolPart.state === "output-denied" ||
    (toolPart.state === "approval-responded" &&
      toolPart.approval?.approved === false);
  const approved = toolPart.state === "output-available";
  const failed = toolPart.state === "output-error";

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        cancelled
          ? "border-slate-200 bg-slate-50"
          : failed
            ? "border-rose-200 bg-rose-50/70"
            : approved
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-amber-300 bg-amber-50",
      )}
    >
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      {description ? (
        <p className="mt-1.5 text-sm leading-6 text-slate-600">{description}</p>
      ) : null}

      {toolPart.state === "approval-requested" ? (
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => onResponse(true)}>
            <Check className="size-3.5" aria-hidden="true" />
            Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onResponse(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <p
          className={cn(
            "mt-3 text-xs font-medium",
            cancelled
              ? "text-slate-500"
              : failed
                ? "text-rose-700"
                : approved
                  ? "text-emerald-700"
                  : "text-blue-700",
          )}
        >
          {cancelled
            ? "Cancelled"
            : failed
              ? toolPart.errorText ?? "Confirmation failed"
              : approved
                ? "Approved"
                : "Confirming…"}
        </p>
      )}
    </div>
  );
}

function ApprovalCard({
  label,
  toolPart,
  onResponse,
}: {
  label: string;
  toolPart: DisplayToolPart;
  onResponse: (approved: boolean) => void;
}) {
  const output = toolPart.output as { ok?: boolean; error?: string } | null;
  const outputFailed = toolPart.state === "output-available" && output?.ok === false;

  const presentation = outputFailed
    ? {
        label: "Failed",
        icon: XCircle,
        card: "border-rose-200 bg-rose-50/70",
        title: "text-rose-950",
        badge: "bg-rose-100 text-rose-700",
      }
    : toolPart.state === "output-error"
      ? {
          label: "Failed",
          icon: XCircle,
          card: "border-rose-200 bg-rose-50/70",
          title: "text-rose-950",
          badge: "bg-rose-100 text-rose-700",
        }
      : toolPart.state === "output-denied" ||
          (toolPart.state === "approval-responded" &&
            toolPart.approval?.approved === false)
        ? {
            label: "Rejected",
            icon: XCircle,
            card: "border-slate-200 bg-slate-50",
            title: "text-slate-900",
            badge: "bg-slate-200/70 text-slate-600",
          }
        : toolPart.state === "output-available"
          ? {
              label: "Applied",
              icon: CheckCircle2,
              card: "border-emerald-200 bg-emerald-50/70",
              title: "text-emerald-950",
              badge: "bg-emerald-100 text-emerald-700",
            }
          : toolPart.state === "approval-responded"
            ? {
                label: "Applying",
                icon: Loader2,
                card: "border-blue-200 bg-blue-50/70",
                title: "text-blue-950",
                badge: "bg-blue-100 text-blue-700",
              }
            : {
                label: "Confirmation required",
                icon: null,
                card: "border-amber-300 bg-amber-50",
                title: "text-amber-950",
                badge: "bg-amber-100 text-amber-700",
              };

  const StatusIcon = presentation.icon;
  const errorMessage = outputFailed ? output?.error : toolPart.errorText;

  return (
    <div className={cn("rounded-xl border p-3.5", presentation.card)}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-sm font-semibold", presentation.title)}>{label}</p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold",
            presentation.badge,
          )}
        >
          {StatusIcon ? (
            <StatusIcon
              className={cn(
                "size-3",
                presentation.label === "Applying" && "animate-spin",
              )}
              aria-hidden="true"
            />
          ) : null}
          {presentation.label}
        </span>
      </div>

      <ArgumentList input={toolPart.input} />

      {errorMessage ? (
        <p className="mt-2 text-xs leading-5 text-rose-700">{errorMessage}</p>
      ) : null}

      {toolPart.state === "approval-requested" ? (
        <div className="mt-3 flex gap-2 border-t border-amber-200 pt-3">
          <Button size="sm" onClick={() => onResponse(true)}>
            <Check className="size-3.5" aria-hidden="true" />
            Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onResponse(false)}>
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      className="flex items-center gap-1 py-2"
      role="status"
      aria-label="Assistant is responding"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${index * 140}ms` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function AssistantPanel({
  applicationId,
  applicationName,
  initialMessages,
}: {
  applicationId: string;
  applicationName: string;
  initialMessages: UIMessage[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [pinnedUserMessageId, setPinnedUserMessageId] = useState<string | null>(
    null,
  );
  const [bottomSpacing, setBottomSpacing] = useState(0);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const pinnedUserMessageRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    addToolApprovalResponse,
    clearError: clearChatError,
    error,
  } = useChat({
    id: `assistant:${applicationId}`,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { applicationId },
    }),
    // Once an approval is answered, continue the run without another user turn.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const busy = status === "streaming" || status === "submitted";
  const pendingApproval = findLatestPendingApproval(messages);
  const messagesThroughPendingApproval = pendingApproval
    ? messages.slice(0, pendingApproval.messageIndex + 1)
    : [];
  const canResumePendingApproval =
    pendingApproval !== null &&
    lastAssistantMessageIsCompleteWithApprovalResponses({
      messages: messagesThroughPendingApproval,
    });

  const updatePinnedLayout = useCallback(() => {
    if (!open || !pinnedUserMessageId) return;

    const viewport = messagesViewportRef.current;
    const pinnedMessage = pinnedUserMessageRef.current;
    const spacer = bottomSpacerRef.current;
    if (!viewport || !pinnedMessage || !spacer) return;

    const viewportRect = viewport.getBoundingClientRect();
    const pinnedRect = pinnedMessage.getBoundingClientRect();
    const pinnedOffsetTop = pinnedRect.top - viewportRect.top + viewport.scrollTop;
    const targetScrollTop = Math.max(
      0,
      pinnedOffsetTop - PINNED_MESSAGE_TOP_INSET,
    );
    const requiredSpacing = calculatePinnedBottomSpacing({
      viewportHeight: viewport.clientHeight,
      targetScrollTop,
      scrollHeight: viewport.scrollHeight,
      currentSpacerHeight: spacer.getBoundingClientRect().height,
    });

    const pinnedIndex = messages.findIndex(
      (message) => message.id === pinnedUserMessageId,
    );
    const hasContentAfterPinnedMessage = messages
      .slice(pinnedIndex + 1)
      .some((message) => message.parts.length > 0);

    // A long user message may need no spacer by itself. Keep it pinned until a
    // real response exists, then release once the reply fills the viewport.
    if (
      shouldReleasePinnedMessage(requiredSpacing, hasContentAfterPinnedMessage)
    ) {
      setBottomSpacing(0);
      setPinnedUserMessageId(null);
      return;
    }

    setBottomSpacing((currentSpacing) =>
      currentSpacing === requiredSpacing ? currentSpacing : requiredSpacing,
    );
    viewport.scrollTo({ top: targetScrollTop });
  }, [messages, open, pinnedUserMessageId]);

  useLayoutEffect(() => {
    updatePinnedLayout();
  }, [bottomSpacing, status, updatePinnedLayout]);

  useEffect(() => {
    if (!open) return;

    const viewport = messagesViewportRef.current;
    const content = messagesContentRef.current;
    if (!viewport || !content) return;

    let animationFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updatePinnedLayout);
    });
    observer.observe(viewport);
    observer.observe(content);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [open, updatePinnedLayout]);

  useEffect(() => {
    if (!open || pinnedUserMessageId) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open, pinnedUserMessageId, status]);

  function submit() {
    const text = draft.trim();
    if (!text || busy || pendingApproval) return;
    const messageId = crypto.randomUUID();
    setDraft("");
    setBottomSpacing(0);
    setPinnedUserMessageId(messageId);
    void sendMessage({
      id: messageId,
      role: "user",
      parts: [{ type: "text", text }],
    });
  }

  async function resumePendingApproval() {
    if (!pendingApproval || !canResumePendingApproval || busy) return;

    const deferredUserText = latestUserTextAfter(
      messages,
      pendingApproval.messageIndex,
    );
    if (deferredUserText) {
      setDraft((currentDraft) => {
        if (!currentDraft.trim()) return deferredUserText;
        if (currentDraft.trim() === deferredUserText.trim()) return currentDraft;
        return `${deferredUserText}\n\n${currentDraft}`;
      });
    }

    // A failed follow-up can leave a user message after the approval response.
    // Remove it from the protocol before retrying, but preserve its text above.
    setMessages(messagesThroughPendingApproval);
    setPinnedUserMessageId(null);
    setBottomSpacing(0);
    clearChatError();
    await sendMessage();
  }

  async function clearConversation() {
    if (busy || clearing || messages.length === 0) return;
    if (!window.confirm("Clear this assistant conversation? This cannot be undone.")) {
      return;
    }

    setClearing(true);
    setClearError(null);
    try {
      await clearAssistantConversationAction(applicationId);
      setPinnedUserMessageId(null);
      setBottomSpacing(0);
      setMessages([]);
    } catch (clearConversationError) {
      console.error("Failed to clear assistant conversation:", clearConversationError);
      setClearError("The conversation could not be cleared. Please try again.");
    } finally {
      setClearing(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open subscription assistant"
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg transition hover:bg-neutral-700"
      >
        <Bot className="h-5 w-5" />
      </button>
    );
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-neutral-200 bg-white shadow-xl sm:w-[420px]">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-neutral-900">Assistant</p>
          <p className="text-xs text-neutral-500">{applicationName}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void clearConversation()}
            disabled={busy || clearing || messages.length === 0}
            aria-label="Clear assistant conversation"
          >
            {clearing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-3.5" aria-hidden="true" />
            )}
            Clear
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div
        ref={messagesViewportRef}
        className="flex-1 overflow-y-auto px-4 pb-32 pt-4"
        aria-live="polite"
      >
        <div ref={messagesContentRef} className="space-y-4">
          {messages.length === 0 ? (
            <div className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600">
              <p className="font-medium text-neutral-900">
                Manage subscription settings in plain language.
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                <li>“Add a Pro plan at $19/month with a 14-day trial”</li>
                <li>“Give Pro 10,000 points every month”</li>
                <li>“Create an api_calls usage item that resets every 24 hours”</li>
                <li>“Only let Pro subscribers buy the large points pack”</li>
              </ul>
            </div>
          ) : null}

          {messages.map((message) => (
            <div
              key={message.id}
              ref={
                message.id === pinnedUserMessageId
                  ? pinnedUserMessageRef
                  : undefined
              }
              className="space-y-2"
            >
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  if (message.role !== "user") {
                    return (
                      <div key={index} className="text-sm">
                        <MarkdownMessage>{part.text}</MarkdownMessage>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={index}
                      className="ml-auto w-fit max-w-[calc(100%-2rem)] break-words whitespace-pre-wrap rounded-xl bg-slate-900 px-3 py-2 text-sm text-white"
                    >
                      {part.text}
                    </div>
                  );
                }

                if (!part.type.startsWith("tool-")) return null;
                const toolPart = part as typeof part & DisplayToolPart;
                const label = humanizeTool(part.type);

                if (part.type === "tool-confirmation" && toolPart.approval) {
                  const approvalId = toolPart.approval.id;
                  return (
                    <ConfirmationCard
                      key={index}
                      toolPart={toolPart}
                      onResponse={(approved) => {
                        clearChatError();
                        void addToolApprovalResponse({ id: approvalId, approved });
                      }}
                    />
                  );
                }

                // Write tools keep their existing detailed approval card.
                if (toolPart.approval) {
                  const approvalId = toolPart.approval.id;
                  return (
                    <ApprovalCard
                      key={index}
                      label={label}
                      toolPart={toolPart}
                      onResponse={(approved) => {
                        clearChatError();
                        void addToolApprovalResponse({ id: approvalId, approved });
                      }}
                    />
                  );
                }

                if (toolPart.state === "output-denied") {
                  return (
                    <p key={index} className="text-xs text-neutral-500">
                      {label} — rejected
                    </p>
                  );
                }

                if (toolPart.state === "output-error") {
                  return (
                    <p key={index} className="text-xs text-red-600">
                      {label} — {toolPart.errorText ?? "failed"}
                    </p>
                  );
                }

                if (toolPart.state === "output-available") {
                  const output = toolPart.output as {
                    ok?: boolean;
                    error?: string;
                  } | null;
                  if (output && output.ok === false) {
                    return (
                      <p key={index} className="text-xs text-red-600">
                        {label} — {output.error}
                      </p>
                    );
                  }
                  return (
                    <p key={index} className="text-xs text-neutral-500">
                      {label} — done
                    </p>
                  );
                }

                return (
                  <p key={index} className="text-xs text-neutral-400">
                    {label}…
                  </p>
                );
              })}
            </div>
          ))}

          {busy ? <TypingIndicator /> : null}

          {canResumePendingApproval && !busy ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p className="font-medium">
                This confirmed change is waiting to finish.
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-700">
                Resume it before sending another message. Any failed follow-up
                will be returned to the composer.
              </p>
              <Button
                className="mt-3"
                size="sm"
                onClick={() => void resumePendingApproval()}
              >
                Resume change
              </Button>
            </div>
          ) : null}

          {error && !canResumePendingApproval ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error.message}
            </p>
          ) : null}
          {clearError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {clearError}
            </p>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
        <div
          ref={bottomSpacerRef}
          style={{ height: bottomSpacing }}
          aria-hidden="true"
        />
      </div>

      <form
        className="absolute inset-x-3 bottom-3 z-10 flex items-end gap-2 rounded-2xl border border-slate-200/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(241,245,249,0.42))] p-2 backdrop-blur-2xl backdrop-saturate-150"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          disabled={busy || pendingApproval !== null}
          placeholder={
            pendingApproval
              ? canResumePendingApproval
                ? "Resume the pending change first"
                : "Approve or reject the pending change first"
              : "Ask for a change…"
          }
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
        />
        <Button
          type="submit"
          size="icon"
          className="shadow-none"
          disabled={busy || pendingApproval !== null || !draft.trim()}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </aside>
  );
}
