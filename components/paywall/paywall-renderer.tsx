"use client";

import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  resolvePaywall,
  type CatalogProduct,
  type ResolvedProduct,
  type ResolvedProductList,
} from "@/lib/paywall/export";
import { paywallSpecForDevice } from "@/lib/paywall/device-design";
import {
  materialPaywallTheme,
  materialYouColors,
  type MaterialYouColors,
} from "@/lib/paywall/material-you";
import { SfSymbol } from "./sf-symbol";
import {
  isMaterialDevice,
  paywallDevicePreset,
  type PaywallDevicePreset,
  type PaywallDevicePresetId,
} from "./device-presets";
import {
  TEXT_STYLE_METRICS,
  type Modifiers,
  type PaywallNode,
  type PaywallSpec,
  type PaywallTheme,
  type TextStyle,
} from "@/lib/paywall/schema";

/**
 * The web preview of a paywall.
 *
 * Every node type maps to the CSS that mimics its SwiftUI counterpart closely
 * enough to design against: a VStack is a flex column, a ZStack is a grid with
 * every child in the same cell, a Spacer is `flex: 1`. Sizes are treated as CSS
 * pixels standing in for points. All dynamic values go through inline styles,
 * because Tailwind cannot see a color that lives in a database row.
 *
 * In `edit` mode every node is clickable and the selection is outlined; in
 * `preview` mode the tree is inert.
 */

export type ColorScheme = "light" | "dark";

export interface RendererProps {
  spec: PaywallSpec;
  products: CatalogProduct[];
  scheme: ColorScheme;
  device?: PaywallDevicePresetId;
  mode: "edit" | "preview";
  selectedId?: string | null;
  hoverId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** A right-click on a node, reported at the viewport point it happened. */
  onContextMenu?: (id: string, x: number, y: number) => void;
}

const SEMANTIC = { success: "#16A34A", warning: "#D97706", danger: "#DC2626" } as const;
const DARK_SURFACE = { background: "#0B0F1A", foreground: "#F8FAFC", muted: "#94A3B8" } as const;

/** The scheme actually drawn: a fixed theme ignores the preview toggle. */
export function effectiveScheme(theme: PaywallTheme, requested: ColorScheme): ColorScheme {
  return theme.colorScheme === "system" ? requested : theme.colorScheme;
}

export function resolveColor(
  value: string | undefined,
  theme: PaywallTheme,
  scheme: ColorScheme,
  fallback = theme.colors.foreground,
  automatic = false,
): string {
  if (!value) return fallback;
  if (value.startsWith("#")) return automatic ? fallback : value;
  if (value in SEMANTIC) return SEMANTIC[value as keyof typeof SEMANTIC];
  if (scheme === "dark" && theme.colorScheme === "system" && value in DARK_SURFACE) {
    return DARK_SURFACE[value as keyof typeof DARK_SURFACE];
  }
  const colors = theme.colors as Record<string, string>;
  return colors[value] ?? fallback;
}

export function surfaceColors(theme: PaywallTheme, scheme: ColorScheme) {
  return {
    background: resolveColor("background", theme, scheme),
    foreground: resolveColor("foreground", theme, scheme),
    muted: resolveColor("muted", theme, scheme),
    primary: resolveColor("primary", theme, scheme),
    accent: resolveColor("accent", theme, scheme),
  };
}

export function fontFamilyFor(
  design: PaywallTheme["fontDesign"],
  material = false,
): string {
  if (material) return 'Roboto, "Google Sans", system-ui, sans-serif';
  switch (design) {
    case "rounded":
      return 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    case "serif":
      return 'ui-serif, "New York", Georgia, serif';
    case "monospaced":
      return 'ui-monospace, "SF Mono", Menlo, monospace';
    default:
      return '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
  }
}

/** Contrast text for a filled control. */
export function readableOn(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!match) return "#FFFFFF";
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part, 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? "#0F172A" : "#FFFFFF";
}

function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})/i.exec(hex);
  if (!match) return hex;
  const byte = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `#${match[1]}${byte}`;
}

/** Symbols are drawn from the npm-backed SF Symbols vector set. */
export const SymbolIcon = SfSymbol;

function paddingStyle(padding: Modifiers["padding"]): CSSProperties {
  if (padding === undefined) return {};
  if (typeof padding === "number") return { padding };
  return {
    paddingTop: padding.top,
    paddingLeft: padding.leading,
    paddingBottom: padding.bottom,
    paddingRight: padding.trailing,
  };
}

