"use client";

import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import type { CatalogProduct } from "@/lib/paywall/export";
import type { JsonSchemaNode } from "@/lib/ai/ui-catalog";
import {
  DEFAULT_MATERIAL_SEED_COLOR,
  MATERIAL_PALETTE_OPTIONS,
  materialYouColors,
} from "@/lib/paywall/material-you";
import {
  COLOR_TOKENS,
  modifiersSchema,
  NODE_DESCRIPTIONS,
  nodeProps,
  type Modifiers,
  type PaywallNode,
  type PaywallTheme,
} from "@/lib/paywall/schema";
import { cn } from "@/lib/utils";
import { SymbolCombobox } from "./symbol-combobox";

/**
 * The property editor for one node.
 *
 * Fields are derived from the node type's zod schema — the same schema that
 * validates the document and describes the vocabulary to the agent — so adding
 * a prop in one place adds it everywhere. A handful of keys get bespoke
 * controls (colors, actions, the product filter); everything else falls to a
 * control chosen from its JSON-schema type.
 */

interface InspectorProps {
  node: PaywallNode | null;
  isRoot: boolean;
  /** The products the canvas is previewing with, for per-plan overrides. */
  products: CatalogProduct[];
  materialYou?: boolean;
  onChangeProps: (id: string, patch: Record<string, unknown>, coalesceKey?: string) => void;
  onChangeModifiers: (id: string, patch: Modifiers, coalesceKey?: string) => void;
  onEndCoalesce: () => void;
}

interface SchemaProperty extends JsonSchemaNode {
  description?: string;
  minimum?: number;
  maximum?: number;
  format?: string;
}

const COLOR_KEYS = new Set(["color", "tint", "background"]);

function isColorKey(name: string): boolean {
  return COLOR_KEYS.has(name) || /(Color|Background)$/.test(name);
}
const LONG_TEXT_KEYS = new Set(["text", "subtitle", "description"]);

function propertiesOf(schema: z.ZodType): { properties: Record<string, SchemaProperty>; required: Set<string> } {
  const json = z.toJSONSchema(schema, { io: "input" }) as SchemaProperty;
  return {
    properties: (json.properties ?? {}) as Record<string, SchemaProperty>,
    required: new Set(json.required ?? []),
  };
}

function isNumeric(property: SchemaProperty): boolean {
  return property.type === "number" || property.type === "integer";
}

function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function Inspector({
  node,
  isRoot,
  products,
  materialYou = false,
  onChangeProps,
  onChangeModifiers,
  onEndCoalesce,
}: InspectorProps) {
  if (!node) {
    return (
      <p className="p-4 text-xs leading-5 text-slate-500">
        Select a node in the layers panel or on the phone to edit it.
      </p>
    );
  }

  const { properties, required } = propertiesOf(nodeProps[node.type]);
  const keys = Object.keys(properties);

  return (
    <div className="space-y-6 p-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-950">{node.type}</h3>
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            {node.id}
          </code>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{NODE_DESCRIPTIONS[node.type]}</p>
        {isRoot ? (
          <p className="mt-1 text-[11px] text-slate-400">This is the root and cannot be removed.</p>
        ) : null}
      </div>

      {keys.length ? (
        <section className="space-y-3">
          <SectionTitle>Properties</SectionTitle>
          {keys.map((key) => (
            <PropField
              key={key}
              name={key}
              property={properties[key]}
              required={required.has(key)}
              value={node.props[key]}
              products={products}
              materialYou={materialYou}
              onChange={(value, coalesce) =>
                onChangeProps(node.id, { [key]: value }, coalesce ? `${node.id}:${key}` : undefined)
              }
              onBlur={onEndCoalesce}
            />
          ))}
        </section>
      ) : (
        <p className="text-xs text-slate-400">This node has no properties.</p>
      )}

      <ModifiersSection
        modifiers={node.modifiers ?? {}}
        materialYou={materialYou}
        onChange={(patch, coalesce) =>
          onChangeModifiers(node.id, patch, coalesce ? `${node.id}:modifiers:${Object.keys(patch)[0]}` : undefined)
        }
        onBlur={onEndCoalesce}
      />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{children}</p>
  );
}

