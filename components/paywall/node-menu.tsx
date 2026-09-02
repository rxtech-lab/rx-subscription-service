"use client";

import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Columns3,
  Copy,
  CopyPlus,
  Image as ImageIcon,
  Layers2,
  LayoutGrid,
  LayoutPanelTop,
  Link as LinkIcon,
  List as ListIcon,
  ListChecks,
  Minus,
  MousePointerClick,
  Plus,
  Rows3,
  ScrollText,
  ShoppingBag,
  SquareStack,
  Tag,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClientPortal } from "@/components/ui/client-portal";
import { findNode, findParent, nodeLabel } from "@/lib/paywall/operations";
import {
  isLayoutType,
  NODE_DESCRIPTIONS,
  NODE_GROUPS,
  type NodeType,
  type PaywallNode,
  type PaywallSpec,
} from "@/lib/paywall/schema";
import { cn } from "@/lib/utils";

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
  VStack: Rows3,
  HStack: Columns3,
  ZStack: Layers2,
  Grid: LayoutGrid,
  List: ListIcon,
  ScrollView: ScrollText,
  TabView: LayoutPanelTop,
  Text: Type,
  Image: ImageIcon,
  Button: MousePointerClick,
  Spacer: SquareStack,
  Divider: Minus,
  Badge: Tag,
  FeatureRow: ListChecks,
  Link: LinkIcon,
  ProductList: ShoppingBag,
};

