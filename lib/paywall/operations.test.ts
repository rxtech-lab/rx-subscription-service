import { describe, expect, it } from "vitest";
import {
  cloneNode,
  collectIds,
  duplicateNode,
  findNode,
  findParent,
  insertNode,
  moveNode,
  outline,
  pasteNode,
  PaywallEditError,
  removeNode,
  shiftNode,
  updateNodeProps,
} from "./operations";
import type { PaywallSpec } from "./schema";
import { TEMPLATES } from "./templates";

function fixture(): PaywallSpec {
  return {
    version: 1,
    theme: TEMPLATES.blank.build().theme,
    root: {
      id: "root",
      type: "VStack",
      props: { spacing: 8 },
      children: [
        { id: "a", type: "Text", props: { text: "A" } },
        {
          id: "box",
          type: "HStack",
          props: {},
          children: [
            { id: "b", type: "Text", props: { text: "B" } },
            { id: "c", type: "Divider", props: {} },
          ],
        },
        { id: "d", type: "Spacer", props: {} },
      ],
    },
  };
}

describe("tree operations", () => {
  it("never mutates the input", () => {
    const before = fixture();
    const snapshot = JSON.stringify(before);
    const after = updateNodeProps(before, "a", { props: { text: "changed" } });
    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(findNode(after, "a")?.props.text).toBe("changed");
  });

  it("merges props and removes undefined keys", () => {
    const spec = updateNodeProps(fixture(), "a", {
      props: { style: "title", text: undefined },
      modifiers: { padding: 8 },
    });
    expect(findNode(spec, "a")?.props).toEqual({ style: "title" });
    expect(findNode(spec, "a")?.modifiers).toEqual({ padding: 8 });
    const cleared = updateNodeProps(spec, "a", { modifiers: { padding: undefined } });
    expect(findNode(cleared, "a")?.modifiers).toBeUndefined();
  });

  it("inserts at a position and appends by default", () => {
    const spec = insertNode(fixture(), "box", 0, { id: "new", type: "Badge", props: { text: "x" } });
    expect(findNode(spec, "box")?.children?.map((c) => c.id)).toEqual(["new", "b", "c"]);
    const appended = insertNode(spec, "box", undefined, { id: "last", type: "Divider", props: {} });
    expect(findNode(appended, "box")?.children?.map((c) => c.id)).toEqual(["new", "b", "c", "last"]);
  });

  it("refuses to insert into a leaf or reuse an id", () => {
    expect(() => insertNode(fixture(), "a", 0, { id: "z", type: "Divider", props: {} })).toThrow(PaywallEditError);
    expect(() => insertNode(fixture(), "root", 0, { id: "b", type: "Divider", props: {} })).toThrow(/already exists/);
  });

  it("removes a subtree but not the root", () => {
    const spec = removeNode(fixture(), "box");
    expect(findNode(spec, "b")).toBeNull();
    expect(spec.root.children?.map((c) => c.id)).toEqual(["a", "d"]);
    expect(() => removeNode(fixture(), "root")).toThrow(PaywallEditError);
  });

  it("moves between parents and adjusts sibling indices", () => {
    const moved = moveNode(fixture(), "a", "box", 2);
    expect(findNode(moved, "box")?.children?.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(moved.root.children?.map((c) => c.id)).toEqual(["box", "d"]);

    // Moving a node later among its own siblings lands at the visual slot.
    const shifted = moveNode(fixture(), "a", "root", 2);
    expect(shifted.root.children?.map((c) => c.id)).toEqual(["box", "a", "d"]);
  });

  it("refuses to move a node into itself or its descendant", () => {
    expect(() => moveNode(fixture(), "box", "box", 0)).toThrow(PaywallEditError);
    const nested = insertNode(fixture(), "box", 0, { id: "inner", type: "VStack", props: {}, children: [] });
    expect(() => moveNode(nested, "box", "inner", 0)).toThrow(/into itself/);
  });

  it("shifts by one and stops at the ends", () => {
    const down = shiftNode(fixture(), "a", 1);
    expect(down.root.children?.map((c) => c.id)).toEqual(["box", "a", "d"]);
    const up = shiftNode(fixture(), "a", -1);
    expect(up.root.children?.map((c) => c.id)).toEqual(["a", "box", "d"]);
  });

  it("duplicates with fresh ids right after the original", () => {
    const spec = duplicateNode(fixture(), "box");
    const ids = spec.root.children?.map((c) => c.id) ?? [];
    expect(ids).toHaveLength(4);
    expect(ids[1]).toBe("box");
    const copyId = ids[2];
    expect(copyId).not.toBe("box");
    const copy = findNode(spec, copyId);
    expect(copy?.children).toHaveLength(2);
    expect(collectIds(spec.root).size).toBe(9);
    expect(findParent(spec, copyId)?.parent.id).toBe("root");
  });

  it("clones a subtree with ids free of the tree it came from", () => {
    const spec = fixture();
    const copy = cloneNode(findNode(spec, "box")!, collectIds(spec.root));
    expect(copy.id).not.toBe("box");
    expect(copy.children?.map((child) => child.props.text ?? child.type)).toEqual(["B", "Divider"]);
    for (const id of collectIds(copy)) expect(collectIds(spec.root).has(id)).toBe(false);
    // The source is untouched, so the clipboard can be pasted more than once.
    expect(findNode(spec, "box")?.children?.map((child) => child.id)).toEqual(["b", "c"]);
  });

  it("pastes inside a layout node and after a leaf", () => {
    const spec = fixture();
    const badge = { id: "pasted", type: "Badge", props: { text: "x" } } as const;

    const inside = pasteNode(spec, badge, "box");
    expect(findNode(inside, "box")?.children?.map((child) => child.id)).toEqual([
      "b",
      "c",
      "pasted",
    ]);

    const after = pasteNode(spec, badge, "a");
    expect(after.root.children?.map((child) => child.id)).toEqual(["a", "pasted", "box", "d"]);
  });

  it("refuses to paste a node whose ids are already in the tree", () => {
    expect(() => pasteNode(fixture(), { id: "a", type: "Badge", props: {} }, "box")).toThrow(
      /already exists/,
    );
    expect(() => pasteNode(fixture(), { id: "new", type: "Badge", props: {} }, "nope")).toThrow(
      PaywallEditError,
    );
  });

  it("outlines depth-first with labels", () => {
    expect(outline(fixture()).map((entry) => `${entry.depth}:${entry.label}`)).toEqual([
      "0:VStack",
      "1:A",
      "1:HStack",
      "2:B",
      "2:Divider",
      "1:Spacer",
    ]);
  });
});
