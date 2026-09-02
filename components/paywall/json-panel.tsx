"use client";

import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { validatePaywallSpec, type PaywallSpec } from "@/lib/paywall/schema";

const FALLBACK_AFTER_MS = 8000;

function format(spec: PaywallSpec): string {
  return JSON.stringify(spec, null, 2);
}

/**
 * The document as text. Edits here stay local until Apply; a change from
 * anywhere else replaces the text as long as it has not been touched, so the
 * tab never silently discards typing.
 */
export function JsonPanel({
  spec,
  onApply,
}: {
  spec: PaywallSpec;
  onApply: (spec: PaywallSpec) => void;
}) {
  const formatted = format(spec);
  const [text, setText] = useState(formatted);
  // The document as last seen from outside. When it changes and the buffer was
  // untouched, the buffer follows; typed edits are never overwritten.
  const [mirrored, setMirrored] = useState(formatted);
  if (formatted !== mirrored) {
    setMirrored(formatted);
    if (text === mirrored) setText(formatted);
  }
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const mounted = useRef(false);
  const dirty = text !== formatted;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!mounted.current) setDegraded(true);
    }, FALLBACK_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid JSON");
      return;
    }
    const result = validatePaywallSpec(parsed);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onApply(result.spec);
    setText(format(result.spec));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-[11px] text-slate-500">
          {dirty ? "Edited — apply to update the preview." : "Mirrors the document."}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!dirty}
            onClick={() => {
              setText(formatted);
              setError(null);
            }}
          >
            Revert
          </Button>
          <Button type="button" size="sm" disabled={!dirty} onClick={apply}>
            Apply
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        {degraded ? (
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            aria-label="Paywall JSON"
            className="h-full w-full resize-none border-0 bg-white p-3 font-mono text-[12px] leading-5 text-slate-800 outline-none"
          />
        ) : (
          <Editor
            height="100%"
            defaultLanguage="json"
            path="file:///paywall.json"
            value={text}
            onChange={(next) => setText(next ?? "")}
            onMount={() => {
              mounted.current = true;
            }}
            loading={<p className="p-3 text-xs text-slate-400">Loading the editor…</p>}
            options={{
              fontSize: 12,
              lineHeight: 20,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderLineHighlight: "line",
              padding: { top: 10, bottom: 10 },
              tabSize: 2,
              automaticLayout: true,
              wordWrap: "on",
              fixedOverflowWidgets: true,
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            }}
          />
        )}
      </div>
    </div>
  );
}