/** The node types to pick from, grouped — shared by every "add" affordance. */
export function NodeTypeGrid({ onPick }: { onPick: (type: NodeType) => void }) {
  return (
    <>
      {NODE_GROUPS.map((group) => (
        <div key={group.label} className="mb-2 last:mb-0">
          <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {group.label}
          </p>
          <div className="grid grid-cols-2 gap-1">
            {group.types.map((type) => {
              const Icon = NODE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  title={NODE_DESCRIPTIONS[type]}
                  onClick={() => onPick(type)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 transition hover:bg-blue-50 hover:text-blue-800"
                >
                  <Icon className="size-3.5 text-slate-400" aria-hidden="true" />
                  {type}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/** Where a right-click landed: the node it hit and the point to open at. */
export interface NodeMenuTarget {
  id: string;
  x: number;
  y: number;
}

export interface NodeMenuActions {
  onAdd: (parentId: string, type: NodeType) => void;
  onShift: (id: string, delta: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onCopy: (id: string) => void;
  onPaste: (targetId: string) => void;
  onRemove: (id: string) => void;
}

const MENU_MARGIN = 8;
const MENU_WIDTH = 232;

/**
 * The right-click menu for a node, shared by the canvas and the layers panel so
 * both offer exactly the same moves. It is positioned at the pointer and flips
 * back inside the viewport when it would otherwise run off an edge.
 *
 * Paste lands inside the node when it can hold children, and after it when it
 * cannot — the same rule `pasteNode` enforces, spelled out in the item's label.
 */
export function NodeContextMenu({
  spec,
  target,
  clipboard,
  actions,
  onClose,
}: {
  spec: PaywallSpec;
  target: NodeMenuTarget;
  clipboard: PaywallNode | null;
  actions: NodeMenuActions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  const [adding, setAdding] = useState(false);

  const node = findNode(spec, target.id);
  const isRoot = node?.id === spec.root.id;
  const location = node ? findParent(spec, node.id) : null;
  const siblings = location?.parent.children?.length ?? 0;
  const layout = node ? isLayoutType(node.type) : false;

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { offsetWidth, offsetHeight } = menu;
    const left = Math.max(
      MENU_MARGIN,
      Math.min(target.x, window.innerWidth - offsetWidth - MENU_MARGIN),
    );
    const top =
      target.y + offsetHeight + MENU_MARGIN <= window.innerHeight
        ? target.y
        : Math.max(MENU_MARGIN, window.innerHeight - offsetHeight - MENU_MARGIN);
    setPosition({ left, top });
  }, [adding, target.x, target.y]);

  useEffect(() => {
    // Without `preventScroll` the browser scrolls a menu opened near an edge
    // into view, and the scroll listener below reads that as "the page moved"
    // and closes the menu the same frame it opened.
    ref.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = current < 0 ? (step === 1 ? 0 : items.length - 1) : current + step;
      items[(next + items.length) % items.length].focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    // Scrolling anywhere moves the node out from under a menu pinned to the
    // viewport, so the menu goes away rather than pointing at the wrong thing.
    // A scroll is delivered at the next rendering update rather than when it
    // happens, so one the browser had already queued before the menu opened —
    // scrolling the right-clicked row into view, say — would otherwise close
    // the menu on the frame it appeared. Listening from the next frame leaves
    // that scroll to the click that caused it.
    const frame = requestAnimationFrame(() => {
      window.addEventListener("scroll", onClose, true);
      window.addEventListener("resize", onClose);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (!node) return null;

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <ClientPortal>
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        aria-label={`${nodeLabel(node)} actions`}
        data-testid="paywall-node-menu"
        onContextMenu={(event) => event.preventDefault()}
        className="fixed z-50 max-h-[calc(100vh-1rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10 focus:outline-none"
        style={{ ...position, width: MENU_WIDTH }}
      >
        <p className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          <span className="truncate">{nodeLabel(node)}</span>
          <span className="ml-auto shrink-0 font-mono text-[9px] normal-case tracking-normal">
            {node.type}
          </span>
        </p>

        {layout ? (
          <>
            <MenuItem
              icon={Plus}
              label="Add child"
              expanded={adding}
              onClick={() => setAdding((current) => !current)}
            />
            {adding ? (
              <div className="mb-1 rounded-lg bg-slate-50 p-1">
                <NodeTypeGrid onPick={(type) => run(() => actions.onAdd(node.id, type))} />
              </div>
            ) : null}
            <Separator />
          </>
        ) : null}

        <MenuItem
          icon={ArrowUp}
          label="Move up"
          disabled={isRoot || location === null || location.index === 0}
          onClick={() => run(() => actions.onShift(node.id, -1))}
        />
        <MenuItem
          icon={ArrowDown}
          label="Move down"
          disabled={isRoot || location === null || location.index === siblings - 1}
          onClick={() => run(() => actions.onShift(node.id, 1))}
        />

        <Separator />

        <MenuItem
          icon={Copy}
          label="Copy"
          shortcut="⌘C"
          onClick={() => run(() => actions.onCopy(node.id))}
        />
        <MenuItem
          icon={ClipboardPaste}
          label={clipboard ? (layout ? "Paste inside" : "Paste after") : "Paste"}
          shortcut="⌘V"
          disabled={!clipboard}
          hint={clipboard ? nodeLabel(clipboard) : "Nothing copied"}
          onClick={() => run(() => actions.onPaste(node.id))}
        />
        <MenuItem
          icon={CopyPlus}
          label="Duplicate"
          shortcut="⌘D"
          disabled={isRoot}
          onClick={() => run(() => actions.onDuplicate(node.id))}
        />

        <Separator />

        <MenuItem
          icon={Trash2}
          label="Delete"
          shortcut="⌫"
          danger
          disabled={isRoot}
          onClick={() => run(() => actions.onRemove(node.id))}
        />
      </div>
    </ClientPortal>
  );
}

function Separator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-slate-100" />;
}

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  hint,
  disabled,
  danger,
  expanded,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition",
        "disabled:pointer-events-none disabled:opacity-40",
        danger
          ? "text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
          : "text-slate-700 hover:bg-blue-50 hover:text-blue-800 focus:bg-blue-50 focus:text-blue-800",
        "focus:outline-none",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", danger ? "text-rose-400" : "text-slate-400")} aria-hidden="true" />
      <span className="truncate">{label}</span>
      {hint ? (
        <span className="ml-auto max-w-24 shrink-0 truncate text-[10px] font-normal text-slate-400">
          {hint}
        </span>
      ) : null}
      {shortcut ? (
        <span
          className={cn(
            "shrink-0 font-mono text-[10px] font-normal text-slate-400",
            hint ? "ml-1.5" : "ml-auto",
          )}
          aria-hidden="true"
        >
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
