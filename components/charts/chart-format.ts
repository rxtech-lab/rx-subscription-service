/**
 * Formatting and scale helpers shared by every chart.
 *
 * Kept free of React so the tick maths can be tested directly.
 */

export interface ChartPoint {
  x: string;
  y: number;
}

export interface ChartSeries {
  label: string;
  points: ChartPoint[];
}

export type ValueFormat = "number" | "currency" | "percent";

/**
 * Categorical slots in fixed order. Never cycle past the end — a generated
 * ninth hue is indistinguishable from an existing one under colour-vision
 * deficiency, so charts cap the series count instead.
 */
export const SERIES_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
] as const;

export const MAX_SERIES = SERIES_COLORS.length;

export function seriesColor(index: number): string {
  return SERIES_COLORS[Math.min(index, SERIES_COLORS.length - 1)];
}

/** 1,284 · 12.9K · 4.2M — for axis ticks and headline values. */
export function formatCompact(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (magnitude >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (magnitude >= 10_000) return `${trim(value / 1_000)}K`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Money is stored in integer cents everywhere in this app, so charts take cents
 * and decide the decimals: whole units past $100 read better without them.
 */
export function formatCents(cents: number, currency = "usd"): string {
  const amount = cents / 100;
  const fractionDigits = Math.abs(amount) >= 100 || Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    // An unknown ISO code should not take the chart down with it.
    return `${formatCompact(amount)} ${currency.toUpperCase()}`;
  }
}

export function formatValue(
  value: number,
  format: ValueFormat = "number",
  currency = "usd",
): string {
  if (format === "currency") return formatCents(value, currency);
  if (format === "percent") return `${trim(value)}%`;
  return new Intl.NumberFormat("en-US").format(Math.round(value * 100) / 100);
}

/** Axis ticks stay compact; a full currency string per tick is too much ink. */
export function formatTick(
  value: number,
  format: ValueFormat = "number",
  currency = "usd",
): string {
  if (format === "currency") {
    const symbol = currencySymbol(currency);
    return `${value < 0 ? "-" : ""}${symbol}${formatCompact(Math.abs(value) / 100)}`;
  }
  if (format === "percent") return `${formatCompact(value)}%`;
  return formatCompact(value);
}

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * Round ticks to 1/2/5 × 10ⁿ so the axis reads 0 / 1,000 / 2,000 rather than
 * 0 / 1,137 / 2,274.
 */
export function niceTicks(max: number, min = 0, count = 4): number[] {
  if (!Number.isFinite(max) || !Number.isFinite(min)) return [0];
  if (max === min) return max === 0 ? [0, 1] : [Math.min(0, max), max];

  const step = niceStep((max - min) / Math.max(1, count));
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Floating-point steps drift, so round each tick back onto the step grid.
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Math.round(value / step) * step);
  }
  return ticks;
}

function niceStep(rough: number): number {
  const exponent = Math.floor(Math.log10(Math.abs(rough) || 1));
  const magnitude = 10 ** exponent;
  const normalized = rough / magnitude;
  const stepped = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return stepped * magnitude;
}

/** 2026-08-18 → Aug 18. Anything that is not a date is left alone. */
export function formatDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Pick roughly `count` evenly spaced label positions, always keeping the first
 * and last, so a 90-day axis does not print 90 overlapping dates.
 */
export function tickIndexes(length: number, count: number): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (count - 1);
  const indexes = new Set<number>();
  for (let position = 0; position < count; position += 1) {
    indexes.add(Math.round(position * step));
  }
  return [...indexes].sort((a, b) => a - b);
}

/**
 * A bar with its data-end rounded and its baseline square, drawn as a path so
 * the corner radius never exceeds half the bar.
 */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  direction: "up" | "right" = "up",
): string {
  const size = direction === "up" ? height : width;
  const r = Math.max(0, Math.min(radius, size, (direction === "up" ? width : height) / 2));

  if (direction === "up") {
    const bottom = y + height;
    return [
      `M${x},${bottom}`,
      `L${x},${y + r}`,
      `Q${x},${y} ${x + r},${y}`,
      `L${x + width - r},${y}`,
      `Q${x + width},${y} ${x + width},${y + r}`,
      `L${x + width},${bottom}`,
      "Z",
    ].join(" ");
  }

  const right = x + width;
  return [
    `M${x},${y}`,
    `L${right - r},${y}`,
    `Q${right},${y} ${right},${y + r}`,
    `L${right},${y + height - r}`,
    `Q${right},${y + height} ${right - r},${y + height}`,
    `L${x},${y + height}`,
    "Z",
  ].join(" ");
}
