"use client";

import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/primitives";
import { FormPendingToast } from "@/components/ui/toast";

export function UserMenu({
  displayName,
  email,
  sidebar = false,
}: {
  displayName: string;
  email?: string;
  sidebar?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const avatarLabel = displayName.trim().charAt(0).toUpperCase() || "A";
  const showEmail = Boolean(email) && email !== displayName;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((current) => !current)}
        className={`flex min-w-0 items-center gap-3 rounded-full py-2 px-3 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${sidebar ? "w-full flex-row-reverse justify-end bg-blue-100/50" : ""}`}
      >
        <span className={sidebar ? "block min-w-0 text-left" : "hidden min-w-0 text-right sm:block"}>
          <span className="block truncate text-sm font-medium text-slate-800">
            {displayName}
          </span>
          {showEmail ? (
            <span className="block truncate text-xs text-slate-400">{email}</span>
          ) : null}
        </span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white ring-4 ring-slate-100">
          {avatarLabel}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className={`absolute z-40 w-56 max-w-full rounded-2xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10 ${sidebar ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"}`}
        >
          {/* The trigger hides the identity below `sm`, so repeat it here. */}
          <div className="px-3 py-2 sm:hidden">
            <p className="truncate text-sm font-medium text-slate-900">
              {displayName}
            </p>
            {showEmail ? (
              <p className="truncate text-xs text-slate-400">{email}</p>
            ) : null}
          </div>
          <div className="mx-2 h-px bg-slate-100 sm:hidden" />

          <form action={signOutAction}>
            <Button type="submit" role="menuitem" variant="menuDanger" size="sm">
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
            <FormPendingToast message="Signing out…" />
          </form>
        </div>
      ) : null}
    </div>
  );
}