function modifierStyle(
  modifiers: Modifiers | undefined,
  theme: PaywallTheme,
  scheme: ColorScheme,
  mode: RendererProps["mode"],
  material: MaterialYouColors | null,
): CSSProperties {
  if (!modifiers) return {};
  const style: CSSProperties = { ...paddingStyle(modifiers.padding) };
  if (modifiers.frame) {
    style.width = modifiers.frame.width;
    style.height = modifiers.frame.height;
    style.maxWidth = modifiers.frame.maxWidth;
    style.maxHeight = modifiers.frame.maxHeight;
    if (modifiers.frame.width !== undefined) style.flexShrink = 0;
  }
  if (modifiers.background) {
    style.background = resolveColor(
      modifiers.background,
      theme,
      scheme,
      material?.surfaceContainer ?? theme.colors.background,
      Boolean(material),
    );
  }
  if (modifiers.cornerRadius !== undefined) {
    style.borderRadius = modifiers.cornerRadius;
    style.overflow = "hidden";
  }
  if (modifiers.border) {
    style.border = `${modifiers.border.width}px solid ${resolveColor(
      modifiers.border.color,
      theme,
      scheme,
      material?.outline ?? theme.colors.muted,
      Boolean(material),
    )}`;
  }
  if (modifiers.opacity !== undefined) style.opacity = modifiers.opacity;
  if (modifiers.hidden) {
    if (mode === "preview") style.display = "none";
    else style.opacity = 0.3;
  }
  return style;
}

const ALIGN_ITEMS: Record<string, CSSProperties["alignItems"]> = {
  leading: "flex-start",
  center: "center",
  trailing: "flex-end",
  top: "flex-start",
  bottom: "flex-end",
};

const MATERIAL_TEXT_STYLE_METRICS: typeof TEXT_STYLE_METRICS = {
  largeTitle: { size: 36, weight: 600, lineHeight: 44 },
  title: { size: 32, weight: 500, lineHeight: 40 },
  title2: { size: 28, weight: 500, lineHeight: 36 },
  title3: { size: 24, weight: 500, lineHeight: 32 },
  headline: { size: 22, weight: 500, lineHeight: 28 },
  body: { size: 16, weight: 400, lineHeight: 24 },
  callout: { size: 14, weight: 500, lineHeight: 20 },
  subheadline: { size: 14, weight: 400, lineHeight: 20 },
  footnote: { size: 12, weight: 500, lineHeight: 16 },
  caption: { size: 11, weight: 500, lineHeight: 16 },
};

function zStackPlacement(alignment: string | undefined): CSSProperties {
  const [vertical, horizontal] = (() => {
    switch (alignment) {
      case "topLeading":
        return ["start", "start"];
      case "top":
        return ["start", "center"];
      case "topTrailing":
        return ["start", "end"];
      case "leading":
        return ["center", "start"];
      case "trailing":
        return ["center", "end"];
      case "bottomLeading":
        return ["end", "start"];
      case "bottom":
        return ["end", "center"];
      case "bottomTrailing":
        return ["end", "end"];
      default:
        return ["center", "center"];
    }
  })();
  return { alignItems: vertical, justifyItems: horizontal };
}

interface RenderContext {
  theme: PaywallTheme;
  scheme: ColorScheme;
  device: PaywallDevicePreset;
  material: MaterialYouColors | null;
  mode: RendererProps["mode"];
  selectedId: string | null;
  hoverId: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  /** Set by a parent whose children should stretch (VStack/List) or not. */
  parentAxis: "column" | "row" | "stack" | "grid";
}

