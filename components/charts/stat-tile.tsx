"use client";

import { cn } from "@/lib/utils";
import { SERIES_COLORS } from "./chart-format";

const SPARK_WIDTH = 96;
const SPARK_HEIGHT = 24;

/**
 * One headline number, optionally with a change and a 12-point sparkline.
 *
 * A single current value is a stat tile, never a one-bar bar chart.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaDirection = "flat",
  deltaIsGood = true,
  hint,
  trend,
  className,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down" | "flat";
  /** Whether an upward move is the good outcome — churn reads the other way. */
  deltaIsGood?: boolean;
  hint?: string;
  trend?: number[];
  className?: string;
}) {
  const good =
    deltaDirection === "flat" ? null : (deltaDirection === "up") === deltaIsGood;

  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold text-slate-950">{value}</p>
      {delta ? (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            good === null
              ? "text-slate-500"
              : good
                ? "text-emerald-700"
                : "text-rose-700",
          )}
        >
          {deltaDirection === "up" ? "↑" : deltaDirection === "down" ? "↓" : "→"} {delta}
        </p>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const points = values.slice(-12);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const step = points.length > 1 ? SPARK_WIDTH / (points.length - 1) : 0;
  const y = (value: number) =>
    SPARK_HEIGHT - 2 - ((value - min) / (max - min || 1)) * (SPARK_HEIGHT - 4);

  const path = points
    .map((value, index) => `${index === 0 ? "M" : "L"}${index * step},${y(value)}`)
    .join(" ");

  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      className="mt-2 block overflow-visible"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinecap="round" />
      <circle
        cx={(points.length - 1) * step}
        cy={y(points[points.length - 1])}
        r={3}
        fill={SERIES_COLORS[0]}
        stroke="#ffffff"
        strokeWidth={2}
      />
    </svg>
  );
}
