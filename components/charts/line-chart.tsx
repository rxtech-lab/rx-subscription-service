"use client";

import { useState, type PointerEvent } from "react";
import { ChartFrame, ChartTooltip } from "./chart-frame";
import {
  formatDateLabel,
  formatTick,
  formatValue,
  MAX_SERIES,
  niceTicks,
  seriesColor,
  tickIndexes,
  type ChartSeries,
  type ValueFormat,
} from "./chart-format";
import { useMeasuredWidth } from "./use-measured-width";

const PADDING = { top: 12, right: 12, bottom: 24, left: 44 };
const FALLBACK_WIDTH = 560;

/**
 * A multi-series line chart for change over time.
 *
 * Categories are treated as evenly spaced bands rather than a continuous time
 * scale: every series in this app is bucketed to whole days already, and band
 * positioning is what makes the crosshair land on a real data point.
 */
export function LineChart({
  title,
  description,
  series,
  format = "number",
  currency = "usd",
  height = 220,
}: {
  title?: string;
  description?: string;
  series: ChartSeries[];
  format?: ValueFormat;
  currency?: string;
  height?: number;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const shown = series.slice(0, MAX_SERIES).filter((entry) => entry.points.length > 0);
  const categories = shown[0]?.points.map((point) => point.x) ?? [];

  if (categories.length === 0) {
    return <EmptyChart title={title} description={description} />;
  }

  const values = shown.flatMap((entry) => entry.points.map((point) => point.y));
  const ticks = niceTicks(Math.max(...values, 0), Math.min(...values, 0));
  const minTick = ticks[0];
  const maxTick = ticks[ticks.length - 1];

  const plotWidth = Math.max(40, width - PADDING.left - PADDING.right);
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const step = categories.length > 1 ? plotWidth / (categories.length - 1) : 0;

  const xAt = (index: number) =>
    PADDING.left + (categories.length > 1 ? index * step : plotWidth / 2);
  const yAt = (value: number) =>
    PADDING.top +
    plotHeight -
    ((value - minTick) / (maxTick - minTick || 1)) * plotHeight;

  const labelIndexes = tickIndexes(
    categories.length,
    Math.max(2, Math.min(6, Math.floor(plotWidth / 68))),
  );

  function trackPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left - PADDING.left;
    const index =
      categories.length > 1
        ? Math.round(offset / (step || 1))
        : 0;
    setHoverIndex(Math.max(0, Math.min(categories.length - 1, index)));
  }

  const hovered = hoverIndex === null ? null : categories[hoverIndex];

  return (
    <ChartFrame
      title={title}
      description={description}
      series={shown}
      format={format}
      currency={currency}
      omittedSeries={series.length - shown.length}
    >
      <div
        ref={ref}
        className="relative w-full touch-none"
        onPointerMove={trackPointer}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={title ?? "Line chart"}
          className="block overflow-visible"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PADDING.left}
                x2={PADDING.left + plotWidth}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="#e8eaee"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
                y={yAt(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-400 text-[10px] tabular-nums"
              >
                {formatTick(tick, format, currency)}
              </text>
            </g>
          ))}

          {labelIndexes.map((index) => (
            <text
              key={index}
              x={xAt(index)}
              y={height - 6}
              textAnchor={
                index === 0
                  ? "start"
                  : index === categories.length - 1
                    ? "end"
                    : "middle"
              }
              className="fill-slate-400 text-[10px]"
            >
              {formatDateLabel(categories[index])}
            </text>
          ))}

          {hoverIndex !== null ? (
            <line
              x1={xAt(hoverIndex)}
              x2={xAt(hoverIndex)}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              stroke="#cbd5e1"
              strokeWidth={1}
            />
          ) : null}

          {shown.map((entry, seriesIndex) => {
            const color = seriesColor(seriesIndex);
            const path = entry.points
              .map(
                (point, index) =>
                  `${index === 0 ? "M" : "L"}${xAt(index)},${yAt(point.y)}`,
              )
              .join(" ");
            const last = entry.points[entry.points.length - 1];

            return (
              <g key={entry.label}>
                {shown.length === 1 ? (
                  <path
                    d={`${path} L${xAt(entry.points.length - 1)},${
                      PADDING.top + plotHeight
                    } L${xAt(0)},${PADDING.top + plotHeight} Z`}
                    fill={color}
                    opacity={0.1}
                  />
                ) : null}
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* End dot: a 2px surface ring keeps it readable where lines cross. */}
                <circle
                  cx={xAt(entry.points.length - 1)}
                  cy={yAt(last.y)}
                  r={4}
                  fill={color}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                {hoverIndex !== null && entry.points[hoverIndex] ? (
                  <circle
                    cx={xAt(hoverIndex)}
                    cy={yAt(entry.points[hoverIndex].y)}
                    r={4}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {hoverIndex !== null && hovered ? (
          <ChartTooltip
            x={xAt(hoverIndex)}
            y={PADDING.top + plotHeight / 2}
            containerWidth={width}
            heading={formatDateLabel(hovered)}
            rows={shown.map((entry, index) => ({
              label: entry.label,
              color: seriesColor(index),
              value: entry.points[hoverIndex]
                ? formatValue(entry.points[hoverIndex].y, format, currency)
                : "—",
            }))}
          />
        ) : null}
      </div>
    </ChartFrame>
  );
}

export function EmptyChart({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <figure className="m-0">
      {title ? (
        <figcaption className="text-sm font-semibold text-slate-950">{title}</figcaption>
      ) : null}
      {description ? (
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
      ) : null}
      <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
        Nothing to plot yet.
      </p>
    </figure>
  );
}
