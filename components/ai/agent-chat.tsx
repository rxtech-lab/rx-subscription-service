"use client";

import type { UIMessage } from "ai";
import { Bot, Check, LoaderCircle, Send, Sparkles, Square, X } from "lucide-react";
import { Fragment, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { MarkdownMessage } from "@/components/ai/markdown-message";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * The chat surface every agent in the app shares: the transcript, the
 * composer, the empty state and the small status pieces around them. Panels
 * keep their own wiring (`useChat`, tool semantics, layout chrome) and render
 * their own tool parts; only the presentation lives here.
 *
 * `compact` fits a sidebar tab like the paywall editor's; `comfortable` fits a
 * full-height panel like the workspace assistant's.
 */
export type AgentChatSize = "compact" | "comfortable";

/** The tool-part fields the SDK exposes that the UI actually reads. */
export interface AgentToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean };
}

export function isAgentToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-");
}

/** Turn `tool-createPlan` into `Create plan`. */
export function humanizeToolName(type: string): string {
  const spaced = type.replace(/^tool-/, "").replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function AgentAvatarLabel({ label = "Agent" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
      <span className="flex size-5 items-center justify-center rounded-md bg-blue-100 text-blue-600">
        <Bot className="size-3" aria-hidden="true" />
      </span>
      {label}
    </div>
  );
}

/**
 * The transcript. Text parts are rendered here so both agents speak with the
 * same voice; anything tool-shaped is handed back to the caller, which is the
 * only place that knows what a given tool means.
 */
export function AgentMessageList({
  messages,
  size = "comfortable",
  renderToolPart,
  messageRef,
  contentRef,
  empty,
  className,
  children,
}: {
  messages: UIMessage[];
  size?: AgentChatSize;
  renderToolPart: (context: {
    part: AgentToolPart;
    index: number;
    message: UIMessage;
  }) => ReactNode;
  /** Lets a panel attach a ref to one message, e.g. to pin it while it answers. */
  messageRef?: (messageId: string) => RefObject<HTMLDivElement | null> | undefined;
  contentRef?: RefObject<HTMLDivElement | null>;
  /** Shown in place of the transcript while there are no messages. */
  empty?: ReactNode;
  className?: string;
  /** Trailing content inside the transcript, such as a busy or error notice. */
  children?: ReactNode;
}) {
  const compact = size === "compact";

  return (
    <div ref={contentRef} className={cn("space-y-4", className)}>
      {messages.length === 0 ? empty : null}

      {messages.map((message) => (
        <div
          key={message.id}
          ref={messageRef?.(message.id)}
          className="space-y-2"
        >
          {message.role === "assistant" ? <AgentAvatarLabel /> : null}
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return message.role === "user" ? (
                <div
                  key={index}
                  className={cn(
                    "ml-auto w-fit break-words whitespace-pre-wrap rounded-2xl rounded-br-md bg-blue-600 text-white",
                    compact
                      ? "max-w-[90%] px-3 py-2 text-xs"
                      : "max-w-[calc(100%-2rem)] px-3.5 py-2.5 text-sm shadow-sm shadow-blue-600/10",
                  )}
                >
                  {part.text}
                </div>
              ) : (
                <div key={index} className={cn("w-full", compact ? "text-xs" : "text-sm")}>
                  <MarkdownMessage>{part.text}</MarkdownMessage>
                </div>
              );
            }

            if (!isAgentToolPart(part)) return null;
            return (
              <Fragment key={index}>
                {renderToolPart({
                  part: part as unknown as AgentToolPart,
                  index,
                  message,
                })}
              </Fragment>
            );
          })}
        </div>
      ))}

      {children}
    </div>
  );
}

