import { describe, expect, it } from "vitest";
import {
  nodeCatalogReference,
  NODE_TYPES,
  validatePaywallSpec,
  type PaywallSpec,
} from "./schema";
import { TEMPLATE_KEYS, TEMPLATES } from "./templates";

function spec(root: PaywallSpec["root"]): PaywallSpec {
  return { version: 1, theme: TEMPLATES.blank.build().theme, root };
}

describe("validatePaywallSpec", () => {
  it("accepts every starter template", () => {
    for (const key of TEMPLATE_KEYS) {
      const result = validatePaywallSpec(TEMPLATES[key].build());
      expect(result.ok, key).toBe(true);
    }
  });

  it("accepts independent device layouts and a Material You seed", () => {
    const base = TEMPLATES.classic.build();
    const result = validatePaywallSpec({
      ...base,
      materialYou: { seedColor: "#6750A4" },
      deviceLayouts: {
        android: { ...base.root, id: "android-root" },
        ipad: { ...base.root, id: "ipad-root" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-layout device root", () => {
    const base = TEMPLATES.classic.build();
    const result = validatePaywallSpec({
      ...base,
      deviceLayouts: {
        android: { id: "android-title", type: "Text", props: { text: "No" } },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("deviceLayouts.android"),
      nodeId: "android-title",
    });
  });

  it("rejects a leaf root", () => {
    const result = validatePaywallSpec(spec({ id: "root", type: "Text", props: { text: "x" } }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("layout node") });
  });

  it("rejects children on a leaf", () => {
    const result = validatePaywallSpec(
      spec({
        id: "root",
        type: "VStack",
        props: {},
        children: [{ id: "t", type: "Text", props: { text: "x" }, children: [] }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("children");
  });

  it("rejects duplicate ids", () => {
    const result = validatePaywallSpec(
      spec({
        id: "root",
        type: "VStack",
        props: {},
        children: [
          { id: "dup", type: "Divider", props: {} },
          { id: "dup", type: "Divider", props: {} },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: false, error: 'Duplicate node id "dup".', nodeId: "dup" });
  });

  it("rejects an unknown color and an unknown action", () => {
    const badColor = validatePaywallSpec(
      spec({
        id: "root",
        type: "VStack",
        props: {},
        children: [{ id: "t", type: "Text", props: { text: "x", color: "blueish" } }],
      }),
    );
    expect(badColor.ok).toBe(false);

    const badAction = validatePaywallSpec(
      spec({
        id: "root",
        type: "VStack",
        props: {},
        children: [{ id: "b", type: "Button", props: { label: "Go", action: { type: "buy" } } }],
      }),
    );
    expect(badAction.ok).toBe(false);
  });

  it("requires an Image to have exactly one source", () => {
    const none = validatePaywallSpec(
      spec({ id: "root", type: "VStack", props: {}, children: [{ id: "i", type: "Image", props: {} }] }),
    );
    expect(none).toMatchObject({ ok: false, error: expect.stringContaining("i (Image)"), nodeId: "i" });
    const both = validatePaywallSpec(
      spec({
        id: "root",
        type: "VStack",
        props: {},
        children: [
          { id: "i", type: "Image", props: { url: "https://x.test/a.png", systemName: "star" } },
        ],
      }),
    );
    expect(both.ok).toBe(false);
  });

  it("names the failing node rather than its position in the tree", () => {
    const result = validatePaywallSpec(
      spec({
        id: "root",
        type: "VStack",
        props: {},
        children: [{ id: "g", type: "Grid", props: { columns: 9 }, children: [] }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^g \(Grid\) columns:/);
      expect(result.nodeId).toBe("g");
    }
  });

  it("names a node nested deep inside a device layout", () => {
    const base = TEMPLATES.classic.build();
    const result = validatePaywallSpec({
      ...base,
      deviceLayouts: {
        ipad: {
          id: "ipad-root",
          type: "VStack",
          props: {},
          children: [
            {
              id: "ipad-hero",
              type: "VStack",
              props: {},
              children: [{ id: "ipad-icon", type: "Image", props: { width: 56 } }],
            },
          ],
        },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("deviceLayouts.ipad ipad-icon (Image)"),
      nodeId: "ipad-icon",
    });
  });

  it("caps the number of product lists", () => {
    const result = validatePaywallSpec(
      spec({
        id: "root",
        type: "VStack",
        props: {},
        children: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, type: "ProductList" as const, props: {} })),
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("nodeCatalogReference", () => {
  it("documents every node type and the modifier set", () => {
    const reference = nodeCatalogReference();
    for (const type of NODE_TYPES) expect(reference).toContain(`- ${type}`);
    expect(reference).toContain("[holds children]");
    expect(reference).toContain("modifiers");
    expect(reference).toContain("restorePurchases");
  });
});
