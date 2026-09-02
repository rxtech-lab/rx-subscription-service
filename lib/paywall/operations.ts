import {
  isLayoutType,
  MAX_TABS,
  type NodeType,
  type Modifiers,
  type PaywallNode,
  type PaywallSpec,
} from "./schema";

/**
 * Pure, immutable edits to a paywall tree.
 *
 * Every function returns a new spec and leaves its input untouched, which is
 * what makes undo a matter of keeping the previous object around. The same
 * functions serve the layers panel, the inspector, and the agent's tools, so a
 * rule enforced here — you cannot drop a node into its own descendant — holds
 * no matter who is editing.
 */

export class PaywallEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaywallEditError";
  }
}

export function findNode(spec: PaywallSpec, id: string): PaywallNode | null {
  const visit = (node: PaywallNode): PaywallNode | null => {
    if (node.id === id) return node;
    for (const child of node.children ?? []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(spec.root);
}

export function findParent(
  spec: PaywallSpec,
  id: string,
): { parent: PaywallNode; index: number } | null {
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
}

/** Every id in the tree, so callers can mint a fresh one that cannot clash. */
export function collectIds(node: PaywallNode, into = new Set<string>()): Set<string> {
  into.add(node.id);
  for (const child of node.children ?? []) collectIds(child, into);
  return into;
}

export function isDescendant(ancestor: PaywallNode, id: string): boolean {
  return (ancestor.children ?? []).some(
    (child) => child.id === id || isDescendant(child, id),
  );
}

function mapTree(
  node: PaywallNode,
  transform: (node: PaywallNode) => PaywallNode,
): PaywallNode {
  const next = transform(node);
  if (!next.children) return next;
  const children = next.children.map((child) => mapTree(child, transform));
  return { ...next, children };
}

function withRoot(spec: PaywallSpec, root: PaywallNode): PaywallSpec {
  return { ...spec, root };
}

function requireNode(spec: PaywallSpec, id: string): PaywallNode {
  const node = findNode(spec, id);
  if (!node) throw new PaywallEditError(`No node with id "${id}".`);
  return node;
}

/** Merge props and modifiers into a node; `undefined` values remove a key. */
export function updateNodeProps(
  spec: PaywallSpec,
  id: string,
  patch: { props?: Record<string, unknown>; modifiers?: Modifiers },
): PaywallSpec {
  requireNode(spec, id);
  return withRoot(
    spec,
    mapTree(spec.root, (node) => {
      if (node.id !== id) return node;
      const next: PaywallNode = { ...node };
      if (patch.props) next.props = mergeDropUndefined(node.props, patch.props);
      if (patch.modifiers) {
        const merged = mergeDropUndefined(
          (node.modifiers ?? {}) as Record<string, unknown>,
          patch.modifiers as Record<string, unknown>,
        ) as Modifiers;
        if (Object.keys(merged).length) next.modifiers = merged;
        else delete next.modifiers;
      }
      return next;
    }),
  );
}

/** Replace a node's props wholesale, keeping id, type, modifiers and children. */
export function replaceNodeProps(
  spec: PaywallSpec,
  id: string,
  props: Record<string, unknown>,
): PaywallSpec {
  requireNode(spec, id);
  return withRoot(
    spec,
    mapTree(spec.root, (node) => (node.id === id ? { ...node, props } : node)),
  );
}

function mergeDropUndefined(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * A TabView's `tabs` are positional — the nth entry titles the nth child — so
 * every structural edit has to carry them along. Adding a child adds a title,
 * removing one drops its title, and a move (a remove plus an insert) takes the
 * title with the content. Without this the labels would silently slide onto
 * the wrong pages the first time anyone reordered a tab.
 */
interface TabEntry {
  title: string;
  icon?: string;
  badge?: string;
}

function tabsOf(props: Record<string, unknown>): TabEntry[] {
  return Array.isArray(props.tabs) ? ([...props.tabs] as TabEntry[]) : [];
}

function withTabInserted(props: Record<string, unknown>, index: number): Record<string, unknown> {
  const tabs = tabsOf(props);
  tabs.splice(Math.min(index, tabs.length), 0, { title: `Tab ${tabs.length + 1}` });
  return { ...props, tabs };
}

function withTabRemoved(props: Record<string, unknown>, index: number): Record<string, unknown> {
  const tabs = tabsOf(props);
  if (index >= tabs.length) return props;
  tabs.splice(index, 1);
  return { ...props, tabs };
}

/** The entry titling the child at `index`, or null if the parent has no tabs. */
function tabEntryAt(parent: PaywallNode | undefined, index: number): TabEntry | null {
  if (!parent || parent.type !== "TabView" || index < 0) return null;
  return tabsOf(parent.props)[index] ?? null;
}

/**
 * Re-title the tab now holding `id` with the entry its content arrived with.
 * A move is a removal and an insertion, and the insertion only knows how to
 * mint a fresh "Tab 3"; this puts the real title back where the content went.
 */
function withCarriedTab(
  spec: PaywallSpec,
  id: string,
  entry: TabEntry | null,
): PaywallSpec {
  if (!entry) return spec;
  const location = findParent(spec, id);
  if (!location || location.parent.type !== "TabView") return spec;
  return withRoot(
    spec,
    mapTree(spec.root, (node) => {
      if (node.id !== location.parent.id) return node;
      const tabs = tabsOf(node.props);
      if (location.index >= tabs.length) return node;
      tabs[location.index] = entry;
      return { ...node, props: { ...node.props, tabs } };
    }),
  );
}

export function insertNode(
  spec: PaywallSpec,
  parentId: string,
  index: number | undefined,
  node: PaywallNode,
): PaywallSpec {
  const parent = requireNode(spec, parentId);
  if (!isLayoutType(parent.type)) {
    throw new PaywallEditError(`${parentId} (${parent.type}) cannot hold children.`);
  }
  const existing = collectIds(spec.root);
  for (const id of collectIds(node)) {
    if (existing.has(id)) throw new PaywallEditError(`A node with id "${id}" already exists.`);
  }
  if (parent.type === "TabView" && (parent.children?.length ?? 0) >= MAX_TABS) {
    throw new PaywallEditError(`A TabView holds at most ${MAX_TABS} tabs.`);
  }
  return withRoot(
    spec,
    mapTree(spec.root, (candidate) => {
      if (candidate.id !== parentId) return candidate;
      const children = [...(candidate.children ?? [])];
      const at = clampIndex(index, children.length);
      children.splice(at, 0, node);
      if (candidate.type !== "TabView") return { ...candidate, children };
      return { ...candidate, children, props: withTabInserted(candidate.props, at) };
    }),
  );
}

export function removeNode(spec: PaywallSpec, id: string): PaywallSpec {
  if (spec.root.id === id) throw new PaywallEditError("The root node cannot be removed.");
  requireNode(spec, id);
  return withRoot(
    spec,
    mapTree(spec.root, (node) => {
      const at = node.children?.findIndex((child) => child.id === id) ?? -1;
      if (at < 0) return node;
      const children = node.children!.filter((child) => child.id !== id);
      if (node.type !== "TabView") return { ...node, children };
      return { ...node, children, props: withTabRemoved(node.props, at) };
    }),
  );
}

export function moveNode(
  spec: PaywallSpec,
  id: string,
  parentId: string,
  index: number,
): PaywallSpec {
  if (spec.root.id === id) throw new PaywallEditError("The root node cannot be moved.");
  const node = requireNode(spec, id);
  const target = requireNode(spec, parentId);
  if (!isLayoutType(target.type)) {
    throw new PaywallEditError(`${parentId} (${target.type}) cannot hold children.`);
  }
  if (id === parentId || isDescendant(node, parentId)) {
    throw new PaywallEditError("A node cannot be moved into itself.");
  }
  const location = findParent(spec, id);
  const carried = tabEntryAt(location?.parent, location?.index ?? -1);
  const detached = removeNode(spec, id);
  // Removing an earlier sibling shifts the indices after it by one.
  const adjusted =
    location && location.parent.id === parentId && location.index < index ? index - 1 : index;
  return withCarriedTab(insertNode(detached, parentId, adjusted, node), id, carried);
}

/** Move a node one place among its siblings. */
export function shiftNode(spec: PaywallSpec, id: string, delta: -1 | 1): PaywallSpec {
  const location = findParent(spec, id);
  if (!location) throw new PaywallEditError(`No node with id "${id}".`);
  const next = location.index + delta;
  const count = location.parent.children?.length ?? 0;
  if (next < 0 || next >= count) return spec;
  return moveNode(spec, id, location.parent.id, next > location.index ? next + 1 : next);
}

/** A detached copy of a subtree, every id replaced by one not already taken. */
export function cloneNode(node: PaywallNode, taken?: ReadonlySet<string>): PaywallNode {
  const used = new Set(taken ?? []);
  return mapTree(node, (candidate) => {
    const fresh = newNodeId(candidate.type, used);
    used.add(fresh);
    return { ...candidate, id: fresh };
  });
}

/** Copy a subtree right after the original, with fresh ids throughout. */
export function duplicateNode(spec: PaywallSpec, id: string): PaywallSpec {
  if (spec.root.id === id) throw new PaywallEditError("The root node cannot be duplicated.");
  const node = requireNode(spec, id);
  const location = findParent(spec, id);
  if (!location) throw new PaywallEditError(`No node with id "${id}".`);
  const copy = cloneNode(node, collectIds(spec.root));
  const inserted = insertNode(spec, location.parent.id, location.index + 1, copy);
  return withCarriedTab(inserted, copy.id, tabEntryAt(location.parent, location.index));
}

/**
 * Drop a subtree that came from somewhere else — the clipboard — next to
 * `targetId`: inside it when it can hold children, otherwise after it among its
 * siblings. The node must already carry ids free of this tree, which is what
 * `cloneNode` mints, so the caller knows the pasted id before the edit lands.
 */
export function pasteNode(
  spec: PaywallSpec,
  node: PaywallNode,
  targetId: string,
): PaywallSpec {
  const target = requireNode(spec, targetId);
  if (isLayoutType(target.type)) return insertNode(spec, targetId, undefined, node);
  const location = findParent(spec, targetId);
  if (!location) throw new PaywallEditError(`No node with id "${targetId}".`);
  return insertNode(spec, location.parent.id, location.index + 1, node);
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

/** `text-4f2a` style ids — short enough to type, unique within the tree. */
export function newNodeId(type: NodeType, taken?: ReadonlySet<string>): string {
  const prefix = type.toLowerCase();
  for (;;) {
    const id = `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
    if (!taken?.has(id)) return id;
  }
}

/** A sensible starting node for the palette's "add" button. */
export function defaultNodeFor(type: NodeType, taken?: ReadonlySet<string>): PaywallNode {
  const id = newNodeId(type, taken);
  switch (type) {
    case "VStack":
      return { id, type, props: { spacing: 12, alignment: "leading" }, children: [] };
    case "HStack":
      return { id, type, props: { spacing: 8, alignment: "center" }, children: [] };
    case "ZStack":
      return { id, type, props: { alignment: "center" }, children: [] };
    case "Grid":
      return { id, type, props: { columns: 2, spacing: 12 }, children: [] };
    case "List":
      return { id, type, props: { spacing: 0, showsSeparators: true }, children: [] };
    case "ScrollView":
      return { id, type, props: { axis: "vertical" }, children: [] };
    case "TabView": {
      // Two pages so the node is usable the moment it lands on the canvas;
      // both ids are reserved against the same set so they cannot collide.
      const used = new Set(taken ?? []);
      used.add(id);
      const pages = ["Monthly", "Yearly"].map(() => {
        const pageId = newNodeId("VStack", used);
        used.add(pageId);
        return pageId;
      });
      return {
        id,
        type,
        props: {
          tabs: [{ title: "Monthly" }, { title: "Yearly" }],
          selectedIndex: 0,
          style: "segmented",
          spacing: 16,
        },
        children: pages.map((pageId) => ({
          id: pageId,
          type: "VStack" as const,
          props: { spacing: 12, alignment: "center" },
          children: [],
        })),
      };
    }
    case "Text":
      return { id, type, props: { text: "New text", style: "body" } };
    case "Image":
      return { id, type, props: { systemName: "star.fill", width: 48, height: 48, tint: "primary" } };
    case "Button":
      return {
        id,
        type,
        props: { label: "Continue", action: { type: "purchase" }, style: "filled", fullWidth: true },
      };
    case "Spacer":
      return { id, type, props: {} };
    case "Divider":
      return { id, type, props: {} };
    case "Badge":
      return { id, type, props: { text: "Most popular", color: "accent" } };
    case "FeatureRow":
      return { id, type, props: { icon: "checkmark.circle.fill", title: "A benefit" } };
    case "Link":
      return { id, type, props: { text: "Terms of service", url: "https://example.com/terms" } };
    case "ProductList":
      return {
        id,
        type,
        props: { layout: "vertical", style: "card", highlight: "first", showTrialBadge: true },
      };
  }
}

export interface OutlineEntry {
  id: string;
  type: NodeType;
  label: string;
  depth: number;
}

/** A flat, indented listing — what the layers panel shows and the agent reads. */
export function outline(spec: PaywallSpec): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const visit = (node: PaywallNode, depth: number) => {
    entries.push({ id: node.id, type: node.type, label: nodeLabel(node), depth });
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(spec.root, 0);
  return entries;
}

/** A short human label: the text of a Text, the label of a Button, else the type. */
export function nodeLabel(node: PaywallNode): string {
  const props = node.props;
  const candidate =
    (typeof props.text === "string" && props.text) ||
    (typeof props.label === "string" && props.label) ||
    (typeof props.title === "string" && props.title) ||
    (typeof props.systemName === "string" && props.systemName) ||
    "";
  const trimmed = candidate.trim();
  if (!trimmed) return node.type;
  return trimmed.length > 32 ? `${trimmed.slice(0, 31)}…` : trimmed;
}
