"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { ClientPortal } from "@/components/ui/client-portal";
import { nodeLabel } from "@/lib/paywall/operations";
import {
  isLayoutType,
  type NodeType,
  type PaywallNode,
  type PaywallSpec,
} from "@/lib/paywall/schema";
import { cn } from "@/lib/utils";
import { NODE_ICONS, NodeTypeGrid } from "./node-menu";

interface LayersPanelProps {
  spec: PaywallSpec;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (parentId: string, type: NodeType) => void;
  onShift: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, parentId: string, index: number) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
}

const DRAG_TYPE = "application/x-paywall-node";

/**
 * The document as a tree. Buttons do everything — add, reorder, duplicate,
 * delete — and dragging a row onto another is a shortcut for the same moves:
 * onto a layout node appends inside it, onto a leaf lands after it. A
 * right-click offers the same set, plus copy and paste, from the shared menu.
 */
export function LayersPanel({
  spec,
  selectedId,
  onSelect,
  onAdd,
  onShift,
  onRemove,
  onDuplicate,
  onMove,
  onContextMenu,
}: LayersPanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [palette, setPalette] = useState<{
    parentId: string;
    anchor: HTMLButtonElement;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const parentOf = (id: string): { parent: PaywallNode; index: number } | null => {
    const visit = (node: PaywallNode): { parent: PaywallNode; index: number } | null => {
      const children = node.children ?? [];
      const index = children.findIndex((child) => child.id === id);
      if (index >= 0) return { parent: node, index };
      for (const child of children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(spec.root);
  };

  const drop = (event: DragEvent, target: PaywallNode) => {
    event.preventDefault();
    setDropTarget(null);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    if (!id || id === target.id) return;
    if (isLayoutType(target.type)) {
      onMove(id, target.id, target.children?.length ?? 0);
      return;
    }
    const location = parentOf(target.id);
    if (!location) return;
    onMove(id, location.parent.id, location.index + 1);
  };

  const renderNode = (node: PaywallNode, depth: number, index: number, siblings: number) => {
    const isRoot = node.id === spec.root.id;
    const layout = isLayoutType(node.type);
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isCollapsed = collapsed.has(node.id);
    const selected = selectedId === node.id;
    const Icon = NODE_ICONS[node.type];

    return (
      <li key={node.id}>
        <div
          role="treeitem"
          aria-selected={selected}
          aria-expanded={layout ? !isCollapsed : undefined}
          data-node-id={node.id}
          draggable={!isRoot}
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, node.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            if (dropTarget !== node.id) setDropTarget(node.id);
          }}
          onDragLeave={() => setDropTarget((current) => (current === node.id ? null : current))}
          onDrop={(event) => drop(event, node)}
          onClick={() => onSelect(node.id)}
          onContextMenu={
            onContextMenu
              ? (event) => {
                  event.preventDefault();
                  setPalette(null);
                  onSelect(node.id);
                  onContextMenu(node.id, event.clientX, event.clientY);
                }
              : undefined
          }
          className={cn(
            "group flex h-8 cursor-default items-center gap-1 rounded-lg pr-1 text-xs transition",
            selected ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100",
            dropTarget === node.id && "ring-2 ring-inset ring-blue-400",
          )}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggle(node.id);
            }}
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded text-slate-400",
              hasChildren ? "hover:bg-slate-200/70 hover:text-slate-700" : "invisible",
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            )}
          </button>
          <Icon
            className={cn("size-3.5 shrink-0", selected ? "text-blue-600" : "text-slate-400")}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate font-medium">{nodeLabel(node)}</span>
          {nodeLabel(node) !== node.type ? (
            <span className="hidden shrink-0 text-[10px] text-slate-400 group-hover:hidden sm:inline">
              {node.type}
            </span>
          ) : null}

          <div
            className={cn(
              "shrink-0 items-center",
              palette?.parentId === node.id ? "flex" : "hidden group-hover:flex",
            )}
          >
            {layout ? (
              <RowButton
                label={`Add inside ${nodeLabel(node)}`}
                ariaControls={palette?.parentId === node.id ? "paywall-node-palette" : undefined}
                expanded={palette?.parentId === node.id}
                hasPopup="menu"
                onClick={(anchor) =>
                  setPalette((current) =>
                    current?.parentId === node.id ? null : { parentId: node.id, anchor },
                  )
                }
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </RowButton>
            ) : null}
            {!isRoot ? (
              <>
                <RowButton label="Move up" disabled={index === 0} onClick={() => onShift(node.id, -1)}>
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                </RowButton>
                <RowButton
                  label="Move down"
                  disabled={index === siblings - 1}
                  onClick={() => onShift(node.id, 1)}
                >
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                </RowButton>
                <RowButton label="Duplicate" onClick={() => onDuplicate(node.id)}>
                  <CopyPlus className="size-3.5" aria-hidden="true" />
                </RowButton>
                <RowButton label="Delete" danger onClick={() => onRemove(node.id)}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </RowButton>
              </>
            ) : null}
          </div>
        </div>

        {palette?.parentId === node.id ? (
          <Palette
            anchor={palette.anchor}
            depth={depth}
            onPick={(type) => {
              onAdd(node.id, type);
              setPalette(null);
              setCollapsed((current) => {
                if (!current.has(node.id)) return current;
                const next = new Set(current);
                next.delete(node.id);
                return next;
              });
            }}
            onClose={() => setPalette(null)}
          />
        ) : null}

        {layout && hasChildren && !isCollapsed ? (
          <ul role="group">
            {node.children!.map((child, childIndex) =>
              renderNode(child, depth + 1, childIndex, node.children!.length),
            )}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className="px-2 py-3">
      <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
        Layers
      </p>
      <ul role="tree" aria-label="Paywall layers" className="space-y-0.5">
        {renderNode(spec.root, 0, 0, 1)}
      </ul>
      <p className="mt-4 px-2 text-[11px] leading-4 text-slate-400">
        Hover a row for actions, or right-click one for the full menu. Drag a row onto a layout
        to move it inside, or onto another node to place it after.
      </p>
    </div>
  );
}

