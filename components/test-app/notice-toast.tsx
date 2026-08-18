"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, TriangleAlert, X } from "lucide-react";
import { ClientPortal } from "@/components/ui/client-portal";

const TONES = {
  ok: {
    Icon: CircleCheck,
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    close: "text-emerald-700 hover:bg-emerald-100 focus-visible:ring-emerald-500",
  },
  warn: {
    Icon: TriangleAlert,
    className: "border-amber-200 bg-amber-50 text-amber-800",
    close: "text-amber-700 hover:bg-amber-100 focus-visible:ring-amber-500",
  },
  bad: {
    Icon: CircleAlert,
    className: "border-rose-200 bg-rose-50 text-rose-800",
    close: "text-rose-700 hover:bg-rose-100 focus-visible:ring-rose-500",
  },
} as const;

export type NoticeTone = keyof typeof TONES;

/** How long a success toast stays up before it fades itself out. */
const OK_TIMEOUT_MS = 5000;

/**
 * The outcome of the last storefront action, floated over the page instead of
 * pushed into the layout — the test-mode banner is the only thing that gets to
 * move content around. Success toasts clear themselves; warnings and errors
 * wait to be read, since they usually name the next thing to try.
 */
export function NoticeToast({
  tone,
  message,
}: {
  tone: NoticeTone;
  message: string;
}) {
  const [visible, setVisible] = useState(true);
  const { Icon, className, close } = TONES[tone];

  useEffect(() => {
    if (tone !== "ok") return;
    const timer = setTimeout(() => setVisible(false), OK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [tone]);

  if (!visible) return null;

  return (
    <ClientPortal>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 sm:justify-end sm:px-6">
        <div
          role="status"
          aria-live="polite"
          className={`animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-lg shadow-slate-900/10 ${className}`}
        >
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{message}</p>
          <button
            type="button"
            onClick={() => setVisible(false)}
            aria-label="Dismiss"
            className={`-mr-1 rounded-md p-1 transition focus-visible:outline-none focus-visible:ring-2 ${close}`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </ClientPortal>
  );
}