function NodeShell({
  node,
  context,
  style,
  children,
  className,
}: {
  node: PaywallNode;
  context: RenderContext;
  style: CSSProperties;
  children?: ReactNode;
  className?: string;
}) {
  const editing = context.mode === "edit";
  const selected = editing && context.selectedId === node.id;
  const hovered = editing && !selected && context.hoverId === node.id;

  const outline = selected
    ? "0 0 0 2px #2563EB"
    : hovered
      ? "0 0 0 1px rgba(37, 99, 235, 0.55)"
      : undefined;

  return (
    <div
      data-node-id={node.id}
      data-node-type={node.type}
      className={className}
      style={{
        position: "relative",
        boxSizing: "border-box",
        minWidth: 0,
        ...style,
        boxShadow: [style.boxShadow, outline].filter(Boolean).join(", ") || undefined,
        cursor: editing ? "default" : undefined,
      }}
      onClick={
        editing
          ? (event: MouseEvent) => {
              event.stopPropagation();
              context.onSelect?.(node.id);
            }
          : undefined
      }
      onContextMenu={
        editing
          ? (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              context.onSelect?.(node.id);
              context.onContextMenu?.(node.id, event.clientX, event.clientY);
            }
          : undefined
      }
      onMouseOver={
        editing
          ? (event: MouseEvent) => {
              event.stopPropagation();
              context.onHover?.(node.id);
            }
          : undefined
      }
      onMouseOut={
        editing
          ? (event: MouseEvent) => {
              event.stopPropagation();
              context.onHover?.(null);
            }
          : undefined
      }
    >
      {children}
      {selected ? (
        <span
          style={{
            position: "absolute",
            top: -18,
            left: -2,
            zIndex: 5,
            padding: "1px 6px",
            borderRadius: 4,
            background: "#2563EB",
            color: "#fff",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: 10,
            fontWeight: 600,
            lineHeight: "16px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {node.type}
        </span>
      ) : null}
    </div>
  );
}

function renderChildren(node: PaywallNode, context: RenderContext, axis: RenderContext["parentAxis"]) {
  return (node.children ?? []).map((child) => (
    <Node key={child.id} node={child} context={{ ...context, parentAxis: axis }} />
  ));
}

function Node({ node, context }: { node: PaywallNode; context: RenderContext }) {
  const { theme, scheme, mode } = context;
  const colors = surfaceColors(theme, scheme);
  const base = modifierStyle(node.modifiers, theme, scheme, mode, context.material);
  const props = node.props as Record<string, never> & Record<string, unknown>;
  // Layout containers fill the cross axis of a column so a paywall reads as a
  // page; inside a row they size to content like SwiftUI would.
  const stretch: CSSProperties =
    context.parentAxis === "column" ? { alignSelf: "stretch" } : {};

  switch (node.type) {
    case "ScrollView": {
      const horizontal = props.axis === "horizontal";
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            ...stretch,
            display: "flex",
            flexDirection: horizontal ? "row" : "column",
            overflowX: horizontal ? "auto" : "hidden",
            overflowY: horizontal ? "hidden" : "auto",
            flex: context.parentAxis === "column" ? "1 1 auto" : undefined,
            minHeight: 0,
            scrollbarWidth: props.showsIndicators === false ? "none" : undefined,
            ...base,
          }}
        >
          {renderChildren(node, context, horizontal ? "row" : "column")}
        </NodeShell>
      );
    }
    case "VStack":
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            ...stretch,
            display: "flex",
            flexDirection: "column",
            alignItems: ALIGN_ITEMS[String(props.alignment ?? "center")],
            gap: (props.spacing as number | undefined) ?? 8,
            ...base,
          }}
        >
          {renderChildren(node, context, "column")}
        </NodeShell>
      );
    case "HStack":
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            ...stretch,
            display: "flex",
            flexDirection: "row",
            alignItems: ALIGN_ITEMS[String(props.alignment ?? "center")],
            gap: (props.spacing as number | undefined) ?? 8,
            ...base,
          }}
        >
          {renderChildren(node, context, "row")}
        </NodeShell>
      );
    case "ZStack":
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            ...stretch,
            display: "grid",
            gridTemplateAreas: '"stack"',
            ...zStackPlacement(props.alignment as string | undefined),
            ...base,
          }}
        >
          {(node.children ?? []).map((child) => (
            <div key={child.id} style={{ gridArea: "stack", display: "flex", minWidth: 0 }}>
              <Node node={child} context={{ ...context, parentAxis: "stack" }} />
            </div>
          ))}
        </NodeShell>
      );
    case "Grid":
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            ...stretch,
            display: "grid",
            gridTemplateColumns: `repeat(${Number(props.columns) || 2}, minmax(0, 1fr))`,
            gap: (props.spacing as number | undefined) ?? 8,
            ...base,
          }}
        >
          {renderChildren(node, context, "grid")}
        </NodeShell>
      );
    case "List": {
      const separators = props.showsSeparators !== false;
      const children = node.children ?? [];
      return (
        <NodeShell
          node={node}
          context={context}
          style={{ ...stretch, display: "flex", flexDirection: "column", ...base }}
        >
          {children.map((child, index) => (
            <div
              key={child.id}
              style={{
                display: "flex",
                flexDirection: "column",
                paddingTop: index === 0 ? 0 : ((props.spacing as number | undefined) ?? 8) / 2,
                paddingBottom:
                  index === children.length - 1 ? 0 : ((props.spacing as number | undefined) ?? 8) / 2,
                borderBottom:
                  separators && index < children.length - 1
                    ? `1px solid ${withAlpha(colors.muted, 0.25)}`
                    : undefined,
              }}
            >
              <Node node={child} context={{ ...context, parentAxis: "column" }} />
            </div>
          ))}
        </NodeShell>
      );
    }
    case "Text": {
      const metrics = (context.material ? MATERIAL_TEXT_STYLE_METRICS : TEXT_STYLE_METRICS)[
        (props.style as TextStyle | undefined) ?? "body"
      ];
      const weight = { regular: 400, medium: 500, semibold: 600, bold: 700 }[
        String(props.weight ?? "")
      ];
      const alignment = String(props.alignment ?? "leading");
      const maxLines = props.maxLines as number | undefined;
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            alignSelf:
              context.parentAxis === "column"
                ? alignment === "center"
                  ? "center"
                  : alignment === "trailing"
                    ? "flex-end"
                    : undefined
                : undefined,
            fontSize: metrics.size,
            lineHeight: `${metrics.lineHeight}px`,
            fontWeight: weight ?? metrics.weight,
            color: resolveColor(
              props.color as string | undefined,
              theme,
              scheme,
              colors.foreground,
              Boolean(context.material),
            ),
            textAlign: alignment === "leading" ? "left" : alignment === "trailing" ? "right" : "center",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            ...(maxLines
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: maxLines,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }
              : {}),
            ...base,
          }}
        >
          {String(props.text ?? "")}
        </NodeShell>
      );
    }
    case "Image": {
      const width = (props.width as number | undefined) ?? (props.url ? 160 : 40);
      const height = (props.height as number | undefined) ?? (props.url ? 120 : 40);
      const tint = resolveColor(
        props.tint as string | undefined,
        theme,
        scheme,
        colors.primary,
        Boolean(context.material),
      );
      return (
        <NodeShell node={node} context={context} style={{ flexShrink: 0, ...base }}>
          {typeof props.url === "string" && props.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote, user-supplied url
            <img
              src={props.url}
              alt=""
              draggable={false}
              style={{
                display: "block",
                width,
                height,
                objectFit: props.contentMode === "fill" ? "cover" : "contain",
                borderRadius: (props.cornerRadius as number | undefined) ?? 0,
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width,
                height,
                borderRadius: (props.cornerRadius as number | undefined) ?? 0,
              }}
            >
              <SymbolIcon name={String(props.systemName ?? "")} size={Math.min(width, height)} color={tint} />
            </div>
          )}
        </NodeShell>
      );
    }
    case "Button": {
      const variant = String(props.style ?? "filled");
      const color = resolveColor(
        props.color as string | undefined,
        theme,
        scheme,
        colors.primary,
        Boolean(context.material),
      );
      const fullWidth = props.fullWidth === true;
      const material = context.material;
      const style: CSSProperties = {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: fullWidth && context.parentAxis === "column" ? "stretch" : undefined,
        width: fullWidth ? "100%" : undefined,
        minHeight: variant === "plain" ? 32 : material ? 48 : 50,
        padding: variant === "plain" ? "6px 8px" : material ? "12px 24px" : "13px 20px",
        borderRadius: material ? 999 : theme.cornerRadius,
        fontSize: material ? 14 : variant === "plain" ? 15 : 17,
        fontWeight: 600,
        lineHeight: material ? "20px" : "22px",
        letterSpacing: material ? "0.01em" : undefined,
        userSelect: "none",
        ...(variant === "filled"
          ? {
              background: material?.primary ?? color,
              color: material?.onPrimary ?? readableOn(color),
            }
          : variant === "outlined"
            ? {
                border: `1.5px solid ${material?.outline ?? color}`,
                color: material?.primary ?? color,
              }
            : { color: material?.primary ?? color }),
        ...base,
      };
      return (
        <NodeShell node={node} context={context} style={style}>
          {String(props.label ?? "")}
        </NodeShell>
      );
    }
    case "Spacer": {
      const minLength = (props.minLength as number | undefined) ?? 0;
      const editing = mode === "edit";
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            flex: "1 1 0",
            minHeight: context.parentAxis === "row" ? undefined : Math.max(minLength, editing ? 12 : 0),
            minWidth: context.parentAxis === "row" ? Math.max(minLength, editing ? 12 : 0) : undefined,
            alignSelf: "stretch",
            backgroundImage: editing
              ? "repeating-linear-gradient(45deg, rgba(100,116,139,0.12) 0 4px, transparent 4px 8px)"
              : undefined,
            borderRadius: 4,
            ...base,
          }}
        />
      );
    }
    case "Divider":
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            alignSelf: "stretch",
            height: 1,
            minHeight: 1,
            background: context.material?.outlineVariant ?? withAlpha(colors.muted, 0.3),
            ...base,
          }}
        />
      );
    case "Badge": {
      const color = resolveColor(
        props.color as string | undefined,
        theme,
        scheme,
        colors.accent,
        Boolean(context.material),
      );
      const material = context.material;
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            display: "inline-flex",
            alignSelf: context.parentAxis === "column" ? "flex-start" : undefined,
            padding: "3px 10px",
            borderRadius: material ? 8 : 999,
            background: material?.secondaryContainer ?? withAlpha(color, 0.16),
            color: material?.onSecondaryContainer ?? color,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            lineHeight: "16px",
            whiteSpace: "nowrap",
            ...base,
          }}
        >
          {String(props.text ?? "")}
        </NodeShell>
      );
    }
    case "FeatureRow":
      return (
        <NodeShell
          node={node}
          context={context}
          style={{ ...stretch, display: "flex", alignItems: "flex-start", gap: 12, ...base }}
        >
          <div
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: context.material ? 12 : 8,
              background:
                context.material?.primaryContainer ?? withAlpha(colors.primary, 0.12),
            }}
          >
            <SymbolIcon
              name={String(props.icon ?? "")}
              size={16}
              color={context.material?.onPrimaryContainer ?? colors.primary}
            />
          </div>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 600, lineHeight: "21px", color: colors.foreground }}>
              {String(props.title ?? "")}
            </span>
            {props.subtitle ? (
              <span style={{ fontSize: 13, lineHeight: "18px", color: colors.muted }}>
                {String(props.subtitle)}
              </span>
            ) : null}
          </div>
        </NodeShell>
      );
    case "Link":
      return (
        <NodeShell
          node={node}
          context={context}
          style={{
            fontSize: 13,
            lineHeight: "18px",
            color: context.material?.primary ?? colors.muted,
            textDecoration: "underline",
            textUnderlineOffset: 3,
            ...base,
          }}
        >
          {String(props.text ?? "")}
        </NodeShell>
      );
    case "TabView":
      return <TabViewNode node={node} context={context} style={{ ...stretch, ...base }} />;
    case "ProductList":
      return <ProductListNode node={node as ResolvedProductList} context={context} style={{ ...stretch, ...base }} />;
  }
}

