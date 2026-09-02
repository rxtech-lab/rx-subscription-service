"use client";

import {
  ArrowLeft,
  Braces,
  Bot,
  History as HistoryIcon,
  Moon,
  Palette,
  Redo2,
  Save,
  SlidersHorizontal,
  Sun,
  Undo2,
  CloudUpload,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  previewProductsAction,
  publishPaywallAction,
  restorePaywallVersionAction,
  savePaywallDraftAction,
  type PaywallVersionData,
} from "@/app/actions/paywalls";
import { Badge, Button, Select } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { SAMPLE_PRODUCTS, type CatalogProduct } from "@/lib/paywall/export";
import {
  hasDeviceLayout,
  paywallSpecForDevice,
  withPaywallDeviceRoot,
  withoutPaywallDeviceLayout,
} from "@/lib/paywall/device-design";
import {
  cloneNode,
  defaultNodeFor,
  duplicateNode,
  findNode,
  findParent,
  insertNode,
  moveNode,
  nodeLabel,
  pasteNode,
  PaywallEditError,
  removeNode,
  shiftNode,
  updateNodeProps,
  collectIds,
} from "@/lib/paywall/operations";
import type {
  Modifiers,
  NodeType,
  PaywallNode,
  PaywallSpec,
  PaywallTheme,
} from "@/lib/paywall/schema";
import { cn } from "@/lib/utils";
import { AgentPanel } from "./agent-panel";
import { PhoneCanvas } from "./canvas";
import {
  isMaterialDevice,
  type PaywallDevicePresetId,
} from "./device-presets";
import { ExportDialog } from "./export-dialog";
import { Inspector, MaterialYouEditor, ThemeEditor } from "./inspector";
import { JsonPanel } from "./json-panel";
import { LayersPanel } from "./layers-panel";
import {
  NodeContextMenu,
  type NodeMenuActions,
  type NodeMenuTarget,
} from "./node-menu";
import {
  clampEditorPanelWidth,
  DEFAULT_EDITOR_PANEL_WIDTH,
  MIN_EDITOR_PANEL_WIDTH,
} from "./panel-width";
import type { ColorScheme } from "./paywall-renderer";
import { VersionsPanel } from "./versions-panel";

/**
 * The paywall editor.
 *
 * One document, four ways to change it — the layers tree, the inspector, the
 * JSON tab, and the agent — all funnelled through `commit`, so undo and redo
 * see every edit the same way regardless of where it came from. Right-clicking
 * a node, on the canvas or in the layers tree, opens the same menu over the
 * same handlers. Consecutive keystrokes in one field share a `coalesceKey` and
 * collapse into one history entry; an agent turn does the same with its message
 * id.
 */

export interface EditorPaywall {
  id: string;
  name: string;
  description: string | null;
  draftSpec: PaywallSpec;
  publishedSpec: PaywallSpec | null;
  currentVersion: number;
  publishedVersion: number | null;
  publishedAt: string | null;
  updatedAt: string;
}

interface HistoryState {
  spec: PaywallSpec;
  past: PaywallSpec[];
  future: PaywallSpec[];
  coalesceKey: string | null;
}

type HistoryAction =
  | { type: "commit"; spec: PaywallSpec; coalesceKey?: string | null }
  | { type: "replace"; spec: PaywallSpec }
  | { type: "endCoalesce" }
  | { type: "undo" }
  | { type: "redo" };

const NOOP = () => {};
const HISTORY_LIMIT = 100;
const PANEL_WIDTH_STORAGE_KEY = "paywall-editor-panel-width";
const PANEL_WIDTH_KEYBOARD_STEP = 24;

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "commit": {
      if (action.spec === state.spec) return state;
      const key = action.coalesceKey ?? null;
      if (key && key === state.coalesceKey) {
        return { ...state, spec: action.spec };
      }
      return {
        spec: action.spec,
        past: [...state.past, state.spec].slice(-HISTORY_LIMIT),
        future: [],
        coalesceKey: key,
      };
    }
    case "replace":
      return { spec: action.spec, past: [], future: [], coalesceKey: null };
    case "endCoalesce":
      return state.coalesceKey === null ? state : { ...state, coalesceKey: null };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        spec: previous,
        past: state.past.slice(0, -1),
        future: [state.spec, ...state.future],
        coalesceKey: null,
      };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        spec: next,
        past: [...state.past, state.spec].slice(-HISTORY_LIMIT),
        future: rest,
        coalesceKey: null,
      };
    }
  }
}

