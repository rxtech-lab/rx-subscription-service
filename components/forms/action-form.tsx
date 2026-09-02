"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/primitives";
import { useCloseFormDialog } from "@/components/ui/form-dialog";
import { FormPendingToast, withActionToast } from "@/components/ui/toast";
import type { ActionState } from "@/app/actions/shared";

type CopyStatus = "idle" | "copied" | "error";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Clipboard access can be unavailable outside a secure context. Keep a
    // selection-based fallback so the one-time secret is still copyable.
  }

  const textArea = document.createElement("textarea");
  const previouslyFocused = document.activeElement;
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();

  const copied = document.execCommand("copy");
  textArea.remove();

  if (previouslyFocused instanceof HTMLElement) {
    previouslyFocused.focus({ preventScroll: true });
  }
  if (!copied) throw new Error("Clipboard copy failed");
}

function SubmitButton({
  label,
  pendingLabel = "Saving…",
}: {
  label: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Wraps a server action with its pending and error state. Forms stay server
 * components apart from this shell, so the fields themselves are plain HTML and
 * submit without JavaScript.
 */
export function ActionForm({
  action,
  submitLabel = "Save",
  pendingLabel,
  children,
  className,
  autoComplete,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  pendingLabel?: string;
  children: ReactNode;
  className?: string;
  autoComplete?: "on" | "off";
}) {
  // The toast carries the outcome once the dialog has closed itself, so the
  // wrapper has to sit between the form and the action rather than in an effect.
  const toastedAction = useMemo(
    () =>
      withActionToast(action, {
        pending: pendingLabel ?? "Saving…",
        success: "Saved.",
      }),
    [action, pendingLabel],
  );
  const [state, formAction] = useActionState(toastedAction, {});
  const closeDialog = useCloseFormDialog();

  useEffect(() => {
    if (state.success) closeDialog?.();
  }, [closeDialog, state.success]);

  return (
    <form
      action={formAction}
      className={className}
      autoComplete={autoComplete}
    >
      {children}
      <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        {state.error ? (
          <p className="mr-auto min-w-0 text-sm text-rose-600">
            {state.error}
          </p>
        ) : null}
        {closeDialog ? (
          <Button type="button" size="sm" variant="secondary" onClick={closeDialog}>
            Cancel
          </Button>
        ) : null}
        <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
      </div>
    </form>
  );
}

/** Same shell, but surfaces a generated API key exactly once. */
export function ApiKeyForm({
  action,
  children,
}: {
  action: (
    state: { error?: string; success?: string; secret?: string },
    formData: FormData,
  ) => Promise<{ error?: string; success?: string; secret?: string }>;
  children: ReactNode;
}) {
  const toastedAction = useMemo(
    () =>
      withActionToast(action, {
        pending: "Creating API key…",
        success: "API key created.",
      }),
    [action],
  );
  const [state, formAction] = useActionState(toastedAction, {});
  const closeDialog = useCloseFormDialog();
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  if (state.secret) {
    const isCopied = copyStatus === "copied";

    return (
      <div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <KeyRound className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-emerald-950">
                API key created
              </h3>
              <p className="mt-1 text-sm leading-5 text-emerald-800">
                Copy and store this key securely. You will not be able to see it
                again.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-700">Your API key</p>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-slate-950 p-2 ring-1 ring-slate-900/10">
            <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap px-2 font-mono text-xs text-slate-100">
              {state.secret}
            </code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0 border-white/15 bg-white/10 text-white shadow-none hover:border-white/25 hover:bg-white/15"
              aria-label={isCopied ? "API key copied" : "Copy API key"}
              onClick={async () => {
                try {
                  await copyText(state.secret!);
                  setCopyStatus("copied");
                } catch {
                  setCopyStatus("error");
                }
              }}
            >
              {isCopied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {isCopied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p
            aria-live="polite"
            className={`mt-2 min-h-5 text-xs ${
              copyStatus === "error" ? "text-rose-600" : "text-slate-500"
            }`}
          >
            {copyStatus === "error"
              ? "Could not copy automatically. Select the key and copy it manually."
              : isCopied
                ? "Copied to clipboard."
                : "This is the only time the full key will be shown."}
          </p>
        </div>

        <div className="mt-6 flex justify-end border-t border-slate-100 pt-4">
          <Button type="button" size="sm" onClick={closeDialog ?? undefined}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {children}
      <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        {state.error ? (
          <p className="mr-auto min-w-0 text-sm text-rose-600">
            {state.error}
          </p>
        ) : null}
        {closeDialog ? (
          <Button type="button" size="sm" variant="secondary" onClick={closeDialog}>
            {state.secret ? "Done" : "Cancel"}
          </Button>
        ) : null}
        <SubmitButton label="Create key" />
      </div>
    </form>
  );
}

/** A one-button form for destructive or single-field actions. */
export function InlineActionButton({
  action,
  label,
  variant = "ghost",
  confirmMessage,
  pendingLabel,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  label: string;
  variant?:
    | "primary"
    | "secondary"
    | "ghost"
    | "danger"
    | "menu"
    | "menuDanger";
  confirmMessage?: string;
  pendingLabel?: string;
  children?: ReactNode;
}) {
  return (
    <form
      action={action}
      className={variant === "menu" || variant === "menuDanger" ? "block" : "inline"}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {children}
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
      {/* These actions return nothing and usually redirect, so the spinner is
          tied to the form's own pending state and the page reports the rest. */}
      <FormPendingToast message={pendingLabel ?? `${label}…`} />
    </form>
  );
}