function PropField({
  name,
  property,
  required,
  value,
  products,
  materialYou,
  onChange,
  onBlur,
}: {
  name: string;
  property: SchemaProperty;
  required: boolean;
  value: unknown;
  products: CatalogProduct[];
  materialYou: boolean;
  onChange: (value: unknown, coalesce?: boolean) => void;
  onBlur: () => void;
}) {
  const label = `${humanize(name)}${required ? " *" : ""}`;
  const hint = property.description;

  if (name === "action") {
    return (
      <Field label={label} hint={hint}>
        <ActionField value={value as Record<string, unknown> | undefined} onChange={onChange} onBlur={onBlur} />
      </Field>
    );
  }

  if (name === "icon" || name === "systemName") {
    return (
      <Field label={label} hint={hint ?? "Search and select an SF Symbol from the installed catalog."}>
        <SymbolCombobox
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          onBlur={onBlur}
        />
      </Field>
    );
  }

  if (name === "overrides") {
    return (
      <Field label="Per-plan overrides" hint="Rename, re-describe, badge, or hide one plan. Matched by plan key.">
        <ProductOverridesField
          value={Array.isArray(value) ? (value as OverrideRow[]) : []}
          products={products}
          onChange={onChange}
          onBlur={onBlur}
        />
      </Field>
    );
  }

  if (name === "filter") {
    return (
      <Field label={label} hint="Leave empty to show every active plan.">
        <FilterField value={value as Record<string, unknown> | undefined} onChange={onChange} onBlur={onBlur} />
      </Field>
    );
  }

  if (isColorKey(name) || (property.anyOf && property.anyOf.some((option) => option.enum?.includes("primary")))) {
    if (materialYou) {
      return (
        <Field label={label} hint="Generated automatically from the selected Material You palette.">
          <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-800">
            Automatic Material color
          </div>
        </Field>
      );
    }
    return (
      <Field label={label} hint={hint}>
        <ColorField value={value as string | undefined} onChange={onChange} onBlur={onBlur} />
      </Field>
    );
  }

  if (property.enum) {
    return (
      <Field label={label} hint={hint}>
        <Select
          className="h-9 text-xs"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          {!required ? <option value="">Default</option> : null}
          {property.enum.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (property.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked ? true : undefined)}
          className="size-4 rounded border-slate-300 text-blue-600"
        />
        {humanize(name)}
        {hint ? <span className="font-normal text-slate-400">— {hint}</span> : null}
      </label>
    );
  }

  if (isNumeric(property)) {
    return (
      <Field label={label} hint={hint}>
        <NumberInput
          value={typeof value === "number" ? value : undefined}
          min={property.minimum}
          max={property.maximum}
          integer={property.type === "integer"}
          onChange={(next) => onChange(next, true)}
          onBlur={onBlur}
        />
      </Field>
    );
  }

  if (property.type === "string") {
    const text = typeof value === "string" ? value : "";
    if (LONG_TEXT_KEYS.has(name)) {
      return (
        <Field label={label} hint={hint}>
          <Textarea
            rows={3}
            className="text-xs"
            value={text}
            onChange={(event) => onChange(event.target.value === "" && !required ? undefined : event.target.value, true)}
            onBlur={onBlur}
          />
        </Field>
      );
    }
    return (
      <Field label={label} hint={hint}>
        <Input
          type={name === "url" ? "url" : "text"}
          className="h-9 text-xs"
          value={text}
          onChange={(event) => onChange(event.target.value === "" && !required ? undefined : event.target.value, true)}
          onBlur={onBlur}
        />
      </Field>
    );
  }

  return null;
}

function NumberInput({
  value,
  min,
  max,
  integer,
  onChange,
  onBlur,
  placeholder,
  className,
}: {
  value: number | undefined;
  min?: number;
  max?: number;
  integer?: boolean;
  onChange: (value: number | undefined) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      className={cn("h-9 text-xs", className)}
      value={value ?? ""}
      min={min}
      max={max}
      step={integer ? 1 : "any"}
      placeholder={placeholder ?? "Default"}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        onChange(integer ? Math.trunc(parsed) : parsed);
      }}
      onBlur={onBlur}
    />
  );
}

