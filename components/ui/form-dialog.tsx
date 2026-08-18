"use client";

import { KeyRound, PencilLine, Plus, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ClientPortal } from "@/components/ui/client-portal";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const FormDialogContext = createContext<(() => void) | null>(null);

export function useCloseFormDialog() {
  return useContext(FormDialogContext);
}

const iconFor = {
  plus: Plus,
  edit: PencilLine,
  key: KeyRound,
};

const widthFor = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
};

export function FormDialog({
  triggerLabel,
  title,
  description,
  children,
  icon = "plus",
  size = "md",
  triggerVariant = "primary",
  triggerSize = "md",
}: {
  triggerLabel: string;
  title: string;
  description?: string;
  children: ReactNode;
  icon?: keyof typeof iconFor;
  size?: keyof typeof widthFor;
  triggerVariant?:
    | "primary"
    | "secondary"
    | "ghost"
    | "menu"
    | "menuDanger";
  triggerSize?: "sm" | "md";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const TriggerIcon = iconFor[icon];

  const closeDialog = useCallback(() => {
    dialogRef.current?.close();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (open && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        onClick={() => setOpen(true)}
      >
        <TriggerIcon className="size-3.5" aria-hidden="true" />
        {triggerLabel}
      </Button>

      <ClientPortal>
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          onCancel={() => setOpen(false)}
          onClose={() => setOpen(false)}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
          className={cn(
            "m-auto w-[calc(100%-2rem)] overflow-hidden rounded-2xl bg-transparent p-0 text-left text-slate-900 backdrop:bg-slate-950/55 backdrop:backdrop-blur-sm",
            widthFor[size],
          )}
        >
          {open ? (
            <FormDialogContext.Provider value={closeDialog}>
              <div className="flex max-h-[min(86vh,760px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
                  <div>
                    <h2
                      id={titleId}
                      className="text-base font-semibold text-slate-950"
                    >
                      {title}
                    </h2>
                    {description ? (
                      <p
                        id={descriptionId}
                        className="mt-1 max-w-lg text-sm leading-6 text-slate-500"
                      >
                        {description}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={closeDialog}
                    aria-label="Close dialog"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </header>
                <div className="overflow-y-auto px-6 py-5">{children}</div>
              </div>
            </FormDialogContext.Provider>
          ) : null}
        </dialog>
      </ClientPortal>
    </>
  );
}