function RowButton({
  label,
  onClick,
  disabled,
  danger,
  ariaControls,
  expanded,
  hasPopup,
  children,
}: {
  label: string;
  onClick: (button: HTMLButtonElement) => void;
  disabled?: boolean;
  danger?: boolean;
  ariaControls?: string;
  expanded?: boolean;
  hasPopup?: "menu";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-controls={ariaControls}
      aria-expanded={expanded}
      aria-haspopup={hasPopup}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event.currentTarget);
      }}
      className={cn(
        "flex size-6 items-center justify-center rounded text-slate-400 transition disabled:opacity-30",
        danger ? "hover:bg-rose-50 hover:text-rose-600" : "hover:bg-slate-200/70 hover:text-slate-800",
      )}
    >
      {children}
    </button>
  );
}

function Palette({
  anchor,
  depth,
  onPick,
  onClose,
}: {
  anchor: HTMLButtonElement;
  depth: number;
  onPick: (type: NodeType) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 208 });

  const positionPalette = useCallback(() => {
    const menu = ref.current;
    const tree = anchor.closest<HTMLElement>('[role="tree"]');
    if (!menu || !tree) return;

    const anchorRect = anchor.getBoundingClientRect();
    const treeRect = tree.getBoundingClientRect();
    const indent = 6 + depth * 14;
    const width = Math.min(224, Math.max(180, treeRect.width - indent));
    const left = Math.min(
      Math.max(8, treeRect.left + indent),
      Math.max(8, window.innerWidth - width - 8),
    );

    // Apply the width before measuring so the above/below decision uses the
    // menu's final wrapped height rather than its initial fallback width.
    menu.style.width = `${width}px`;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const top =
      spaceBelow >= menu.offsetHeight + 8
        ? anchorRect.bottom + 6
        : Math.max(8, anchorRect.top - menu.offsetHeight - 6);

    setPosition({ left, top, width });
  }, [anchor, depth]);

  useLayoutEffect(() => {
    positionPalette();
    window.addEventListener("resize", positionPalette);
    window.addEventListener("scroll", positionPalette, true);
    return () => {
      window.removeEventListener("resize", positionPalette);
      window.removeEventListener("scroll", positionPalette, true);
    };
  }, [positionPalette]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.contains(target) && !ref.current?.contains(target)) onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [anchor, onClose]);

  return (
    <ClientPortal>
      <div
        id="paywall-node-palette"
        ref={ref}
        role="menu"
        aria-label="Add node"
        className="fixed z-50 max-h-[calc(100vh-1rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10"
        style={position}
      >
        <NodeTypeGrid onPick={onPick} />
      </div>
    </ClientPortal>
  );
}
