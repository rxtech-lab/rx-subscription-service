"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AgentComposer,
  AgentEmptyState,
  AgentError,
  AgentMessageList,
  AgentToolCard,
  AgentTypingIndicator,
  type AgentToolPart,
} from "@/components/ai/agent-chat";
import { Button } from "@/components/ui/primitives";
import { labelProducts, type CatalogProduct } from "@/lib/paywall/export";
import type { PaywallSpec } from "@/lib/paywall/schema";

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
        const tool = part as unknown as AgentToolPart;
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

      <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <AgentMessageList
          messages={messages}
          size="compact"
          empty={
            <AgentEmptyState
              size="compact"
              title="Design your paywall"
              description="Describe the paywall you want. The agent edits the document directly and you can undo anything it does."
              suggestions={SUGGESTIONS}
              onSuggestionSelect={(suggestion) => {
                clearError();
                void sendMessage({ text: suggestion }, { body: requestBody() });
              }}
            />
          }
          renderToolPart={({ part }) => <ToolCard part={part} />}
        >
          {busy ? <AgentTypingIndicator /> : null}
          {error ? (
            <AgentError size="compact">
              {error.message || "The agent request failed."}
            </AgentError>
          ) : null}
        </AgentMessageList>
      </div>

      <div className="shrink-0 border-t border-slate-100 p-2">
        <AgentComposer
          size="compact"
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onStop={() => void stop()}
          busy={busy}
          placeholder="Ask the agent to change the paywall…"
          label="Message the paywall agent"
        />
      </div>
    </div>
  );
}

function ToolCard({ part }: { part: AgentToolPart }) {
  const name = part.type.replace(/^tool-/, "");
  const output = part.output as ToolOutput | undefined;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed =
    part.state === "output-error" || (part.state === "output-available" && output?.ok === false);
  const summary =
    name === "listNodes"
      ? "Read the layers"
      : output?.summary ?? name.replace(/([A-Z])/g, " $1").toLowerCase();

  return (
    <AgentToolCard
      size="compact"
      status={running ? "running" : failed ? "failed" : "done"}
      label={
        running
          ? `${name}…`
          : failed
            ? output?.error ?? part.errorText ?? `${name} failed`
            : summary
      }
    />
  );
}
