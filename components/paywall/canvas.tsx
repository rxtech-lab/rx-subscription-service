"use client";

import { FoldHorizontal, Laptop, Smartphone, Tablet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CatalogProduct } from "@/lib/paywall/export";
import { paywallSpecForDevice } from "@/lib/paywall/device-design";
import { materialPaywallTheme, materialYouColors } from "@/lib/paywall/material-you";
import type { PaywallSpec } from "@/lib/paywall/schema";
import { cn } from "@/lib/utils";
import {
  PAYWALL_DEVICE_PRESETS,
  isMaterialDevice,
  paywallDevicePreset,
  type PaywallDevicePreset,
  type PaywallDevicePresetId,
} from "./device-presets";
import {
  effectiveScheme,
  PaywallRenderer,
  surfaceColors,
  type ColorScheme,
} from "./paywall-renderer";

export const PHONE_WIDTH = 390;
export const PHONE_HEIGHT = 844;
const CANVAS_GUTTER = 48;

const DEVICE_ICONS = {
  mobile: Smartphone,
  android: Smartphone,
  foldable: FoldHorizontal,
  ipad: Tablet,
  macos: Laptop,
} satisfies Record<PaywallDevicePresetId, typeof Smartphone>;

function DevicePicker({
  selected,
  onChange,
  customizedPresets,
  onResetLayout,
}: {
  selected: PaywallDevicePresetId;
  onChange: (preset: PaywallDevicePresetId) => void;
  customizedPresets?: ReadonlySet<PaywallDevicePresetId>;
  onResetLayout?: () => void;
}) {
  const current = paywallDevicePreset(selected);
  const customized = customizedPresets?.has(selected) ?? false;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-3 py-2 backdrop-blur">
      <div
        role="group"
        aria-label="Preview device"
        className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/80 p-1 shadow-sm"
      >
        {PAYWALL_DEVICE_PRESETS.map((preset) => {
          const Icon = DEVICE_ICONS[preset.id];
          const active = preset.id === selected;

          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              title={`${preset.label} · ${preset.width} × ${preset.height}`}
              onClick={() => onChange(preset.id)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                active
                  ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:bg-white/70 hover:text-slate-900",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span>{preset.label}</span>
              {customizedPresets?.has(preset.id) && preset.id !== "mobile" ? (
                <span
                  className="size-1.5 rounded-full bg-blue-500"
                  title="Custom device design"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="ml-auto hidden shrink-0 items-center gap-2 xl:flex">
        {onResetLayout && selected !== "mobile" ? (
          <>
            <span className="text-[11px] font-medium text-slate-500" aria-live="polite">
              {customized ? "Custom design" : "Using iPhone design"}
            </span>
            {customized ? (
              <button
                type="button"
                onClick={onResetLayout}
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
              >
                Reset
              </button>
            ) : null}
          </>
        ) : null}
        <span className="min-w-[5.5rem] text-right font-mono text-[11px] tabular-nums text-slate-400">
          {current.width} × {current.height}
        </span>
      </div>
    </div>
  );
}

function StatusBar({
  device,
  color,
}: {
  device: PaywallDevicePreset;
  color: string;
}) {
  const hasDynamicIsland = device.platform === "apple" && device.kind === "phone";
  const hasCamera = device.platform === "android";

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        height: device.kind === "tablet" ? 44 : 54,
        flexShrink: 0,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        padding: device.kind === "tablet" ? "0 26px 8px" : "0 30px 6px",
        color,
        fontFamily:
          device.platform === "android"
            ? "Roboto, system-ui, sans-serif"
            : "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        fontSize: device.kind === "tablet" ? 14 : 15,
        fontWeight: 600,
      }}
    >
      <span>9:41</span>
      {hasDynamicIsland ? (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: 12,
            width: 120,
            height: 34,
            marginLeft: -60,
            borderRadius: 20,
            background: "#0f172a",
          }}
        />
      ) : null}
      {hasCamera ? (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: 17,
            width: 12,
            height: 12,
            marginLeft: -6,
            borderRadius: 999,
            background: "#0f172a",
            boxShadow: "inset 0 0 0 3px #1e293b",
          }}
        />
      ) : null}
      <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <span style={{ width: 16, height: 10, borderRadius: 2, background: color, opacity: 0.9 }} />
        <span style={{ width: 24, height: 11, borderRadius: 3, border: `1.5px solid ${color}` }} />
      </span>
    </div>
  );
}

