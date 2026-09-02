"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, Check, LoaderCircle, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownMessage } from "@/components/ai/markdown-message";
import { Button } from "@/components/ui/primitives";
import { labelProducts, type CatalogProduct } from "@/lib/paywall/export";
import type { PaywallSpec } from "@/lib/paywall/schema";
import { cn } from "@/lib/utils";

interface ToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface ToolOutput {
  ok?: boolean;
  summary?: string;
  error?: string;
  spec?: PaywallSpec;
  nodes?: unknown[];
}

const SUGGESTIONS = [
  "Make the headline punchier and add a benefit about saving time.",
  "Switch to a dark theme with a violet primary color.",
  "Add a 'Most popular' badge above the products and highlight the yearly plan.",
  "Tighten the spacing so everything fits without scrolling.",
];

/**
 * The agent tab. Every turn sends the current draft; every successful tool
 * result carries the updated document, which is adopted into the editor as an
 * unsaved change. Nothing is persisted by the conversation itself.
 */
export function AgentPanel({
  paywallId,
  spec,
  products,
  onApply,
}: {
  paywallId: string;
  spec: PaywallSpec;
  products: CatalogProduct[];
  onApply: (spec: PaywallSpec, coalesceKey: string) => void;
}) {
  const [input, setInput] = useState("");
  const [transport] = useState(() => new DefaultChatTransport({ api: "/api/ai/paywall" }));

  /** The draft and preview products travel with each request, never stored. */
  const requestBody = () => ({
    paywallId,
    spec,
    products: labelProducts(products).map((product) => ({
      name: product.name,
      priceLabel: product.priceLabel,
      periodLabel: product.periodLabel,
      planGroup: product.planGroup,
      trialDays: product.trialDays,
    })),
  });

  const { messages, sendMessage, status, stop, error, clearError, setMessages } = useChat({
    id: `paywall:${paywallId}`,
    transport,
  });
  const busy = status === "streaming" || status === "submitted";

  // Adopt the newest successful edit exactly once per tool call.
  const applied = useRef(new Set<string>());
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      let latest: PaywallSpec | null = null;
      for (const part of message.parts) {
        if (!part.type.startsWith("tool-")) continue;
        const tool = part as unknown as ToolPart;
        if (tool.state !== "output-available" || applied.current.has(tool.toolCallId)) continue;
        applied.current.add(tool.toolCallId);
        const output = tool.output as ToolOutput | undefined;
        if (output?.ok && output.spec) latest = output.spec;
      }
      if (latest) onApply(latest, `agent:${message.id}`);
    }
  }, [messages, onApply]);

  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = transcriptRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, status]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    clearError();
    void sendMessage({ text }, { body: requestBody() });
    setInput("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-[11px] text-slate-500">
          Edits land in the editor unsaved. Chat is not saved.
        </p>
        {messages.length ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setMessages([]);
              applied.current.clear();
            }}
          >
            <Trash2 className="size-3" aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>

      <div ref={transcriptRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Sparkles className="size-3.5" aria-hidden="true" />
              </span>
              <p className="text-xs leading-5 text-slate-700">
                Describe the paywall you want. The agent edits the document directly and you can
                undo anything it does.
              </p>
            </div>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    clearError();
                    void sendMessage({ text: suggestion }, { body: requestBody() });
                  }}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs leading-5 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            {message.role === "assistant" ? (
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                <Bot className="size-3" aria-hidden="true" />
                Agent
              </div>
            ) : null}
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return message.role === "user" ? (
                  <div
                    key={index}
                    className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-xs text-white"
                  >
                    {part.text}
                  </div>
                ) : (
                  <div key={index} className="text-xs">
                    <MarkdownMessage>{part.text}</MarkdownMessage>
                  </div>
                );
              }
              if (part.type.startsWith("tool-")) {
                return <ToolCard key={index} part={part as unknown as ToolPart} />;
              }
              return null;
            })}
          </div>
        ))}

        {busy ? (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
            Working…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
            {error.message || "The agent request failed."}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-2">
        <div className="flex items-end gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ask the agent to change the paywall…"
            aria-label="Message the paywall agent"
            className="min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-xs leading-5 text-slate-900 outline-none placeholder:text-slate-400"
          />
          {busy ? (
            <Button type="button" size="sm" variant="secondary" className="w-9 px-0" aria-label="Stop" onClick={() => void stop()}>
              <Square className="size-3.5" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="button" size="sm" className="w-9 px-0" aria-label="Send message" disabled={!input.trim()} onClick={submit}>
              <Send className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCard({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, "");
  const output = part.output as ToolOutput | undefined;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" || (part.state === "output-available" && output && output.ok === false);
  const label =
    name === "listNodes"
      ? "Read the layers"
      : output?.summary ?? name.replace(/([A-Z])/g, " $1").toLowerCase();

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]",
        failed ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {running ? (
        <LoaderCircle className="mt-0.5 size-3 shrink-0 animate-spin" aria-hidden="true" />
      ) : failed ? (
        <X className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      ) : (
        <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" aria-hidden="true" />
      )}
      <span className="min-w-0 break-words">
        {running ? `${name}…` : failed ? output?.error ?? part.errorText ?? `${name} failed` : label}
      </span>
    </div>
  );
}
