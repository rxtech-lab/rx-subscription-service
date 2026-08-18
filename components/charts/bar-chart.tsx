"use client";

import { useState } from "react";
import { ChartFrame, ChartTooltip } from "./chart-frame";
import { EmptyChart } from "./line-chart";
import {
  barPath,
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

const MAX_BAR = 24;
const BAR_GAP = 2;
const BAR_RADIUS = 4;
const FALLBACK_WIDTH = 560;

/**
 * Compare magnitude across categories, as columns or as horizontal bars.
 *
 * Bars are capped at 24px and separated by a 2px surface gap, so a short
 * category list reads as marks with air around them rather than as a block.
 */
export function BarChart({
  title,
  description,
  series,
  orientation = "vertical",
  format = "number",
  currency = "usd",
  height,
}: {
  title?: string;
  description?: string;
  series: ChartSeries[];
  orientation?: "vertical" | "horizontal";
  format?: ValueFormat;
  currency?: string;
  height?: number;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const [hovered, setHovered] = useState<{
    category: number;
    series: number;
  } | null>(null);

  const shown = series.slice(0, MAX_SERIES).filter((entry) => entry.points.length > 0);
  const categories = [
    ...new Set(shown.flatMap((entry) => entry.points.map((point) => point.x))),
  ];

  if (categories.length === 0) {
    return <EmptyChart title={title} description={description} />;
  }

  const valueAt = (seriesIndex: number, category: string) =>
    shown[seriesIndex]?.points.find((point) => point.x === category)?.y ?? 0;

  const values = shown.flatMap((entry) => entry.points.map((point) => point.y));
  const ticks = niceTicks(Math.max(...values, 0), Math.min(...values, 0));
  const minTick = ticks[0];
  const maxTick = ticks[ticks.length - 1];
  const spanOf = (value: number) =>
    Math.abs(value - Math.max(minTick, Math.min(0, maxTick))) /
    (maxTick - minTick || 1);

  const padding =
    orientation === "vertical"
      ? { top: 12, right: 12, bottom: 24, left: 44 }
      : { top: 8, right: 44, bottom: 20, left: 96 };

  const chartHeight =
    height ??
    (orientation === "vertical"
      ? 220
      : padding.top + padding.bottom + categories.length * Math.max(28, MAX_BAR + 12));

  const plotWidth = Math.max(40, width - padding.left - padding.right);
  const plotHeight = Math.max(40, chartHeight - padding.top - padding.bottom);

  const band = (orientation === "vertical" ? plotWidth : plotHeight) / categories.length;
  const barSize = Math.max(
    2,
    Math.min(MAX_BAR, (band * 0.72 - BAR_GAP * (shown.length - 1)) / shown.length),
  );
  const groupSize = barSize * shown.length + BAR_GAP * (shown.length - 1);
  const zeroLine =
    orientation === "vertical"
      ? padding.top + plotHeight * (maxTick / (maxTick - minTick || 1))
      : padding.left + plotWidth * (-minTick / (maxTick - minTick || 1));

  const labelIndexes =
    orientation === "vertical"
      ? tickIndexes(categories.length, Math.max(2, Math.min(8, Math.floor(plotWidth / 56))))
      : categories.map((_, index) => index);

  return (
    <ChartFrame
      title={title}
      description={description}
      series={shown}
      format={format}
      currency={currency}
      omittedSeries={series.length - shown.length}
    >
      <div ref={ref} className="relative w-full">
        <svg
          width={width}
          height={chartHeight}
          role="img"
          aria-label={title ?? "Bar chart"}
          className="block overflow-visible"
        >
          {ticks.map((tick) => {
            const position =
              orientation === "vertical"
                ? padding.top +
                  plotHeight -
                  ((tick - minTick) / (maxTick - minTick || 1)) * plotHeight
                : padding.left +
                  ((tick - minTick) / (maxTick - minTick || 1)) * plotWidth;
            return orientation === "vertical" ? (
              <g key={tick}>
                <line
                  x1={padding.left}
                  x2={padding.left + plotWidth}
                  y1={position}
                  y2={position}
                  stroke="#e8eaee"
                />
                <text
                  x={padding.left - 8}
                  y={position}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-slate-400 text-[10px] tabular-nums"
                >
                  {formatTick(tick, format, currency)}
                </text>
              </g>
            ) : (
              <g key={tick}>
                <line
                  x1={position}
                  x2={position}
                  y1={padding.top}
                  y2={padding.top + plotHeight}
                  stroke="#e8eaee"
                />
                <text
                  x={position}
                  y={chartHeight - 6}
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] tabular-nums"
                >
                  {formatTick(tick, format, currency)}
                </text>
              </g>
            );
          })}

          {categories.map((category, categoryIndex) => {
            const groupStart =
              (orientation === "vertical" ? padding.left : padding.top) +
              band * categoryIndex +
              (band - groupSize) / 2;

            return (
              <g key={category}>
                {shown.map((entry, seriesIndex) => {
                  const value = valueAt(seriesIndex, category);
                  const length = spanOf(value) * (orientation === "vertical" ? plotHeight : plotWidth);
                  const offset = groupStart + seriesIndex * (barSize + BAR_GAP);
                  const active =
                    hovered?.category === categoryIndex &&
                    hovered.series === seriesIndex;

                  const path =
                    orientation === "vertical"
                      ? barPath(
                          offset,
                          value >= 0 ? zeroLine - length : zeroLine,
                          barSize,
                          length,
                          BAR_RADIUS,
                          "up",
                        )
                      : barPath(
                          value >= 0 ? zeroLine : zeroLine - length,
                          offset,
                          length,
                          barSize,
                          BAR_RADIUS,
                          "right",
                        );

                  return (
                    <path
                      key={entry.label}
                      d={path}
                      fill={seriesColor(seriesIndex)}
                      opacity={hovered && !active ? 0.75 : 1}
                      onPointerEnter={() =>
                        setHovered({ category: categoryIndex, series: seriesIndex })
                      }
                      onPointerLeave={() => setHovered(null)}
                    />
                  );
                })}
              </g>
            );
          })}

          {labelIndexes.map((index) => {
            const center =
              (orientation === "vertical" ? padding.left : padding.top) +
              band * index +
              band / 2;
            return orientation === "vertical" ? (
              <text
                key={index}
                x={center}
                y={chartHeight - 6}
                textAnchor="middle"
                className="fill-slate-400 text-[10px]"
              >
                {formatDateLabel(categories[index])}
              </text>
            ) : (
              <text
                key={index}
                x={padding.left - 8}
                y={center}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-500 text-[10px]"
              >
                {truncate(categories[index], 14)}
              </text>
            );
          })}
        </svg>

        {hovered ? (
          <ChartTooltip
            x={
              orientation === "vertical"
                ? padding.left + band * hovered.category + band / 2
                : padding.left +
                  spanOf(valueAt(hovered.series, categories[hovered.category])) *
                    plotWidth
            }
            y={
              orientation === "vertical"
                ? padding.top + plotHeight / 2
                : padding.top + band * hovered.category + band / 2
            }
            containerWidth={width}
            heading={formatDateLabel(categories[hovered.category])}
            rows={[
              {
                label: shown[hovered.series].label,
                color: seriesColor(hovered.series),
                value: formatValue(
                  valueAt(hovered.series, categories[hovered.category]),
                  format,
                  currency,
                ),
              },
            ]}
          />
        ) : null}
      </div>
    </ChartFrame>
  );
}

/** Long category names are clipped with an ellipsis, never mid-glyph. */
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
