import { describe, expect, it } from "vitest";
import { SUGGESTED_SYMBOLS } from "./sf-symbols";
import { getSymbolDefinition, searchSymbols } from "./sf-symbols.server";
import { TEMPLATES, TEMPLATE_KEYS } from "./templates";
import type { PaywallNode } from "./schema";

describe("sf symbols", () => {
  it("returns real vector definitions from the npm package", () => {
    expect(getSymbolDefinition("bolt.fill")?.sourceName).toBe("bolt.fill");
    expect(getSymbolDefinition("person.2.fill")?.svgPathData.length).toBeGreaterThan(0);
    expect(getSymbolDefinition("wand.and.stars")?.sourceName).toBe("wand.and.sparkles");
  });

  it("knows which names it can draw", () => {
    expect(getSymbolDefinition("checkmark.circle.fill")).toBeDefined();
    expect(getSymbolDefinition("infinity")).toBeDefined();
    expect(getSymbolDefinition("definitely.not.a.symbol")).toBeUndefined();
    expect(getSymbolDefinition("")).toBeUndefined();
  });

  it("ranks exact, prefix, then substring matches", () => {
    const results = searchSymbols("bolt", 80);
    expect(results[0]).toBe("bolt");
    expect(results.slice(1, 3).every((name) => name.startsWith("bolt"))).toBe(true);
    expect(results).toContain("cloud.bolt.fill");
    expect(searchSymbols("lock open")).toContain("lock.open.fill");
    expect(searchSymbols("zzzz-nothing")).toEqual([]);
    expect(searchSymbols("", 5)).toHaveLength(5);
  });

  it("can draw every suggested symbol and every icon in the starter templates", () => {
    for (const name of SUGGESTED_SYMBOLS) expect(getSymbolDefinition(name), name).toBeDefined();
    const icons: string[] = [];
    const visit = (node: PaywallNode) => {
      if (typeof node.props.icon === "string") icons.push(node.props.icon);
      if (typeof node.props.systemName === "string") icons.push(node.props.systemName);
      node.children?.forEach(visit);
    };
    for (const key of TEMPLATE_KEYS) visit(TEMPLATES[key].build().root);
    expect(icons.length).toBeGreaterThan(5);
    for (const icon of icons) expect(getSymbolDefinition(icon), icon).toBeDefined();
  });
});
