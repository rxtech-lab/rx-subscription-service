"use client";

import { Ellipsis } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ClientPortal } from "@/components/ui/client-portal";
import { Button } from "@/components/ui/primitives";

/**
 * A rule between two runs of related items — editing here, state changes there,
 * destructive last. Placed by the menu that knows what belongs together, and
 * only where the grouping is real; a rule between every item is just noise.
 *
 * Keep it inside the same condition as the group it introduces, so a group that
 * renders nothing does not leave a rule behind.
 */
export function ActionMenuDivider() {
  return <div role="separator" className="mx-1 my-1 h-px bg-slate-100" />;
}

export function ActionMenu({
  children,
  label = "Open actions",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ right: 8, top: 8 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const positionMenu = useCallback(() => {
    const trigger = rootRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= menu.offsetHeight + 8
        ? rect.bottom + 6
        : Math.max(8, rect.top - menu.offsetHeight - 6);
    setPosition({
      right: Math.max(8, window.innerWidth - rect.right),
      top,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
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
    <div ref={rootRef} className="inline-flex">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-8 px-0"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </Button>
      <ClientPortal>
        {/*
         * `w-max` sizes the panel to its widest item, so items styled `w-full`
         * fill it rather than spilling past a `min-w` panel. The cap keeps a
         * long label — a plan name inside a Cancel action, say — from running
         * off screen; it wraps instead, which is why items get an auto height
         * here rather than the button variant's fixed one.
         */}
        <div
          ref={menuRef}
          hidden={!open}
          aria-label="Actions"
          className="fixed z-40 w-max min-w-44 max-w-[min(18rem,calc(100vw-1rem))] rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10 [&_a]:h-auto [&_a]:min-h-8 [&_a]:py-1.5 [&_a]:text-left [&_button]:h-auto [&_button]:min-h-8 [&_button]:py-1.5 [&_button]:text-left"
          style={position}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) setOpen(false);
          }}
        >
          {children}
        </div>
      </ClientPortal>
    </div>
  );
}
