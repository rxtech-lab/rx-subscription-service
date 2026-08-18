"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-3 mt-5 text-lg font-semibold tracking-tight text-slate-950 first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-2 mt-5 text-base font-semibold text-slate-950 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-950 first:mt-0">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="mb-3 leading-6 text-slate-700 last:mb-0">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-950">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 ml-5 list-disc space-y-1.5 text-slate-700 marker:text-slate-400 last:mb-0">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-slate-700 marker:font-medium marker:text-slate-500 last:mb-0">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="pl-1 leading-6">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-blue-400 bg-blue-50/70 py-2 pl-3 pr-2 text-slate-600">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => {
          const external = href?.startsWith("http://") || href?.startsWith("https://");
          return (
            <a
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noreferrer" : undefined}
              className="font-medium text-blue-700 underline decoration-blue-200 underline-offset-2 transition hover:text-blue-900 hover:decoration-blue-400"
            >
              {children}
            </a>
          );
        },
        code: ({ className, children }) => (
          <code
            className={`rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800 ${className ?? ""}`}
          >
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="my-3 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-slate-100 px-3 py-2 align-top text-slate-600 last:border-b-0">
            {children}
          </td>
        ),
        hr: () => <hr className="my-4 border-slate-200" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