interface TabEntry {
  title?: string;
  icon?: string;
  badge?: string;
}

interface SegmentItem {
  key: string;
  label: string;
  icon?: string;
  badge?: string;
}

/**
 * The one control behind both a TabView's tab bar and a ProductList's period
 * switcher: the same segmented, pill, underline, and chip looks, so a paywall
 * that uses both does not end up with two different-looking pickers.
 */
function SegmentedBar({
  items,
  activeIndex,
  variant,
  tint,
  bar,
  colors,
  material,
  alignment,
  role,
  onPick,
}: {
  items: SegmentItem[];
  activeIndex: number;
  variant: string;
  tint: string;
  bar: string;
  colors: ReturnType<typeof surfaceColors>;
  material: MaterialYouColors | null;
  alignment?: string;
  role: "tablist" | "group";
  onPick: (index: number) => void;
}) {
  const underline = variant === "underline";
  const chips = variant === "chips";
  const fill = !chips;
  return (
    <div
      role={role}
      style={{
        display: "flex",
        alignSelf: fill && !alignment ? "stretch" : ALIGN_ITEMS[String(alignment ?? "leading")],
        flexWrap: chips ? "wrap" : undefined,
        gap: chips ? 8 : underline ? 4 : 2,
        padding: underline || chips ? 0 : 3,
        borderRadius: variant === "pill" ? 999 : 10,
        background: underline || chips ? "transparent" : bar,
        borderBottom: underline
          ? `1px solid ${material?.outlineVariant ?? withAlpha(colors.muted, 0.25)}`
          : undefined,
      }}
    >
      {items.map((item, index) => {
        const selected = index === activeIndex;
        const filled = selected && (variant === "pill" || chips);
        const labelColor = filled
          ? material?.onPrimary ?? readableOn(tint)
          : selected
            ? tint
            : material?.onSurfaceVariant ?? colors.muted;
        return (
          <button
            key={item.key}
            type="button"
            role={role === "tablist" ? "tab" : "radio"}
            aria-selected={role === "tablist" ? selected : undefined}
            aria-checked={role === "tablist" ? undefined : selected}
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              onPick(index);
            }}
            style={{
              flex: fill ? "1 1 0" : "0 0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              minWidth: 0,
              padding: underline ? "8px 10px 10px" : chips ? "6px 14px" : "7px 10px",
              border: chips
                ? `1px solid ${selected ? tint : material?.outline ?? withAlpha(colors.muted, 0.4)}`
                : "none",
              borderRadius: variant === "pill" || chips ? 999 : 8,
              borderBottom: underline ? `2px solid ${selected ? tint : "transparent"}` : undefined,
              marginBottom: underline ? -1 : undefined,
              background: filled
                ? tint
                : selected && !underline && !chips
                  ? material?.surface ?? colors.background
                  : "transparent",
              boxShadow:
                selected && variant === "segmented" && !material
                  ? "0 1px 2px rgba(15, 23, 42, 0.12)"
                  : undefined,
              color: labelColor,
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: selected ? 600 : 500,
              lineHeight: "18px",
              cursor: "pointer",
            }}
          >
            {item.icon ? <SymbolIcon name={item.icon} size={14} color={labelColor} /> : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.label}
            </span>
            {item.badge ? (
              <span
                style={{
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: withAlpha(filled ? colors.background : selected ? tint : colors.muted, 0.18),
                  color: labelColor,
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: "14px",
                }}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface TabViewProps {
  tabs?: TabEntry[];
  selectedIndex?: number;
  style?: string;
  tint?: string;
  barBackground?: string;
  spacing?: number;
}

function containsNode(node: PaywallNode, id: string): boolean {
  if (node.id === id) return true;
  return (node.children ?? []).some((child) => containsNode(child, id));
}

/**
 * A tab bar over one page per child.
 *
 * The active tab is local to the preview: the document only says which tab the
 * paywall opens on, and clicking a tab here is the designer looking at another
 * page, not an edit. Selecting a node that lives inside a hidden page pulls
 * that page forward, so the canvas can never be showing tab 1 while the
 * inspector edits something on tab 2.
 */
function TabViewNode({
  node,
  context,
  style,
}: {
  node: PaywallNode;
  context: RenderContext;
  style: CSSProperties;
}) {
  const { theme, scheme, material } = context;
  const colors = surfaceColors(theme, scheme);
  const props = node.props as TabViewProps;
  const children = node.children ?? [];
  const tabs = Array.isArray(props.tabs) ? props.tabs : [];
  const count = Math.max(tabs.length, children.length);
  const last = Math.max(count - 1, 0);
  const preferred = Math.min(Math.max(props.selectedIndex ?? 0, 0), last);

  // Remembering which default a click was made against is what lets a new
  // `selectedIndex` from the inspector win back a tab the designer clicked,
  // without an effect that resets it a render late.
  const [choice, setChoice] = useState<{ against: number; index: number } | null>(null);
  const chosen = choice?.against === preferred ? choice.index : null;

  const revealed =
    context.mode === "edit" && context.selectedId
      ? children.findIndex((child) => containsNode(child, context.selectedId!))
      : -1;
  const active = revealed >= 0 ? revealed : Math.min(chosen ?? preferred, last);

  const variant = String(props.style ?? "segmented");
  const tint = material?.primary ?? resolveColor(props.tint, theme, scheme, colors.primary);
  const bar = material
    ? material.surfaceContainer
    : props.barBackground
      ? resolveColor(props.barBackground, theme, scheme)
      : withAlpha(colors.muted, 0.14);
  const page = children[active];

  return (
    <NodeShell
      node={node}
      context={context}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: props.spacing ?? 12,
        ...style,
      }}
    >
      <SegmentedBar
        items={Array.from({ length: Math.max(count, 1) }, (_, index) => ({
          key: String(index),
          label: tabs[index]?.title?.trim() || `Tab ${index + 1}`,
          icon: tabs[index]?.icon,
          badge: tabs[index]?.badge,
        }))}
        activeIndex={active}
        variant={variant}
        tint={tint}
        bar={bar}
        colors={colors}
        material={material}
        role="tablist"
        onPick={(index) => {
          setChoice({ against: preferred, index });
          if (context.mode === "edit") context.onSelect?.(node.id);
        }}
      />
      {page ? (
        <Node node={page} context={{ ...context, parentAxis: "column" }} />
      ) : (
        <div
          style={{
            alignSelf: "stretch",
            padding: 16,
            border: `1px dashed ${withAlpha(colors.muted, 0.5)}`,
            borderRadius: 10,
            color: colors.muted,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {context.mode === "edit"
            ? "This tab has no content yet — drop a node into the TabView."
            : ""}
        </div>
      )}
    </NodeShell>
  );
}

interface PeriodFilterProps {
  style?: string;
  alignment?: string;
}

interface ProductListProps {
  layout?: string;
  style?: string;
  periodFilter?: PeriodFilterProps;
  showTrialBadge?: boolean;
  showSavings?: boolean;
  showDescription?: boolean;
  showPeriod?: boolean;
  showSelector?: boolean;
  spacing?: number;
  cornerRadius?: number;
  borderWidth?: number;
  cardBackground?: string;
  cardBorderColor?: string;
  highlightColor?: string;
  highlightBackground?: string;
  nameColor?: string;
  priceColor?: string;
  detailColor?: string;
}

/** The list's presentation props with every color resolved against the theme. */
interface CardStyle {
  radius: number;
  borderWidth: number;
  cardBackground: string;
  cardBorder: string;
  highlightColor: string;
  highlightBackground: string;
  nameColor: string;
  priceColor: string;
  detailColor: string;
  showDescription: boolean;
  showPeriod: boolean;
  showSelector: boolean;
  showTrial: boolean;
  showSavings: boolean;
}

function cardStyleFor(
  props: ProductListProps,
  theme: PaywallTheme,
  scheme: ColorScheme,
  colors: ReturnType<typeof surfaceColors>,
  material: MaterialYouColors | null,
): CardStyle {
  const highlightColor = material?.primary ?? resolveColor(props.highlightColor, theme, scheme, colors.primary);
  return {
    radius: material ? 16 : props.cornerRadius ?? theme.cornerRadius,
    borderWidth: props.borderWidth ?? 1,
    cardBackground: material
      ? material.surfaceContainer
      : props.cardBackground
      ? resolveColor(props.cardBackground, theme, scheme)
      : "transparent",
    cardBorder: material
      ? material.outlineVariant
      : props.cardBorderColor
      ? resolveColor(props.cardBorderColor, theme, scheme)
      : withAlpha(colors.muted, 0.35),
    highlightColor,
    highlightBackground: material
      ? material.primaryContainer
      : props.highlightBackground
      ? resolveColor(props.highlightBackground, theme, scheme)
      : withAlpha(highlightColor, 0.08),
    nameColor: material?.onSurface ?? resolveColor(props.nameColor, theme, scheme, colors.foreground),
    priceColor: material?.onSurface ?? resolveColor(props.priceColor, theme, scheme, colors.foreground),
    detailColor:
      material?.onSurfaceVariant ?? resolveColor(props.detailColor, theme, scheme, colors.muted),
    showDescription: props.showDescription !== false,
    showPeriod: props.showPeriod !== false,
    showSelector: props.showSelector !== false,
    showTrial: props.showTrialBadge === true,
    showSavings: props.showSavings === true,
  };
}

function ProductListNode({
  node,
  context,
  style,
}: {
  node: ResolvedProductList;
  context: RenderContext;
  style: CSSProperties;
}) {
  const { theme, scheme, material } = context;
  const colors = surfaceColors(theme, scheme);
  const props = node.props as ProductListProps;
  const horizontal = props.layout === "horizontal";
  const compact = props.style === "row";
  const card = cardStyleFor(props, theme, scheme, colors, context.material);
  const responsiveGrid = !horizontal && !compact && context.device.contentMaxWidth >= 680;

  // The switcher is the viewer's, not the document's: the spec says which
  // period the paywall opens on, and picking another one here only changes
  // what this preview shows.
  const periods = node.periodOptions ?? [];
  const initial = Math.max(periods.findIndex((option) => option.selected), 0);
  const [choice, setChoice] = useState<{ against: number; index: number } | null>(null);
  const period = choice?.against === initial ? choice.index : null;
  const active = periods.length ? periods[Math.min(period ?? initial, periods.length - 1)] : null;

  const all = node.products ?? [];
  const products = active
    ? all.filter((product) => active.productIds.includes(product.id))
    : all;
  const highlightedId = active ? active.highlightedProductId : node.highlightedProductId;

  const listStyle: CSSProperties = {
    display: responsiveGrid ? "grid" : "flex",
    flexDirection: responsiveGrid ? undefined : horizontal ? "row" : "column",
    gridTemplateColumns: responsiveGrid
      ? `repeat(${context.device.kind === "desktop" ? 3 : 2}, minmax(0, 1fr))`
      : undefined,
    gap: props.spacing ?? 10,
    overflowX: horizontal ? "auto" : undefined,
    paddingBottom: horizontal ? 4 : undefined,
  };

  const cards = (
    <>
      {products.length === 0 ? (
        <div
          style={{
            flex: 1,
            padding: 16,
            border: `1px dashed ${withAlpha(colors.muted, 0.5)}`,
            borderRadius: card.radius,
            color: colors.muted,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {context.mode === "edit"
            ? "No products match this list's filter."
            : "No plans are available right now."}
        </div>
      ) : (
        products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            highlighted={product.id === highlightedId}
            compact={compact}
            horizontal={horizontal}
            card={card}
            background={colors.background}
          />
        ))
      )}
    </>
  );

  if (!active) {
    return (
      <NodeShell node={node} context={context} style={{ ...listStyle, ...style }}>
        {cards}
      </NodeShell>
    );
  }

  const filter = props.periodFilter ?? {};
  return (
    <NodeShell
      node={node}
      context={context}
      style={{ display: "flex", flexDirection: "column", gap: 12, ...style }}
    >
      <SegmentedBar
        items={periods.map((option) => ({ key: option.key, label: option.label }))}
        activeIndex={periods.indexOf(active)}
        variant={filter.style === "chips" ? "chips" : "segmented"}
        tint={card.highlightColor}
        bar={material?.surfaceContainer ?? withAlpha(colors.muted, 0.14)}
        colors={colors}
        material={material}
        alignment={filter.alignment}
        role="group"
        onPick={(index) => setChoice({ against: initial, index })}
      />
      <div style={listStyle}>{cards}</div>
    </NodeShell>
  );
}

function productBadges(product: ResolvedProduct, card: CardStyle): string[] {
  return [
    product.badge,
    card.showTrial && product.trialDays > 0 ? `${product.trialDays}-day free trial` : null,
    card.showSavings && product.savingsLabel ? product.savingsLabel : null,
  ].filter((value): value is string => Boolean(value));
}

function ProductCard({
  product,
  highlighted,
  compact,
  horizontal,
  card,
  background,
}: {
  product: ResolvedProduct;
  highlighted: boolean;
  compact: boolean;
  horizontal: boolean;
  card: CardStyle;
  background: string;
}) {
  const border = highlighted ? card.highlightColor : card.cardBorder;
  const borderWidth = highlighted ? card.borderWidth + 1 : card.borderWidth;
  const badges = productBadges(product, card);
  const accent = highlighted ? card.highlightColor : card.detailColor;

  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          minWidth: horizontal ? 220 : undefined,
          flex: horizontal ? "0 0 auto" : undefined,
          borderRadius: card.radius,
          border: `${borderWidth}px solid ${border}`,
          background: highlighted ? card.highlightBackground : card.cardBackground,
        }}
      >
        {card.showSelector ? (
          <span
            aria-hidden="true"
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              border: `2px solid ${highlighted ? card.highlightColor : withAlpha(card.detailColor, 0.6)}`,
              background: highlighted ? card.highlightColor : "transparent",
              boxShadow: highlighted ? `inset 0 0 0 3px ${background}` : undefined,
              flexShrink: 0,
            }}
          />
        ) : null}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: "20px", color: card.nameColor }}>
            {product.name}
          </div>
          {badges.length ? (
            <div style={{ fontSize: 12, lineHeight: "16px", color: accent, fontWeight: 600 }}>
              {badges.join(" · ")}
            </div>
          ) : card.showDescription && product.description ? (
            <div style={{ fontSize: 12, lineHeight: "16px", color: card.detailColor }}>
              {product.description}
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: "20px", color: card.priceColor }}>
            {product.priceLabel}
          </div>
          {card.showPeriod ? (
            <div style={{ fontSize: 12, lineHeight: "16px", color: card.detailColor }}>
              {product.periodLabel}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 16,
        minWidth: horizontal ? 180 : undefined,
        flex: horizontal ? "1 0 0" : undefined,
        borderRadius: card.radius,
        border: `${borderWidth}px solid ${border}`,
        background: highlighted ? card.highlightBackground : card.cardBackground,
      }}
    >
      {badges.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {badges.map((badge) => (
            <span
              key={badge}
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: withAlpha(accent, 0.16),
                color: accent,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: "16px",
                whiteSpace: "nowrap",
              }}
            >
              {badge}
            </span>
          ))}
        </div>
      ) : null}
      <div style={{ fontSize: 17, fontWeight: 600, lineHeight: "22px", color: card.nameColor }}>
        {product.name}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, fontWeight: 700, lineHeight: "28px", color: card.priceColor }}>
          {product.priceLabel}
        </span>
        {card.showPeriod ? (
          <span style={{ fontSize: 13, lineHeight: "18px", color: card.detailColor }}>
            {product.periodLabel}
          </span>
        ) : null}
      </div>
      {card.showDescription && product.description ? (
        <div style={{ fontSize: 13, lineHeight: "18px", color: card.detailColor }}>
          {product.description}
        </div>
      ) : null}
    </div>
  );
}