type PanelTab = "inspector" | "theme" | "json" | "versions" | "agent";

const PANEL_TABS: { id: PanelTab; label: string; icon: typeof Braces }[] = [
  { id: "inspector", label: "Inspect", icon: SlidersHorizontal },
  { id: "theme", label: "Theme", icon: Palette },
  { id: "json", label: "JSON", icon: Braces },
  { id: "versions", label: "History", icon: HistoryIcon },
  { id: "agent", label: "Agent", icon: Bot },
];

function upsertVersion(
  versions: PaywallVersionData[],
  version: PaywallVersionData,
): PaywallVersionData[] {
  return [version, ...versions.filter((entry) => entry.version !== version.version)].sort(
    (left, right) => right.version - left.version,
  );
}

/** Whether a keystroke belongs to a text field rather than to the editor. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest(".monaco-editor")) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function PaywallEditor({
  paywall,
  applications,
  versions: initialVersions,
}: {
  paywall: EditorPaywall;
  applications: { id: string; name: string }[];
  versions: PaywallVersionData[];
}) {
  const [history, dispatch] = useReducer(historyReducer, {
    spec: paywall.draftSpec,
    past: [],
    future: [],
    coalesceKey: null,
  });
  const spec = history.spec;
  const [previewDevice, setPreviewDevice] = useState<PaywallDevicePresetId>("mobile");
  const activeSpec = useMemo(
    () => paywallSpecForDevice(spec, previewDevice),
    [previewDevice, spec],
  );

  const [savedJson, setSavedJson] = useState(() => JSON.stringify(paywall.draftSpec));
  const [publishedJson, setPublishedJson] = useState(() =>
    paywall.publishedSpec ? JSON.stringify(paywall.publishedSpec) : null,
  );
  const [publishedAt, setPublishedAt] = useState(paywall.publishedAt);
  const [currentVersion, setCurrentVersion] = useState(paywall.currentVersion);
  const [publishedVersion, setPublishedVersion] = useState(paywall.publishedVersion);
  const [versions, setVersions] = useState(initialVersions);
  const [selectedId, setSelectedId] = useState<string | null>(paywall.draftSpec.root.id);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [scheme, setScheme] = useState<ColorScheme>("light");
  const [tab, setTab] = useState<PanelTab>("inspector");
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  // Copy/paste is editor-local: a detached subtree waiting for a target, which
  // is why it survives selection changes but not a reload.
  const [clipboard, setClipboard] = useState<PaywallNode | null>(null);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuTarget | null>(null);

  const [previewSource, setPreviewSource] = useState("sample");
  const [products, setProducts] = useState<CatalogProduct[]>(SAMPLE_PRODUCTS);

  // The right panel is resizable; its width survives reloads in this browser.
  const [panelWidth, setPanelWidth] = useState(DEFAULT_EDITOR_PANEL_WIDTH);
  const panelWidthRef = useRef(panelWidth);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
      } catch {
        return;
      }
      if (!stored) return;
      const next = clampEditorPanelWidth(Number(stored), window.innerWidth);
      panelWidthRef.current = next;
      setPanelWidth(next);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    // A narrower window shrinks the panel without overwriting the stored width.
    const onResize = () =>
      setPanelWidth((width) => {
        const next = clampEditorPanelWidth(width, window.innerWidth);
        panelWidthRef.current = next;
        return next;
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const storePanelWidth = (width: number) => {
    try {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Storage can be unavailable; the width still applies for this session.
    }
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    const panelRight = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    const next = clampEditorPanelWidth(panelRight - event.clientX, window.innerWidth);
    panelWidthRef.current = next;
    setPanelWidth(next);
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
    storePanelWidth(panelWidthRef.current);
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The panel is anchored right, so moving the handle left widens it.
    const step =
      event.key === "ArrowLeft"
        ? PANEL_WIDTH_KEYBOARD_STEP
        : event.key === "ArrowRight"
          ? -PANEL_WIDTH_KEYBOARD_STEP
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = clampEditorPanelWidth(panelWidth + step, window.innerWidth);
    panelWidthRef.current = next;
    setPanelWidth(next);
    storePanelWidth(next);
  };

  const specJson = useMemo(() => JSON.stringify(spec), [spec]);
  const dirty = specJson !== savedJson;
  const unpublished = publishedJson === null || specJson !== publishedJson;

  // The selection can point at a node the agent or an undo just removed, so it
  // falls back to the root rather than to an empty inspector.
  const selectedNode =
    (selectedId ? findNode(activeSpec, selectedId) : null) ?? activeSpec.root;
  const effectiveSelectedId = selectedNode.id;
  const customizedPresets = useMemo(
    () =>
      new Set<PaywallDevicePresetId>(
        Object.keys(spec.deviceLayouts ?? {}) as PaywallDevicePresetId[],
      ),
    [spec.deviceLayouts],
  );

  const commit = useCallback(
    (next: PaywallSpec, coalesceKey?: string | null) =>
      dispatch({ type: "commit", spec: next, coalesceKey }),
    [],
  );
  const endCoalesce = useCallback(() => dispatch({ type: "endCoalesce" }), []);

  /** Run a tree operation, surfacing its validation message as a toast. */
  const edit = useCallback(
    (operation: () => PaywallSpec, coalesceKey?: string) => {
      try {
        const next = operation();
        commit(withPaywallDeviceRoot(spec, previewDevice, next.root), coalesceKey);
      } catch (error) {
        if (error instanceof PaywallEditError) {
          toast.error(error.message);
          return;
        }
        throw error;
      }
    },
    [commit, previewDevice, spec],
  );

  const save = useCallback(async () => {
    if (busy || restoringVersion !== null) return false;
    setBusy("save");
    const result = await savePaywallDraftAction({ paywallId: paywall.id, spec });
    setBusy(null);
    if (result.error) {
      toast.error(result.error);
      return false;
    }
    setSavedJson(JSON.stringify(spec));
    if (result.version) {
      setCurrentVersion(result.version.version);
      setVersions((current) => upsertVersion(current, result.version!));
      toast.success(`Draft saved as version ${result.version.version}`);
    } else {
      toast.success("Draft saved");
    }
    return true;
  }, [busy, paywall.id, restoringVersion, spec]);

  const publish = useCallback(async () => {
    if (busy || restoringVersion !== null) return;
    setBusy("publish");
    const result = await publishPaywallAction({ paywallId: paywall.id, spec });
    setBusy(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const json = JSON.stringify(spec);
    setSavedJson(json);
    setPublishedJson(json);
    setPublishedAt(result.publishedAt ?? new Date().toISOString());
    if (result.version) {
      setCurrentVersion(result.version.version);
      setPublishedVersion(result.version.version);
      setVersions((current) => upsertVersion(current, result.version!));
      toast.success(
        `Version ${result.version.version} published. Assigned applications now show it.`,
      );
    } else {
      toast.success("Published. Assigned applications now show this version.");
    }
  }, [busy, paywall.id, restoringVersion, spec]);

  const restoreVersion = useCallback(
    async (version: number) => {
      if (busy || dirty || restoringVersion !== null || version === currentVersion) return;
      setRestoringVersion(version);
      const result = await restorePaywallVersionAction({ paywallId: paywall.id, version });
      setRestoringVersion(null);
      if (result.error || !result.spec || !result.version) {
        toast.error(result.error ?? "Could not restore that version.");
        return;
      }

      const json = JSON.stringify(result.spec);
      dispatch({ type: "replace", spec: result.spec });
      setSavedJson(json);
      setCurrentVersion(result.version.version);
      setVersions((current) => upsertVersion(current, result.version!));
      setSelectedId(result.spec.root.id);
      setHoverId(null);
      toast.success(`Version ${version} restored as version ${result.version.version}.`);
    },
    [busy, currentVersion, dirty, paywall.id, restoringVersion],
  );

  const removeNodeById = useCallback(
    (id: string) => {
      if (id === activeSpec.root.id) return;
      const parent = findParent(activeSpec, id);
      edit(() => removeNode(activeSpec, id));
      if (effectiveSelectedId === id) setSelectedId(parent?.parent.id ?? activeSpec.root.id);
    },
    [activeSpec, edit, effectiveSelectedId],
  );

  const removeSelected = useCallback(
    () => removeNodeById(effectiveSelectedId),
    [effectiveSelectedId, removeNodeById],
  );

  const copyNodeById = useCallback(
    (id: string) => {
      const node = findNode(activeSpec, id);
      if (!node) return;
      setClipboard(structuredClone(node));
      toast.success(`Copied ${nodeLabel(node)}`);
    },
    [activeSpec],
  );

  /**
   * Paste beside the target — inside it when it takes children, after it when
   * it does not. The copy's ids are minted up front so the new subtree can be
   * selected whether or not the insert is the one that ends up committed.
   */
  const pasteBesideNode = useCallback(
    (targetId: string) => {
      if (!clipboard) {
        toast.error("Copy a layer first.");
        return;
      }
      const copy = cloneNode(clipboard, collectIds(activeSpec.root));
      edit(() => pasteNode(activeSpec, copy, targetId));
      setSelectedId(copy.id);
    },
    [activeSpec, clipboard, edit],
  );

  // Shortcuts read the latest handlers through refs so one listener suffices.
  const shortcuts = useRef({
    save,
    removeSelected,
    copySelected: NOOP,
    pasteIntoSelected: NOOP,
    duplicateSelected: NOOP,
  });
  useEffect(() => {
    shortcuts.current = {
      save,
      removeSelected,
      copySelected: () => copyNodeById(effectiveSelectedId),
      pasteIntoSelected: () => pasteBesideNode(effectiveSelectedId),
      duplicateSelected: () => {
        if (effectiveSelectedId === activeSpec.root.id) return;
        edit(() => duplicateNode(activeSpec, effectiveSelectedId));
      },
    };
  }, [activeSpec, copyNodeById, edit, effectiveSelectedId, pasteBesideNode, removeSelected, save]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void shortcuts.current.save();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        return;
      }
      if (meta && event.key.toLowerCase() === "c") {
        // Only when nothing is selected on the page, so a real text copy wins.
        if (!window.getSelection()?.isCollapsed) return;
        event.preventDefault();
        shortcuts.current.copySelected();
        return;
      }
      if (meta && event.key.toLowerCase() === "v") {
        event.preventDefault();
        shortcuts.current.pasteIntoSelected();
        return;
      }
      if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        shortcuts.current.duplicateSelected();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        shortcuts.current.removeSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const changePreviewSource = useCallback(async (value: string) => {
    setPreviewSource(value);
    if (value === "sample") {
      setProducts(SAMPLE_PRODUCTS);
      return;
    }
    const result = await previewProductsAction({ applicationId: value });
    if (result.error || !result.products) {
      toast.error(result.error ?? "Could not load that application's plans.");
      return;
    }
    setProducts(result.products);
  }, []);

  const changeProps = useCallback(
    (id: string, patch: Record<string, unknown>, coalesceKey?: string) =>
      edit(() => updateNodeProps(activeSpec, id, { props: patch }), coalesceKey),
    [activeSpec, edit],
  );
  const changeModifiers = useCallback(
    (id: string, patch: Modifiers, coalesceKey?: string) =>
      edit(() => updateNodeProps(activeSpec, id, { modifiers: patch }), coalesceKey),
    [activeSpec, edit],
  );
  const changeTheme = useCallback(
    (patch: Partial<PaywallTheme>, coalesceKey?: string) =>
      commit(
        {
          ...spec,
          theme: {
            ...spec.theme,
            ...patch,
            colors: { ...spec.theme.colors, ...(patch.colors ?? {}) },
          },
        },
        coalesceKey,
      ),
    [commit, spec],
  );

  const addChild = useCallback(
    (parentId: string, type: NodeType) => {
      const node = defaultNodeFor(type, collectIds(activeSpec.root));
      edit(() => insertNode(activeSpec, parentId, undefined, node));
      setSelectedId(node.id);
    },
    [activeSpec, edit],
  );

  /** The one set of node moves behind the layers panel and the right-click menu. */
  const nodeActions = useMemo<NodeMenuActions>(
    () => ({
      onAdd: addChild,
      onShift: (id, delta) => edit(() => shiftNode(activeSpec, id, delta)),
      onDuplicate: (id) => edit(() => duplicateNode(activeSpec, id)),
      onCopy: copyNodeById,
      onPaste: pasteBesideNode,
      onRemove: removeNodeById,
    }),
    [activeSpec, addChild, copyNodeById, edit, pasteBesideNode, removeNodeById],
  );

  const openNodeMenu = useCallback(
    (id: string, x: number, y: number) => setNodeMenu({ id, x, y }),
    [],
  );
  const closeNodeMenu = useCallback(() => setNodeMenu(null), []);

  const changePreviewDevice = useCallback(
    (device: PaywallDevicePresetId) => {
      setPreviewDevice(device);
      setSelectedId(paywallSpecForDevice(spec, device).root.id);
      setHoverId(null);
      setNodeMenu(null);
    },
    [spec],
  );

  const resetDeviceLayout = useCallback(() => {
    if (previewDevice === "mobile" || !hasDeviceLayout(spec, previewDevice)) return;
    const next = withoutPaywallDeviceLayout(spec, previewDevice);
    commit(next);
    setSelectedId(next.root.id);
    setHoverId(null);
    toast.success("Custom device design reset to the iPhone layout.");
  }, [commit, previewDevice, spec]);

  const changeMaterialSeed = useCallback(
    (seedColor: string, coalesceKey?: string) =>
      commit({ ...spec, materialYou: { seedColor } }, coalesceKey),
    [commit, spec],
  );

  return (
    <div className="flex h-screen flex-col bg-[#f7f8fc] text-slate-900">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Link
          href="/paywalls"
          prefetch={false}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Paywalls
        </Link>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{paywall.name}</p>
          <p className="truncate text-[11px] text-slate-400">
            {publishedAt
              ? `Draft v${currentVersion} · Published v${publishedVersion} ${new Date(publishedAt).toLocaleString()}`
              : `Draft v${currentVersion} · Never published`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {dirty ? <Badge tone="amber">Unsaved</Badge> : <Badge tone="neutral">Saved</Badge>}
          {unpublished ? <Badge tone="blue">Unpublished changes</Badge> : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 bg-white">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-9 px-0"
              aria-label="Undo"
              title="Undo (⌘Z)"
              disabled={history.past.length === 0}
              onClick={() => dispatch({ type: "undo" })}
            >
              <Undo2 className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-9 px-0"
              aria-label="Redo"
              title="Redo (⇧⌘Z)"
              disabled={history.future.length === 0}
              onClick={() => dispatch({ type: "redo" })}
            >
              <Redo2 className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-9 px-0"
            aria-label={scheme === "light" ? "Preview in dark mode" : "Preview in light mode"}
            onClick={() => setScheme((current) => (current === "light" ? "dark" : "light"))}
          >
            {scheme === "light" ? (
              <Moon className="size-4" aria-hidden="true" />
            ) : (
              <Sun className="size-4" aria-hidden="true" />
            )}
          </Button>

          <Select
            aria-label="Preview products"
            className="h-8 w-44 text-xs"
            value={previewSource}
            onChange={(event) => void changePreviewSource(event.target.value)}
          >
            <option value="sample">Sample products</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.name}
              </option>
            ))}
          </Select>

          <ExportDialog
            paywallId={paywall.id}
            spec={spec}
            applications={applications}
            hasPublished={publishedJson !== null}
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!dirty || busy !== null || restoringVersion !== null}
            onClick={() => void save()}
          >
            <Save className="size-3.5" aria-hidden="true" />
            {busy === "save" ? "Saving…" : "Save draft"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={restoringVersion !== null || busy !== null || (!unpublished && !dirty)}
            onClick={() => void publish()}
          >
            <CloudUpload className="size-3.5" aria-hidden="true" />
            {busy === "publish" ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </header>

      <div
        className={cn("grid min-h-0 flex-1", resizing && "select-none")}
        style={{ gridTemplateColumns: `16rem minmax(0, 1fr) ${panelWidth}px` }}
      >
        <aside className="min-h-0 overflow-y-auto border-r border-slate-200 bg-white">
          <LayersPanel
            spec={activeSpec}
            selectedId={effectiveSelectedId}
            onSelect={setSelectedId}
            onAdd={nodeActions.onAdd}
            onShift={nodeActions.onShift}
            onRemove={nodeActions.onRemove}
            onDuplicate={nodeActions.onDuplicate}
            onContextMenu={openNodeMenu}
            onMove={(id, parentId, index) =>
              edit(() => moveNode(activeSpec, id, parentId, index))
            }
          />
        </aside>

        <section
          className="min-h-0 bg-[radial-gradient(circle,rgba(148,163,184,0.35)_1px,transparent_1px)] [background-size:18px_18px]"
          aria-label="Preview"
        >
          <PhoneCanvas
            spec={spec}
            products={products}
            scheme={scheme}
            mode="edit"
            preset={previewDevice}
            onPresetChange={changePreviewDevice}
            customizedPresets={customizedPresets}
            onResetLayout={resetDeviceLayout}
            showDevicePicker
            selectedId={effectiveSelectedId}
            hoverId={hoverId}
            onSelect={setSelectedId}
            onHover={setHoverId}
            onContextMenu={openNodeMenu}
          />
        </section>

        <aside
          ref={panelRef}
          className="relative flex min-h-0 flex-col border-l border-slate-200 bg-white"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            aria-valuenow={panelWidth}
            aria-valuemin={MIN_EDITOR_PANEL_WIDTH}
            tabIndex={0}
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={resizeWithKeyboard}
            className={cn(
              "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none",
              "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-blue-400 focus-visible:outline-none focus-visible:after:bg-blue-500",
              resizing ? "after:bg-blue-500" : "after:bg-transparent",
            )}
          />
          <div className="flex shrink-0 border-b border-slate-200">
            {PANEL_TABS.map((entry) => {
              const Icon = entry.icon;
              const active = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-semibold transition",
                    active
                      ? "border-blue-600 text-blue-700"
                      : "border-transparent text-slate-500 hover:text-slate-900",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {entry.label}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === "inspector" ? (
              <div className="h-full overflow-y-auto">
                <Inspector
                  node={selectedNode}
                  isRoot={selectedNode.id === activeSpec.root.id}
                  products={products}
                  materialYou={isMaterialDevice(previewDevice)}
                  onChangeProps={changeProps}
                  onChangeModifiers={changeModifiers}
                  onEndCoalesce={endCoalesce}
                />
              </div>
            ) : null}
            {tab === "theme" ? (
              <div className="h-full overflow-y-auto">
                {isMaterialDevice(previewDevice) ? (
                  <MaterialYouEditor
                    seedColor={spec.materialYou?.seedColor}
                    scheme={scheme}
                    onChange={changeMaterialSeed}
                    onEndCoalesce={endCoalesce}
                  />
                ) : (
                  <ThemeEditor
                    theme={spec.theme}
                    onChange={changeTheme}
                    onEndCoalesce={endCoalesce}
                  />
                )}
              </div>
            ) : null}
            {tab === "json" ? <JsonPanel spec={spec} onApply={(next) => commit(next)} /> : null}
            {tab === "versions" ? (
              <VersionsPanel
                versions={versions}
                currentVersion={currentVersion}
                publishedVersion={publishedVersion}
                products={products}
                scheme={scheme}
                previewDevice={previewDevice}
                dirty={dirty}
                restoringVersion={restoringVersion}
                onRestore={(version) => void restoreVersion(version)}
              />
            ) : null}
            {tab === "agent" ? (
              <AgentPanel
                paywallId={paywall.id}
                spec={activeSpec}
                products={products}
                onApply={(next, key) =>
                  commit(
                    withPaywallDeviceRoot(
                      {
                        ...spec,
                        theme: next.theme,
                        materialYou: next.materialYou ?? spec.materialYou,
                      },
                      previewDevice,
                      next.root,
                    ),
                    key,
                  )
                }
              />
            ) : null}
          </div>
        </aside>
      </div>

      {nodeMenu ? (
        <NodeContextMenu
          key={nodeMenu.id}
          spec={activeSpec}
          target={nodeMenu}
          clipboard={clipboard}
          actions={nodeActions}
          onClose={closeNodeMenu}
        />
      ) : null}
    </div>
  );
}