function ColorField({
  value,
  onChange,
  onBlur,
  allowTokens = true,
}: {
  value: string | undefined;
  onChange: (value: string | undefined, coalesce?: boolean) => void;
  onBlur: () => void;
  allowTokens?: boolean;
}) {
  const custom = typeof value === "string" && value.startsWith("#");
  const mode = custom ? "custom" : (value ?? "");
  const hex = custom ? value.slice(0, 7) : "#2563EB";

  return (
    <div className="flex items-center gap-2">
      {allowTokens ? (
        <Select
          className="h-9 flex-1 text-xs"
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "") onChange(undefined);
            else if (next === "custom") onChange(hex);
            else onChange(next);
          }}
        >
          <option value="">Default</option>
          {COLOR_TOKENS.map((token) => (
            <option key={token} value={token}>
              {token}
            </option>
          ))}
          <option value="custom">Custom hex…</option>
        </Select>
      ) : null}
      {custom || !allowTokens ? (
        <>
          <input
            type="color"
            aria-label="Pick a color"
            value={hex}
            onChange={(event) => onChange(event.target.value.toUpperCase(), true)}
            onBlur={onBlur}
            className="size-9 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
          />
          <Input
            aria-label="Hex color"
            className="h-9 w-24 font-mono text-xs uppercase"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value, true)}
            onBlur={onBlur}
          />
        </>
      ) : null}
    </div>
  );
}

const ACTION_TYPES = ["purchase", "restorePurchases", "dismiss", "openUrl", "selectProduct"] as const;

function ActionField({
  value,
  onChange,
  onBlur,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (value: unknown, coalesce?: boolean) => void;
  onBlur: () => void;
}) {
  const type = typeof value?.type === "string" ? value.type : "purchase";
  return (
    <div className="space-y-2">
      <Select
        className="h-9 text-xs"
        value={type}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "openUrl") onChange({ type: next, url: "https://" });
          else if (next === "selectProduct") onChange({ type: next, productId: "" });
          else onChange({ type: next });
        }}
      >
        {ACTION_TYPES.map((option) => (
          <option key={option} value={option}>
            {humanize(option)}
          </option>
        ))}
      </Select>
      {type === "openUrl" ? (
        <Input
          type="url"
          className="h-9 text-xs"
          placeholder="https://"
          value={typeof value?.url === "string" ? value.url : ""}
          onChange={(event) => onChange({ type, url: event.target.value }, true)}
          onBlur={onBlur}
        />
      ) : null}
      {type === "purchase" || type === "selectProduct" ? (
        <Input
          className="h-9 text-xs"
          placeholder={type === "purchase" ? "Plan id or key (optional: selected product)" : "Plan id or key"}
          value={typeof value?.productId === "string" ? value.productId : ""}
          onChange={(event) =>
            onChange(
              { type, ...(event.target.value ? { productId: event.target.value } : {}) },
              true,
            )
          }
          onBlur={onBlur}
        />
      ) : null}
    </div>
  );
}

const INTERVALS = ["month", "quarter", "year", "one_time"] as const;

function FilterField({
  value,
  onChange,
  onBlur,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (value: unknown, coalesce?: boolean) => void;
  onBlur: () => void;
}) {
  const planGroup = typeof value?.planGroup === "string" ? value.planGroup : "";
  const intervals = Array.isArray(value?.billingIntervals) ? (value.billingIntervals as string[]) : [];

  const emit = (next: { planGroup?: string; billingIntervals?: string[] }, coalesce?: boolean) => {
    const cleaned: Record<string, unknown> = {};
    if (next.planGroup) cleaned.planGroup = next.planGroup;
    if (next.billingIntervals?.length) cleaned.billingIntervals = next.billingIntervals;
    onChange(Object.keys(cleaned).length ? cleaned : undefined, coalesce);
  };

  return (
    <div className="space-y-2">
      <Input
        className="h-9 text-xs"
        placeholder="Plan group, e.g. default"
        value={planGroup}
        onChange={(event) => emit({ planGroup: event.target.value, billingIntervals: intervals }, true)}
        onBlur={onBlur}
      />
      <div className="flex flex-wrap gap-2">
        {INTERVALS.map((interval) => (
          <label key={interval} className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              className="size-3.5 rounded border-slate-300"
              checked={intervals.includes(interval)}
              onChange={(event) =>
                emit({
                  planGroup,
                  billingIntervals: event.target.checked
                    ? [...intervals, interval]
                    : intervals.filter((entry) => entry !== interval),
                })
              }
            />
            {interval.replace("_", "-")}
          </label>
        ))}
      </div>
    </div>
  );
}

