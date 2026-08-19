"use client";

import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Toaster as SonnerToaster, toast } from "sonner";

export { toast };

/** Mounted once in the root layout; every form in the app toasts into it. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "rounded-xl shadow-lg shadow-slate-900/10",
        },
      }}
    />
  );
}

/**
 * A spinner toast that lives exactly as long as the enclosing form is
 * submitting. Render it inside any `<form action={…}>` — it reads the form's
 * own pending state, so it works for plain server actions that return nothing
 * and never needs the action itself to be rewrapped.
 */
export function FormPendingToast({
  message = "Working…",
}: {
  message?: string;
}) {
  const { pending } = useFormStatus();
  const toastId = useRef<string | number | null>(null);

  useEffect(() => {
    if (pending) {
      toastId.current ??= toast.loading(message);
      return;
    }
    if (toastId.current !== null) {
      toast.dismiss(toastId.current);
      toastId.current = null;
    }
  }, [message, pending]);

  // An action that redirects unmounts this form mid-flight, and a loading toast
  // has no timeout — without this the spinner would outlive the navigation.
  useEffect(
    () => () => {
      if (toastId.current !== null) toast.dismiss(toastId.current);
    },
    [],
  );

  return null;
}

/**
 * `<form action={serverAction}>` with the pending spinner already wired in, for
 * the forms that live in server components and so cannot render a hook of their
 * own.
 */
export function ToastForm({
  pendingMessage,
  children,
  ...props
}: ComponentProps<"form"> & { pendingMessage?: string; children: ReactNode }) {
  return (
    <form {...props}>
      {children}
      <FormPendingToast message={pendingMessage} />
    </form>
  );
}

interface ActionResult {
  error?: string;
  success?: string;
}

/**
 * Wrap a `useActionState` action so one toast covers the whole round trip: it
 * starts as a spinner and is replaced in place by the outcome, rather than a
 * spinner being dismissed and a second toast raised next to it.
 */
export function withActionToast<State extends ActionResult>(
  action: (state: State, formData: FormData) => Promise<State>,
  messages: { pending: string; success: string },
): (state: State, formData: FormData) => Promise<State> {
  return async (state, formData) => {
    const toastId = toast.loading(messages.pending);
    try {
      const result = await action(state, formData);
      if (result?.error) toast.error(result.error, { id: toastId });
      else toast.success(result?.success ?? messages.success, { id: toastId });
      return result;
    } catch (error) {
      // `redirect()` and `notFound()` surface as throws: the navigation is the
      // outcome, so drop the spinner and let the error through untouched.
      toast.dismiss(toastId);
      throw error;
    }
  };
}
