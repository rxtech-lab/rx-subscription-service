import "server-only";

import { createRequire } from "node:module";
import { rankSymbols } from "./sf-symbols";

// The package's ESM barrel omits file extensions, which native Node rejects
// when Next externalizes it. Its CommonJS export resolves the same generated
// definitions correctly and keeps the catalog out of the compiled app bundle.
const require = createRequire(import.meta.url);
const symbolExports = require("@bradleyhodges/sfsymbols") as Record<string, unknown>;

export interface SymbolDefinition {
  sourceName: string;
  viewBox: string;
  svgPathData: Array<{
    d: string;
    fill?: string;
    fillOpacity?: number;
  }>;
}

function isSymbolDefinition(value: unknown): value is SymbolDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SymbolDefinition>;
  return typeof candidate.sourceName === "string" && Array.isArray(candidate.svgPathData);
}

const SYMBOL_DEFINITIONS = Object.values(symbolExports).filter(isSymbolDefinition);
const SYMBOLS_BY_NAME = new Map<string, SymbolDefinition>();
for (const symbol of SYMBOL_DEFINITIONS) {
  if (!SYMBOLS_BY_NAME.has(symbol.sourceName)) SYMBOLS_BY_NAME.set(symbol.sourceName, symbol);
}

/** Deprecated Apple names that still appear in existing paywall documents. */
const LEGACY_ALIASES: Record<string, string> = {
  "wand.and.stars": "wand.and.sparkles",
  "wand.and.stars.inverse": "wand.and.sparkles.inverse",
};

export const SF_SYMBOL_NAMES = [...SYMBOLS_BY_NAME.keys()].sort();

export function getSymbolDefinition(name: string): SymbolDefinition | undefined {
  const trimmed = name.trim();
  return SYMBOLS_BY_NAME.get(LEGACY_ALIASES[trimmed] ?? trimmed);
}

export function searchSymbols(query: string, limit = 40): string[] {
  return rankSymbols(SF_SYMBOL_NAMES, query, limit);
}
