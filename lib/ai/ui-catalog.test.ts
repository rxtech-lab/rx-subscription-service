import { describe, expect, it } from "vitest";
import { uiCatalogReference, uiSpecSchema, validateUiSpec } from "./ui-catalog";

const chartSpec = {
  root: "root",
  elements: [
    { key: "root", type: "Stack", props: { gap: "md" }, children: ["chart"] },
    {
      key: "chart",
      type: "LineChart",
      props: {
        title: "Active subscriptions",
        series: [
          {
            label: "Active",
            points: [
              { x: "2026-08-17", y: 3 },
              { x: "2026-08-18", y: 5 },
            ],
          },
        ],
      },
      children: [],
    },
  ],
};

describe("validateUiSpec", () => {
  it("folds a valid element list into a renderable spec", () => {
    const result = validateUiSpec(chartSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.root).toBe("root");
    expect(Object.keys(result.spec.elements)).toEqual(["root", "chart"]);
    expect(result.spec.elements.chart.type).toBe("LineChart");
  });

  it("rejects a component that is not in the catalog", () => {
    const result = validateUiSpec({
      root: "root",
      elements: [{ key: "root", type: "ScriptTag", props: {}, children: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects props the component's schema does not allow", () => {
    const result = validateUiSpec({
      root: "root",
      elements: [
        { key: "root", type: "LineChart", props: { series: "everything" }, children: [] },
      ],
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("series");
  });

  it("rejects a child reference that does not exist", () => {
    const result = validateUiSpec({
      root: "root",
      elements: [{ key: "root", type: "Stack", props: {}, children: ["missing"] }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects children on a component that cannot hold them", () => {
    const result = validateUiSpec({
      root: "root",
      elements: [
        {
          key: "root",
          type: "Metric",
          props: { label: "MRR", value: "$10" },
          children: ["note"],
        },
        { key: "note", type: "Text", props: { text: "hi" }, children: [] },
      ],
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("cannot hold children");
  });

  it("rejects duplicate element keys", () => {
    const result = validateUiSpec({
      root: "root",
      elements: [
        { key: "root", type: "Text", props: { text: "a" }, children: [] },
        { key: "root", type: "Text", props: { text: "b" }, children: [] },
      ],
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("Duplicate");
  });

  it("rejects a root that is not among the elements", () => {
    const result = validateUiSpec({
      root: "ghost",
      elements: [{ key: "root", type: "Divider", props: {}, children: [] }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("uiSpecSchema", () => {
  // A Zod record loses its value schema in the AI SDK's tool-schema conversion,
  // which would tell the model that no element may be sent at all.
  it("describes elements as a list so the tool schema keeps their props", () => {
    const json = JSON.stringify(uiSpecSchema.shape.elements);
    expect(json).not.toContain("record");
    const parsed = uiSpecSchema.safeParse(chartSpec);
    expect(parsed.success).toBe(true);
  });

  it("defaults children to an empty list", () => {
    const parsed = uiSpecSchema.parse({
      root: "root",
      elements: [{ key: "root", type: "Text", props: { text: "hi" } }],
    });
    expect(parsed.elements[0].children).toEqual([]);
  });
});

describe("uiCatalogReference", () => {
  it("documents every component with its prop signature", () => {
    const reference = uiCatalogReference();
    expect(reference).toContain("- Stack [holds children]");
    expect(reference).toContain("series: { label: string; points:");
    expect(reference).toContain("rows: (string|number)[][]");
    // Leaf components must not advertise children.
    expect(reference).not.toContain("- Metric [holds children]");
  });
});
