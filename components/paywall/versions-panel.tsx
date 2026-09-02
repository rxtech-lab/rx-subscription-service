"use client";

import { Clock3, Image as ImageIcon, RotateCcw } from "lucide-react";
import type { PaywallVersionData } from "@/app/actions/paywalls";
import { Badge, Button } from "@/components/ui/primitives";
import type { CatalogProduct } from "@/lib/paywall/export";
import { PhoneCanvas } from "./canvas";
import {
  paywallDevicePreset,
  type PaywallDevicePresetId,
} from "./device-presets";
import type { ColorScheme } from "./paywall-renderer";

const SOURCE_LABELS: Record<PaywallVersionData["source"], string> = {
  initial: "Initial design",
  draft: "Draft saved",
  published: "Published directly",
  restored: "Restored design",
  duplicated: "Duplicated design",
};

const PREVIEW_MAX_WIDTH = 260;
const PREVIEW_MAX_HEIGHT = 164;

function VersionScreenshot({
  entry,
  products,
  scheme,
  previewDevice,
}: {
  entry: PaywallVersionData;
  products: CatalogProduct[];
  scheme: ColorScheme;
  previewDevice: PaywallDevicePresetId;
}) {
  const device = paywallDevicePreset(previewDevice);
  const scale = Math.min(
    PREVIEW_MAX_WIDTH / device.width,
    PREVIEW_MAX_HEIGHT / device.height,
  );

  return (
    <figure
      aria-label={`Version ${entry.version} ${device.label} screenshot preview`}
      className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
    >
      <div className="flex h-44 items-center justify-center overflow-hidden px-3 py-2">
        <div
          aria-hidden="true"
          className="pointer-events-none shrink-0 select-none"
          style={{ width: device.width * scale, height: device.height * scale }}
        >
          <div
            style={{
              width: device.width,
              height: device.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <PhoneCanvas
              spec={entry.spec}
              products={products}
              scheme={scheme}
              mode="preview"
              fit={false}
              preset={previewDevice}
              testId={`paywall-version-preview-${entry.version}`}
            />
          </div>
        </div>
      </div>
      <figcaption className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white/85 px-3 py-2 text-[11px] font-medium text-slate-500">
        <span className="flex items-center gap-1.5">
          <ImageIcon className="size-3" aria-hidden="true" />
          {device.label} snapshot
        </span>
        <span className="font-mono tabular-nums text-slate-400">
          {device.width} × {device.height}
        </span>
      </figcaption>
    </figure>
  );
}

export function VersionsPanel({
  versions,
  currentVersion,
  publishedVersion,
  products,
  scheme,
  previewDevice,
  dirty,
  restoringVersion,
  onRestore,
}: {
  versions: PaywallVersionData[];
  currentVersion: number;
  publishedVersion: number | null;
  products: CatalogProduct[];
  scheme: ColorScheme;
  previewDevice: PaywallDevicePresetId;
  dirty: boolean;
  restoringVersion: number | null;
  onRestore: (version: number) => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-slate-100 px-4 py-4">
        <p className="text-sm font-semibold text-slate-950">Version history</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Every saved design is immutable. Restoring one creates a new draft and does not change
          the version shown in published apps.
        </p>
        {dirty ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            Save or undo your current changes before restoring a version.
          </p>
        ) : null}
      </div>

      <ol className="divide-y divide-slate-100">
        {versions.map((entry) => {
          const current = entry.version === currentVersion;
          const published = entry.version === publishedVersion;
          return (
            <li key={entry.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-semibold text-slate-950">Version {entry.version}</p>
                    {current ? <Badge tone="neutral">Current draft</Badge> : null}
                    {published ? <Badge tone="green">Published</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {SOURCE_LABELS[entry.source]}
                    {entry.restoredFromVersion
                      ? ` from version ${entry.restoredFromVersion}`
                      : ""}
                    {` · ${entry.actorType === "ai" ? "AI" : entry.actorType === "system" ? "System" : "User"}`}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Clock3 className="size-3" aria-hidden="true" />
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
                {current ? null : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="px-2.5 text-xs"
                    disabled={dirty || restoringVersion !== null}
                    title={dirty ? "Save or undo current changes first" : undefined}
                    aria-label={`Restore version ${entry.version}`}
                    onClick={() => onRestore(entry.version)}
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    {restoringVersion === entry.version ? "Restoring…" : "Restore"}
                  </Button>
                )}
              </div>
              <VersionScreenshot
                entry={entry}
                products={products}
                scheme={scheme}
                previewDevice={previewDevice}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