export function PaywallRenderer({
  spec,
  products,
  scheme: requested,
  device: deviceId = "mobile",
  mode,
  selectedId = null,
  hoverId = null,
  onSelect,
  onHover,
  onContextMenu,
}: RendererProps) {
  const device = paywallDevicePreset(deviceId);
  const resolved = useMemo(
    () => resolvePaywall(paywallSpecForDevice(spec, deviceId), products),
    [deviceId, products, spec],
  );
  const materialDevice = isMaterialDevice(deviceId);
  const scheme = materialDevice ? requested : effectiveScheme(spec.theme, requested);
  const material = materialDevice
    ? materialYouColors(spec.materialYou?.seedColor, scheme)
    : null;
  const theme = material ? materialPaywallTheme(spec.theme, material) : spec.theme;
  const colors = surfaceColors(theme, scheme);

  return (
    <div
      data-render-style={material ? "material-you" : "apple"}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: colors.background,
        color: colors.foreground,
        fontFamily: fontFamilyFor(theme.fontDesign, Boolean(material)),
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          width: "100%",
          maxWidth: device.contentMaxWidth,
          marginInline: "auto",
        }}
      >
        <Node
          node={resolved.root}
          context={{
            theme,
            scheme,
            device,
            material,
            mode,
            selectedId,
            hoverId,
            onSelect,
            onHover,
            onContextMenu,
            parentAxis: "column",
          }}
        />
      </div>
    </div>
  );
}
