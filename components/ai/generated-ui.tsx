"use client";

import {
  JSONUIProvider,
  Renderer,
  type ComponentRegistry,
  type ComponentRenderProps,
} from "@json-render/react";
import { Component, type ReactNode } from "react";
import { BarChart } from "@/components/charts/bar-chart";
import type { ChartSeries, ValueFormat } from "@/components/charts/chart-format";
import { LineChart } from "@/components/charts/line-chart";
import { StatTile } from "@/components/charts/stat-tile";
import { validateUiSpec, type UiProps } from "@/lib/ai/ui-catalog";
import { cn } from "@/lib/utils";

/**
 * The browser half of the assistant's `renderUI` tool.
 *
 * Every catalog entry gets a real component here — the same charts the
 * dashboard uses — so a generated view is styled like the rest of the console
 * rather than like an embedded document. Nothing in this registry can mutate
 * data: there are no inputs, no buttons, and no action handlers.
 */

const TONE_CLASSES = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-rose-100 text-rose-800",
  info: "bg-blue-100 text-blue-800",
} as const;

const CALLOUT_CLASSES = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-rose-200 bg-rose-50 text-rose-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
} as const;

const GAP_CLASSES = { sm: "gap-2", md: "gap-4", lg: "gap-6" } as const;

const GRID_CLASSES: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @sm:grid-cols-2",
  3: "grid-cols-2 @sm:grid-cols-3",
  4: "grid-cols-2 @md:grid-cols-4",
};

type Tone = keyof typeof TONE_CLASSES;

/** Charts come out of the catalog already shaped like the chart components. */
function chartProps(props: {
  series?: ChartSeries[];
  format?: ValueFormat;
  currency?: string;
}) {
  return {
    series: props.series ?? [],
    format: props.format ?? "number",
    currency: props.currency ?? "usd",
  };
}

const registry: ComponentRegistry = {
  Stack: ({ element, children }: ComponentRenderProps<UiProps<"Stack">>) => (
    <div
      className={cn(
        "flex",
        element.props.direction === "horizontal"
          ? "flex-row flex-wrap items-start"
          : "flex-col",
        GAP_CLASSES[element.props.gap ?? "md"],
      )}
    >
      {children}
    </div>
  ),

  Grid: ({ element, children }: ComponentRenderProps<UiProps<"Grid">>) => (
    <div className={cn("grid gap-4", GRID_CLASSES[element.props.columns ?? 2])}>
      {children}
    </div>
  ),

  Card: ({ element, children }: ComponentRenderProps<UiProps<"Card">>) => (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      {element.props.title ? (
        <h3 className="text-sm font-semibold text-slate-950">{element.props.title}</h3>
      ) : null}
      {element.props.description ? (
        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          {element.props.description}
        </p>
      ) : null}
      {element.props.title || element.props.description ? (
        <div className="mt-3">{children}</div>
      ) : (
        children
      )}
    </section>
  ),

  Heading: ({ element }: ComponentRenderProps<UiProps<"Heading">>) => {
    const level = element.props.level ?? 2;
    const className =
      level === 1
        ? "text-base font-semibold text-slate-950"
        : level === 2
          ? "text-sm font-semibold text-slate-950"
          : "text-xs font-semibold uppercase tracking-wide text-slate-500";
    const Tag = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2";
    return <Tag className={className}>{element.props.text}</Tag>;
  },

  Text: ({ element }: ComponentRenderProps<UiProps<"Text">>) => (
    <p
      className={cn(
        "text-sm leading-6",
        element.props.tone === "muted"
          ? "text-slate-500"
          : element.props.tone === "strong"
            ? "font-medium text-slate-950"
            : "text-slate-700",
      )}
    >
      {element.props.text}
    </p>
  ),

  Badge: ({ element }: ComponentRenderProps<UiProps<"Badge">>) => (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[(element.props.tone ?? "neutral") as Tone],
      )}
    >
      {element.props.text}
    </span>
  ),

  Metric: ({ element }: ComponentRenderProps<UiProps<"Metric">>) => (
    <StatTile
      label={element.props.label}
      value={element.props.value}
      delta={element.props.delta}
      deltaDirection={element.props.deltaDirection}
      deltaIsGood={element.props.deltaIsGood}
      hint={element.props.hint}
    />
  ),

  LineChart: ({ element }: ComponentRenderProps<UiProps<"LineChart">>) => (
    <LineChart
      title={element.props.title}
      description={element.props.description}
      {...chartProps(element.props)}
    />
  ),

  BarChart: ({ element }: ComponentRenderProps<UiProps<"BarChart">>) => (
    <BarChart
      title={element.props.title}
      description={element.props.description}
      orientation={element.props.orientation}
      {...chartProps(element.props)}
    />
  ),

  Table: ({ element }: ComponentRenderProps<UiProps<"Table">>) => (
    <div className="overflow-x-auto">
      {element.props.title ? (
        <p className="mb-2 text-sm font-semibold text-slate-950">
          {element.props.title}
        </p>
      ) : null}
      <table className="w-full border-collapse text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            {element.props.columns.map((column, index) => (
              <th
                key={`${column.label}-${index}`}
                scope="col"
                className={cn(
                  "border-b border-slate-200 px-2 py-1.5 font-medium",
                  column.align === "right" && "text-right",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {element.props.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-slate-100 last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "px-2 py-1.5 text-slate-700",
                    element.props.columns[cellIndex]?.align === "right" &&
                      "text-right tabular-nums",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),

  KeyValue: ({ element }: ComponentRenderProps<UiProps<"KeyValue">>) => (
    <dl className="space-y-1">
      {element.props.items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="flex gap-3 text-xs">
          <dt className="shrink-0 text-slate-500">{item.label}</dt>
          <dd className="min-w-0 flex-1 break-words text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  ),

  Callout: ({ element }: ComponentRenderProps<UiProps<"Callout">>) => (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs leading-5",
        CALLOUT_CLASSES[(element.props.tone ?? "info") as Tone],
      )}
    >
      {element.props.title ? (
        <p className="font-semibold">{element.props.title}</p>
      ) : null}
      <p className={element.props.title ? "mt-0.5" : undefined}>{element.props.text}</p>
    </div>
  ),

  Divider: () => <hr className="border-slate-200" />,
};

/**
 * Render one assistant-generated view.
 *
 * The spec was validated against the catalog on the server, but a render error
 * still must not take the whole chat down, so the tree is wrapped.
 */
export function GeneratedUi({ spec: input }: { spec: unknown }): ReactNode {
  // The tool call carries the model's element list; the same validation the
  // server ran folds it into a renderable spec here.
  const validated = validateUiSpec(input);
  if (!validated.ok) return null;
  const spec = validated.spec;

  return (
    // `@container` lets the generated grid respond to the panel width rather
    // than the viewport, since the panel is resizable.
    <div className="@container rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <RenderBoundary>
        <JSONUIProvider registry={registry}>
          <Renderer spec={spec} registry={registry} />
        </JSONUIProvider>
      </RenderBoundary>
    </div>
  );
}

class RenderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Assistant-generated UI failed to render:", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="text-xs text-slate-500">
          This view could not be displayed. Ask the assistant to show it again.
        </p>
      );
    }
    return this.props.children;
  }
}