/** The opening screen: what this agent is for, plus a few things to try. */
export function AgentEmptyState({
  title,
  description,
  suggestions = [],
  onSuggestionSelect,
  size = "comfortable",
}: {
  title: string;
  description: string;
  suggestions?: readonly string[];
  onSuggestionSelect?: (suggestion: string) => void;
  size?: AgentChatSize;
}) {
  const compact = size === "compact";

  return (
    <div
      className={cn(
        "mx-auto flex flex-col items-center px-1 text-center",
        compact ? "max-w-xs py-3" : "max-w-sm py-6",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600",
          compact ? "size-9" : "size-11",
        )}
      >
        <Sparkles className={compact ? "size-4" : "size-5"} aria-hidden="true" />
      </span>
      <p className={cn("font-semibold text-slate-950", compact ? "mt-3 text-xs" : "mt-4 text-sm")}>
        {title}
      </p>
      <p className={cn("mt-1.5 leading-5 text-slate-500", compact ? "text-[11px]" : "text-xs")}>
        {description}
      </p>
      {suggestions.length ? (
        <div className={cn("grid w-full gap-2 text-left", compact ? "mt-4" : "mt-5")}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestionSelect?.(suggestion)}
              className={cn(
                "rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-left leading-5 text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-blue-200 hover:text-slate-950 hover:shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100",
                compact ? "text-[11px]" : "text-xs",
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** What a tool call amounts to once the agent is done with it. */
export type AgentToolStatus = "running" | "done" | "failed" | "skipped";

/** A one-line tool result. */
export function AgentToolCard({
  label,
  status,
  size = "comfortable",
}: {
  label: string;
  status: AgentToolStatus;
  size?: AgentChatSize;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-2.5 py-1.5",
        size === "compact" ? "text-[11px]" : "text-xs",
        status === "failed"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {status === "running" ? (
        <LoaderCircle className="mt-0.5 size-3 shrink-0 animate-spin" aria-hidden="true" />
      ) : status === "failed" ? (
        <X className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      ) : status === "skipped" ? (
        <X className="mt-0.5 size-3 shrink-0 text-slate-400" aria-hidden="true" />
      ) : (
        <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" aria-hidden="true" />
      )}
      <span className="min-w-0 break-words">{label}</span>
    </div>
  );
}

export function AgentTypingIndicator() {
  return (
    <div
      className="flex items-center gap-1 py-2"
      role="status"
      aria-label="Agent is responding"
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

export function AgentError({
  children,
  size = "comfortable",
}: {
  children: ReactNode;
  size?: AgentChatSize;
}) {
  return (
    <p
      role="alert"
      className={cn(
        "rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700",
        size === "compact" ? "text-[11px]" : "text-sm",
      )}
    >
      {children}
    </p>
  );
}

/**
 * The composer. Enter sends, Shift+Enter adds a line, and the send button
 * turns into a stop button while the agent is answering.
 */
export function AgentComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  placeholder = "Ask the agent…",
  label = "Message the agent",
  rows = 2,
  size = "comfortable",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy?: boolean;
  /** Blocks typing and sending, e.g. while an approval is pending. */
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  rows?: number;
  size?: AgentChatSize;
  className?: string;
}) {
  const compact = size === "compact";

  const submit = () => {
    if (busy || disabled || !value.trim()) return;
    onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        "flex items-end",
        compact
          ? "gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100"
          : "gap-2 rounded-2xl border border-slate-200/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(241,245,249,0.42))] p-2 backdrop-blur-2xl backdrop-saturate-150 transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-100/70",
        className,
      )}
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          "min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-slate-900 outline-none placeholder:text-slate-400",
          compact ? "min-h-10 text-xs leading-5" : "text-sm",
        )}
      />
      {busy && onStop ? (
        <Button
          type="button"
          size={compact ? "sm" : "icon"}
          variant="secondary"
          className={cn("shrink-0", compact ? "w-9 px-0" : "size-9 shadow-none")}
          onClick={onStop}
          aria-label="Stop response"
        >
          <Square className="size-3.5 fill-current" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          type="submit"
          size={compact ? "sm" : "icon"}
          className={cn("shrink-0", compact ? "w-9 px-0" : "size-9 shadow-none")}
          disabled={busy || disabled || !value.trim()}
          aria-label="Send message"
        >
          <Send className={compact ? "size-3.5" : "size-4"} aria-hidden="true" />
        </Button>
      )}
    </form>
  );
}