function DesktopTitleBar({ color }: { color: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        height: 44,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
        padding: "0 16px",
        color,
        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <span style={{ display: "flex", gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#FF5F57" }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#FEBC2E" }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#28C840" }} />
      </span>
      <span
        style={{
          position: "absolute",
          insetInline: 100,
          textAlign: "center",
          fontSize: 13,
          fontWeight: 600,
          opacity: 0.72,
        }}
      >
        Paywall Preview
      </span>
    </div>
  );
}

/**
 * A device frame around the renderer. It scales down to fit the space it is
 * given, so the whole screen remains visible while the renderer receives the
 * device preset's real layout width.
 */
export function PhoneCanvas({
  spec,
  products,
  scheme,
  mode,
  selectedId,
  hoverId,
  onSelect,
  onHover,
  onContextMenu,
  fit = true,
  preset,
  onPresetChange,
  customizedPresets,
  onResetLayout,
  showDevicePicker = false,
  testId = "paywall-phone",
  className,
}: {
  spec: PaywallSpec;
  products: CatalogProduct[];
  scheme: ColorScheme;
  mode: "edit" | "preview";
  selectedId?: string | null;
  hoverId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  fit?: boolean;
  preset?: PaywallDevicePresetId;
  onPresetChange?: (preset: PaywallDevicePresetId) => void;
  customizedPresets?: ReadonlySet<PaywallDevicePresetId>;
  onResetLayout?: () => void;
  showDevicePicker?: boolean;
  testId?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [internalPreset, setInternalPreset] = useState<PaywallDevicePresetId>(preset ?? "mobile");
  const selectedPreset = preset ?? internalPreset;
  const device = paywallDevicePreset(selectedPreset);
  const renderedSpec = paywallSpecForDevice(spec, selectedPreset);

  useEffect(() => {
    if (!fit) return;
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      const next = Math.min(
        1,
        (height - CANVAS_GUTTER) / device.height,
        (width - CANVAS_GUTTER) / device.width,
      );
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [device.height, device.width, fit]);

  const materialDevice = isMaterialDevice(selectedPreset);
  const effective = materialDevice ? scheme : effectiveScheme(spec.theme, scheme);
  const material = materialDevice
    ? materialYouColors(spec.materialYou?.seedColor, effective)
    : null;
  const renderedTheme = material ? materialPaywallTheme(spec.theme, material) : spec.theme;
  const colors = surfaceColors(renderedTheme, effective);
  const statusColor = colors.foreground;
  const appliedScale = fit ? scale : 1;

  return (
    <div
      className={cn("flex h-full min-h-0 w-full flex-col overflow-hidden", className)}
    >
      {showDevicePicker ? (
        <DevicePicker
          selected={selectedPreset}
          customizedPresets={customizedPresets}
          onResetLayout={onResetLayout}
          onChange={(next) => {
            setInternalPreset(next);
            onPresetChange?.(next);
          }}
        />
      ) : null}
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onClick={mode === "edit" ? () => onSelect?.(renderedSpec.root.id) : undefined}
      >
        <div
          style={{
            width: device.width * appliedScale,
            height: device.height * appliedScale,
            flexShrink: 0,
          }}
        >
          <div
            data-testid={testId}
            data-device-preset={device.id}
            data-platform-style={device.platform === "android" ? "material-you" : "apple"}
            aria-label={`${device.label} paywall preview, ${device.width} by ${device.height}`}
            style={{
              position: "relative",
              width: device.width,
              height: device.height,
              transform: `scale(${appliedScale})`,
              transformOrigin: "top left",
              borderRadius:
                device.kind === "phone"
                  ? 48
                  : device.kind === "foldable"
                    ? 34
                    : device.kind === "tablet"
                      ? 28
                      : 14,
              background: colors.background,
              boxShadow:
                device.kind === "desktop"
                  ? "0 0 0 1px #94a3b8, 0 30px 70px -28px rgba(15,23,42,0.55)"
                  : "0 0 0 8px #0f172a, 0 0 0 10px #334155, 0 30px 60px -30px rgba(15,23,42,0.6)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {device.kind === "desktop" ? (
              <DesktopTitleBar color={statusColor} />
            ) : (
              <StatusBar device={device} color={statusColor} />
            )}
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <PaywallRenderer
                spec={spec}
                products={products}
                scheme={scheme}
                device={selectedPreset}
                mode={mode}
                selectedId={selectedId}
                hoverId={hoverId}
                onSelect={onSelect}
                onHover={onHover}
                onContextMenu={onContextMenu}
              />
            </div>
            {device.kind === "desktop" ? null : (
              <div
                aria-hidden="true"
                style={{
                  height: device.kind === "tablet" ? 20 : 24,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    width: device.platform === "android" ? 108 : device.kind === "tablet" ? 180 : 134,
                    height: 5,
                    borderRadius: 3,
                    background: statusColor,
                    opacity: 0.6,
                  }}
                />
              </div>
            )}
            {device.kind === "foldable" ? (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  insetBlock: 54,
                  left: "50%",
                  width: 1,
                  background: "rgba(15, 23, 42, 0.04)",
                  boxShadow: "0 0 18px 5px rgba(15, 23, 42, 0.035)",
                  pointerEvents: "none",
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
