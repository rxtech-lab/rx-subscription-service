"use client";

import Editor, { type Monaco } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { SDK_TYPES } from "@/lib/testing/sdk-types";

/**
 * The code editor for a suite.
 *
 * The whole reason a suite is a TypeScript file rather than a form is that the
 * editor can know the vocabulary: `SDK_TYPES` is loaded as an ambient library,
 * so `rx.` completes, `expect()` is typed, and a call the harness does not
 * implement is red before the suite is ever run. The same string is embedded in
 * the assistant's prompt, so the model is writing against the declarations you
 * are reading.
 *
 * Monaco is fetched from a CDN by the loader. That is fine in a browser with
 * network access and useless without one, so a plain textarea takes over if it
 * has not arrived — a developer offline can still fix a suite.
 */

const FALLBACK_AFTER_MS = 8000;

function configure(monaco: Monaco) {
  const ts = monaco.languages.typescript;

  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    noEmit: true,
    allowNonTsExtensions: true,
    lib: ["esnext", "dom"],
  });

  // The suite has no imports, so the globals have to come from somewhere: an
  // ambient module that augments `global` is exactly the shape the harness
  // produces at run time.
  ts.typescriptDefaults.setExtraLibs([
    { content: SDK_TYPES, filePath: "file:///rx-testing.d.ts" },
  ]);
}

export function SuiteEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const [degraded, setDegraded] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!mounted.current) setDegraded(true);
    }, FALLBACK_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  if (degraded) {
    return (
      <div className="flex h-full flex-col">
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          The code editor could not load. Editing as plain text.
        </p>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          className="h-full w-full flex-1 resize-none border-0 bg-white p-4 font-mono text-[13px] leading-6 text-slate-800 outline-none"
        />
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      defaultLanguage="typescript"
      path="file:///suite.ts"
      value={value}
      onChange={(next) => onChange(next ?? "")}
      beforeMount={configure}
      onMount={() => {
        mounted.current = true;
      }}
      loading={
        <p className="text-xs text-slate-400">Loading the editor…</p>
      }
      options={{
        readOnly,
        fontSize: 13,
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        padding: { top: 14, bottom: 14 },
        tabSize: 2,
        automaticLayout: true,
        smoothScrolling: true,
        fixedOverflowWidgets: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      }}
    />
  );
}
