"use client";

import type { ReactNode } from "react";
import {
  formatValue,
  seriesColor,
  type ChartSeries,
  type ValueFormat,
} from "./chart-format";

/**
 * The furniture every chart shares: title, legend, and the table view that
 * carries the numbers for anyone who cannot use the plot.
 */
export function ChartFrame({
  title,
  description,
  series,
  format = "number",
  currency = "usd",
  omittedSeries = 0,
  children,
}: {
  title?: string;
  description?: string;
  series: ChartSeries[];
  format?: ValueFormat;
  currency?: string;
  omittedSeries?: number;
  children: ReactNode;
}) {
  return (
    <figure className="m-0">
      {title ? (
        <figcaption className="mb-0.5 text-sm font-semibold text-slate-950">
          {title}
        </figcaption>
      ) : null}
      {description ? (
        <p className="mb-2 text-xs leading-5 text-slate-500">{description}</p>
      ) : null}

      {/* One series needs no legend — the title already names what is plotted. */}
      {series.length > 1 ? (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((entry, index) => (
            <li
              key={entry.label}
              className="flex items-center gap-1.5 text-xs text-slate-600"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: seriesColor(index) }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      ) : null}

      {children}

      {omittedSeries > 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          {omittedSeries} more series not shown.
        </p>
      ) : null}

      <ChartDataTable series={series} format={format} currency={currency} />
    </figure>
  );
}

/** The values behind the marks, collapsed by default. */
function ChartDataTable({
  series,
  format,
  currency,
}: {
  series: ChartSeries[];
  format: ValueFormat;
  currency: string;
}) {
  const categories = [...new Set(series.flatMap((entry) => entry.points.map((p) => p.x)))];
  if (categories.length === 0) return null;

  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer select-none hover:text-slate-700">
        Data table
      </summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-left tabular-nums">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-2 py-1 font-medium">
                Category
              </th>
              {series.map((entry) => (
                <th key={entry.label} scope="col" className="px-2 py-1 text-right font-medium">
                  {entry.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category} className="border-t border-slate-100">
                <th scope="row" className="px-2 py-1 font-normal text-slate-700">
                  {category}
                </th>
                {series.map((entry) => {
                  const point = entry.points.find((p) => p.x === category);
                  return (
                    <td key={entry.label} className="px-2 py-1 text-right text-slate-700">
                      {point ? formatValue(point.y, format, currency) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The hover card shared by the line and bar charts. */
export function ChartTooltip({
  x,
  y,
  heading,
  rows,
  containerWidth,
}: {
  x: number;
  y: number;
  heading: string;
  rows: { label: string; value: string; color: string }[];
  containerWidth: number;
}) {
  // Flip the card to the other side of the cursor near the right edge so it
  // never leaves the chart.
  const flip = x > containerWidth - 140;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-32 rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-lg"
      style={{
        left: x,
        top: y,
        transform: `translate(${flip ? "calc(-100% - 12px)" : "12px"}, -50%)`,
      }}
      role="tooltip"
    >
      <p className="text-[11px] font-medium text-slate-500">{heading}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
            <span className="min-w-0 flex-1 truncate text-slate-600">{row.label}</span>
            <span className="font-medium tabular-nums text-slate-900">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
