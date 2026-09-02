"use client";

import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { exportPaywallAction } from "@/app/actions/paywalls";
import { copyText } from "@/components/forms/action-form";
import { FormDialog } from "@/components/ui/form-dialog";
import { Button, Field, Select } from "@/components/ui/primitives";
import type { PaywallSpec } from "@/lib/paywall/schema";

/**
 * Export the document as the JSON an app renders. "Template" leaves every
 * ProductList empty; choosing an application fills them from its real plans,
 * exactly as `GET /api/v1/paywall` would.
 */
export function ExportDialog({
  paywallId,
  spec,
  applications,
  hasPublished,
}: {
  paywallId: string;
  spec: PaywallSpec;
  applications: { id: string; name: string }[];
  hasPublished: boolean;
}) {
  return (
    <FormDialog
      triggerLabel="Export"
      title="Export JSON"
      description="A nested layout tree for a SwiftUI or Jetpack Compose renderer."
      icon="download"
      size="lg"
      triggerVariant="secondary"
      triggerSize="sm"
    >
      <ExportPanel paywallId={paywallId} spec={spec} applications={applications} hasPublished={hasPublished} />
    </FormDialog>
  );
}

function ExportPanel({
  paywallId,
  spec,
  applications,
  hasPublished,
}: {
  paywallId: string;
  spec: PaywallSpec;
  applications: { id: string; name: string }[];
  hasPublished: boolean;
}) {
  const [target, setTarget] = useState("template");
  const [which, setWhich] = useState<"editor" | "published">("editor");
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const result = await exportPaywallAction({
      paywallId,
      applicationId: target === "template" ? null : target,
      which: which === "published" ? "published" : "draft",
      spec: which === "editor" ? spec : undefined,
    });
    setBusy(false);
    if (result.error || !result.json) {
      setError(result.error ?? "Export failed.");
      setJson(null);
      return;
    }
    setJson(result.json);
  };

  const download = () => {
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `paywall-${target === "template" ? "template" : target}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Products" hint="Fill ProductList nodes from an application's active plans.">
          <Select className="h-9 text-xs" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="template">Template only (empty product lists)</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Version">
          <Select
            className="h-9 text-xs"
            value={which}
            onChange={(event) => setWhich(event.target.value as "editor" | "published")}
          >
            <option value="editor">What is in the editor now</option>
            <option value="published" disabled={!hasPublished}>
              Last published{hasPublished ? "" : " (none yet)"}
            </option>
          </Select>
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void generate()}>
          {busy ? "Generating…" : "Generate"}
        </Button>
        {json ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await copyText(json);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                } catch {
                  setError("Could not copy. Select the text and copy it manually.");
                }
              }}
            >
              {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={download}>
              <Download className="size-3.5" aria-hidden="true" />
              Download .json
            </Button>
          </>
        ) : null}
        {error ? <p className="ml-auto text-xs text-rose-600">{error}</p> : null}
      </div>

      {json ? (
        <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] leading-4 text-slate-100">
          {json}
        </pre>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        <p className="font-semibold text-slate-800">Rendering the tree</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            <code>VStack</code>/<code>HStack</code>/<code>ZStack</code>/<code>Grid</code>/
            <code>List</code>/<code>ScrollView</code> map to the SwiftUI views of the same name, or
            to <code>Column</code>/<code>Row</code>/<code>Box</code>/<code>LazyVerticalGrid</code>/
            <code>LazyColumn</code>/vertical scroll in Compose. Only these carry <code>children</code>.
          </li>
          <li>
            <code>modifiers</code> apply in order: padding, frame, background, cornerRadius, border,
            opacity, hidden. Sizes are points.
          </li>
          <li>
            Colors are hex or a token from <code>theme.colors</code>; <code>success</code>,{" "}
            <code>warning</code>, <code>danger</code> are conventional system colors.
          </li>
          <li>
            <code>root</code> is the default iPhone design. A device uses its root from{" "}
            <code>deviceLayouts</code> when present and otherwise falls back to the iPhone root.
            Android and foldable colors are generated from <code>materialYou.seedColor</code>.
          </li>
          <li>
            <code>ProductList.products</code> arrives filled per application — filtered, sorted,
            and with overrides applied — each with <code>priceLabel</code>,{" "}
            <code>periodLabel</code>, <code>savingsLabel</code>, <code>badge</code>, and{" "}
            <code>purchaseOptions</code> (StoreKit product id when mapped, and what each way of
            buying costs). Tapping one selects it; a <code>purchase</code>{" "}
            action without <code>productId</code> buys the selection.
          </li>
          <li>
            Apps fetch this from <code>GET /api/v1/paywall</code> with a publishable key once the
            template is published and assigned. A StoreKit client is served App Store prices
            automatically, so every label matches what Apple will charge for a plan priced
            differently there.
          </li>
        </ul>
      </div>
    </div>
  );
}