interface OverrideRow {
  productKey: string;
  name?: string;
  description?: string;
  badge?: string;
  hidden?: boolean;
}

function ProductOverridesField({
  value,
  products,
  onChange,
  onBlur,
}: {
  value: OverrideRow[];
  products: CatalogProduct[];
  onChange: (value: unknown, coalesce?: boolean) => void;
  onBlur: () => void;
}) {
  const emit = (rows: OverrideRow[], coalesce?: boolean) => {
    const cleaned = rows.map((row) => {
      const next: OverrideRow = { productKey: row.productKey };
      if (row.name) next.name = row.name;
      if (row.description) next.description = row.description;
      if (row.badge) next.badge = row.badge;
      if (row.hidden) next.hidden = true;
      return next;
    });
    onChange(cleaned.length ? cleaned : undefined, coalesce);
  };
  const update = (index: number, patch: Partial<OverrideRow>, coalesce?: boolean) =>
    emit(value.map((row, at) => (at === index ? { ...row, ...patch } : row)), coalesce);

  const knownKeys = products.map((product) => product.key);
  const unused = knownKeys.filter((key) => !value.some((row) => row.productKey === key));

  return (
    <div className="space-y-2">
      {value.map((row, index) => {
        const options = knownKeys.includes(row.productKey) ? knownKeys : [row.productKey, ...knownKeys];
        return (
          <div key={`${row.productKey}-${index}`} className="space-y-2 rounded-lg border border-slate-200 p-2">
            <div className="flex items-center gap-2">
              <Select
                aria-label="Plan"
                className="h-8 flex-1 font-mono text-xs"
                value={row.productKey}
                onChange={(event) => update(index, { productKey: event.target.value })}
              >
                {options.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input
                  type="checkbox"
                  className="size-3.5 rounded border-slate-300"
                  checked={row.hidden === true}
                  onChange={(event) => update(index, { hidden: event.target.checked || undefined })}
                />
                Hide
              </label>
              <button
                type="button"
                aria-label="Remove override"
                onClick={() => emit(value.filter((_, at) => at !== index))}
                className="flex size-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            {!row.hidden ? (
              <>
                <Input
                  className="h-8 text-xs"
                  placeholder="Display name (optional)"
                  value={row.name ?? ""}
                  onChange={(event) => update(index, { name: event.target.value }, true)}
                  onBlur={onBlur}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="Description (optional)"
                  value={row.description ?? ""}
                  onChange={(event) => update(index, { description: event.target.value }, true)}
                  onBlur={onBlur}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="Badge, e.g. Best value (optional)"
                  value={row.badge ?? ""}
                  onChange={(event) => update(index, { badge: event.target.value }, true)}
                  onBlur={onBlur}
                />
              </>
            ) : null}
          </div>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 text-xs"
        disabled={value.length >= 20}
        onClick={() => emit([...value, { productKey: unused[0] ?? knownKeys[0] ?? "plan-key" }])}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Add override
      </Button>
      {products.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          Choose an application in the toolbar to pick from its real plan keys.
        </p>
      ) : null}
    </div>
  );
}

function ModifiersSection({
  modifiers,
  materialYou,
  onChange,
  onBlur,
}: {
  modifiers: Modifiers;
  materialYou: boolean;
  onChange: (patch: Modifiers, coalesce?: boolean) => void;
  onBlur: () => void;
}) {
  // Guards the section against a schema edit that renames a modifier.
  const known = propertiesOf(modifiersSchema).properties;
  const padding = modifiers.padding;
  const paddingMode = padding === undefined ? "none" : typeof padding === "number" ? "uniform" : "edges";
  const edges = typeof padding === "object" && padding ? padding : {};
  const frame = modifiers.frame ?? {};

  return (
    <section className="space-y-3">
      <SectionTitle>Modifiers</SectionTitle>

      {"padding" in known ? (
        <Field label="Padding">
          <div className="space-y-2">
            <Select
              className="h-9 text-xs"
              value={paddingMode}
              onChange={(event) => {
                const mode = event.target.value;
                if (mode === "none") onChange({ padding: undefined });
                else if (mode === "uniform") onChange({ padding: typeof padding === "number" ? padding : 16 });
                else onChange({ padding: { top: 16, leading: 16, bottom: 16, trailing: 16 } });
              }}
            >
              <option value="none">None</option>
              <option value="uniform">All edges</option>
              <option value="edges">Per edge</option>
            </Select>
            {paddingMode === "uniform" ? (
              <NumberInput
                value={typeof padding === "number" ? padding : undefined}
                min={0}
                onChange={(next) => onChange({ padding: next ?? 0 }, true)}
                onBlur={onBlur}
              />
            ) : null}
            {paddingMode === "edges" ? (
              <div className="grid grid-cols-2 gap-2">
                {(["top", "leading", "bottom", "trailing"] as const).map((edge) => (
                  <NumberInput
                    key={edge}
                    value={edges[edge]}
                    min={0}
                    placeholder={humanize(edge)}
                    onChange={(next) => onChange({ padding: { ...edges, [edge]: next } }, true)}
                    onBlur={onBlur}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </Field>
      ) : null}

      <Field label="Frame" hint="Points. Leave empty for natural size.">
        <div className="grid grid-cols-2 gap-2">
          {(["width", "height", "maxWidth", "maxHeight"] as const).map((key) => (
            <NumberInput
              key={key}
              value={frame[key]}
              min={0}
              placeholder={humanize(key)}
              onChange={(next) => {
                const nextFrame = { ...frame, [key]: next };
                const pruned = Object.fromEntries(
                  Object.entries(nextFrame).filter(([, entry]) => entry !== undefined),
                );
                onChange({ frame: Object.keys(pruned).length ? pruned : undefined }, true);
              }}
              onBlur={onBlur}
            />
          ))}
        </div>
      </Field>

      {materialYou ? (
        <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800">
          Background and border colors use automatic Material surface and outline roles.
        </div>
      ) : (
        <Field label="Background">
          <ColorField
            value={modifiers.background}
            onChange={(next, coalesce) => onChange({ background: next }, coalesce)}
            onBlur={onBlur}
          />
        </Field>
      )}

      <Field label="Corner radius">
        <NumberInput
          value={modifiers.cornerRadius}
          min={0}
          onChange={(next) => onChange({ cornerRadius: next }, true)}
          onBlur={onBlur}
        />
      </Field>

      {!materialYou ? <Field label="Border">
        <div className="space-y-2">
          <ColorField
            value={modifiers.border?.color}
            onChange={(next, coalesce) =>
              onChange(
                { border: next ? { color: next, width: modifiers.border?.width ?? 1 } : undefined },
                coalesce,
              )
            }
            onBlur={onBlur}
          />
          {modifiers.border ? (
            <NumberInput
              value={modifiers.border.width}
              min={0}
              placeholder="Width"
              onChange={(next) =>
                onChange({ border: { color: modifiers.border!.color, width: next ?? 1 } }, true)
              }
              onBlur={onBlur}
            />
          ) : null}
        </div>
      </Field> : null}

      <Field label={`Opacity${modifiers.opacity !== undefined ? ` · ${Math.round(modifiers.opacity * 100)}%` : ""}`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={modifiers.opacity ?? 1}
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange({ opacity: next >= 1 ? undefined : next }, true);
          }}
          onBlur={onBlur}
          className="w-full accent-blue-600"
        />
      </Field>

      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={modifiers.hidden === true}
          onChange={(event) => onChange({ hidden: event.target.checked ? true : undefined })}
          className="size-4 rounded border-slate-300 text-blue-600"
        />
        Hidden
        <span className="font-normal text-slate-400">— dimmed here, not rendered in the app</span>
      </label>
    </section>
  );
}

export function ThemeEditor({
  theme,
  onChange,
  onEndCoalesce,
}: {
  theme: PaywallTheme;
  onChange: (patch: Partial<PaywallTheme>, coalesceKey?: string) => void;
  onEndCoalesce: () => void;
}) {
  return (
    <div className="space-y-6 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Theme</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Tokens every node can reference. Change a color here and everything using that token
          follows.
        </p>
      </div>

      <section className="space-y-3">
        <Field label="Color scheme" hint="System follows the device; fixed schemes ignore the preview toggle.">
          <Select
            className="h-9 text-xs"
            value={theme.colorScheme}
            onChange={(event) => onChange({ colorScheme: event.target.value as PaywallTheme["colorScheme"] })}
          >
            <option value="system">System</option>
            <option value="light">Always light</option>
            <option value="dark">Always dark</option>
          </Select>
        </Field>

        {(Object.keys(theme.colors) as (keyof PaywallTheme["colors"])[]).map((token) => (
          <Field key={token} label={humanize(token)}>
            <ColorField
              allowTokens={false}
              value={theme.colors[token]}
              onChange={(next, coalesce) => {
                if (!next || !/^#[0-9a-fA-F]{6}$/.test(next)) return;
                onChange({ colors: { ...theme.colors, [token]: next.toUpperCase() } }, coalesce ? `theme:${token}` : undefined);
              }}
              onBlur={onEndCoalesce}
            />
          </Field>
        ))}

        <Field label="Corner radius" hint="Used by buttons and product cards.">
          <NumberInput
            value={theme.cornerRadius}
            min={0}
            onChange={(next) => onChange({ cornerRadius: next ?? 0 }, "theme:cornerRadius")}
            onBlur={onEndCoalesce}
          />
        </Field>

        <Field label="Font design">
          <Select
            className="h-9 text-xs"
            value={theme.fontDesign}
            onChange={(event) => onChange({ fontDesign: event.target.value as PaywallTheme["fontDesign"] })}
          >
            <option value="default">Default</option>
            <option value="rounded">Rounded</option>
            <option value="serif">Serif</option>
            <option value="monospaced">Monospaced</option>
          </Select>
        </Field>
      </section>
    </div>
  );
}

export function MaterialYouEditor({
  seedColor,
  scheme,
  onChange,
  onEndCoalesce,
}: {
  seedColor?: string;
  scheme: "light" | "dark";
  onChange: (seedColor: string, coalesceKey?: string) => void;
  onEndCoalesce: () => void;
}) {
  const selected = seedColor ?? DEFAULT_MATERIAL_SEED_COLOR;
  const colors = materialYouColors(selected, scheme);

  return (
    <div className="space-y-6 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Material You</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Pick one palette. Android automatically generates accessible light and dark colors for
          buttons, cards, text, accents, and surfaces.
        </p>
      </div>

      <section className="space-y-3">
        <SectionTitle>Palette</SectionTitle>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Material color palette">
          {MATERIAL_PALETTE_OPTIONS.map((palette) => {
            const active = palette.seedColor.toUpperCase() === selected.toUpperCase();
            return (
              <button
                key={palette.id}
                type="button"
                aria-label={`${palette.label} palette`}
                aria-pressed={active}
                onClick={() => onChange(palette.seedColor)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[11px] font-semibold transition",
                  active
                    ? "border-blue-500 bg-blue-50 text-blue-800 ring-1 ring-blue-200"
                    : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                <span
                  className="size-7 rounded-full shadow-sm ring-1 ring-black/10"
                  style={{ background: palette.seedColor }}
                  aria-hidden="true"
                />
                {palette.label}
              </button>
            );
          })}
        </div>

        <Field label="Custom seed" hint="Material You derives the full palette from this color.">
          <ColorField
            allowTokens={false}
            value={selected}
            onChange={(next, coalesce) => {
              if (!next || !/^#[0-9a-fA-F]{6}$/.test(next)) return;
              onChange(next.toUpperCase(), coalesce ? "materialYou:seedColor" : undefined);
            }}
            onBlur={onEndCoalesce}
          />
        </Field>
      </section>

      <section className="space-y-3">
        <SectionTitle>{scheme} preview</SectionTitle>
        <div
          className="grid grid-cols-4 gap-2 rounded-2xl p-3"
          style={{ background: colors.surface }}
          aria-label={`Generated ${scheme} Material colors`}
        >
          {[
            ["Primary", colors.primary, colors.onPrimary],
            ["Container", colors.primaryContainer, colors.onPrimaryContainer],
            ["Secondary", colors.secondaryContainer, colors.onSecondaryContainer],
            ["Tertiary", colors.tertiaryContainer, colors.onTertiaryContainer],
          ].map(([label, background, color]) => (
            <div
              key={label}
              className="flex aspect-square items-center justify-center rounded-xl p-1 text-center text-[9px] font-bold"
              style={{ background, color }}
            >
              {label}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
