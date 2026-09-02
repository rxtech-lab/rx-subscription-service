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
  defaultNodeFor,
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

function tabFixture(): PaywallSpec {
  return {
    version: 1,
    theme: TEMPLATES.blank.build().theme,
    root: {
      id: "root",
      type: "VStack",
      props: {},
      children: [
        {
          id: "tabs",
          type: "TabView",
          props: { tabs: [{ title: "Monthly" }, { title: "Yearly" }] },
          children: [
            { id: "page-1", type: "VStack", props: {}, children: [] },
            { id: "page-2", type: "VStack", props: {}, children: [] },
          ],
        },
      ],
    },
  };
}

function titles(spec: PaywallSpec): string[] {
  const tabs = findNode(spec, "tabs")!.props.tabs as { title: string }[];
  return tabs.map((tab) => tab.title);
}

function pages(spec: PaywallSpec): string[] {
  return (findNode(spec, "tabs")!.children ?? []).map((child) => child.id);
}

describe("TabView tabs follow their pages", () => {
  it("titles a newly inserted page at the position it landed", () => {
    const next = insertNode(tabFixture(), "tabs", 1, {
      id: "page-mid",
      type: "VStack",
      props: {},
      children: [],
    });
    expect(pages(next)).toEqual(["page-1", "page-mid", "page-2"]);
    expect(titles(next)).toEqual(["Monthly", "Tab 3", "Yearly"]);
  });

  it("drops the title of a removed page, not the last one", () => {
    const next = removeNode(tabFixture(), "page-1");
    expect(pages(next)).toEqual(["page-2"]);
    expect(titles(next)).toEqual(["Yearly"]);
  });

  it("carries a title along when its page is reordered", () => {
    const next = moveNode(tabFixture(), "page-2", "tabs", 0);
    expect(pages(next)).toEqual(["page-2", "page-1"]);
    expect(titles(next)).toEqual(["Yearly", "Monthly"]);
  });

  it("copies the source title when a page is duplicated", () => {
    const next = duplicateNode(tabFixture(), "page-1");
    expect(titles(next)).toEqual(["Monthly", "Monthly", "Yearly"]);
  });

  it("leaves other containers' props alone", () => {
    const spec = fixture();
    const next = removeNode(spec, "b");
    expect(findNode(next, "box")!.props).toEqual({});
  });

  it("refuses a sixth tab", () => {
    let spec = tabFixture();
    for (const id of ["p3", "p4", "p5"]) {
      spec = insertNode(spec, "tabs", undefined, { id, type: "VStack", props: {}, children: [] });
    }
    expect(() =>
      insertNode(spec, "tabs", undefined, { id: "p6", type: "VStack", props: {}, children: [] }),
    ).toThrow(PaywallEditError);
  });
});

describe("defaultNodeFor", () => {
  it("starts a TabView with a named page per tab and unique ids", () => {
    const node = defaultNodeFor("TabView", new Set(["root"]));
    expect(node.children).toHaveLength(2);
    expect((node.props.tabs as { title: string }[]).map((tab) => tab.title)).toEqual([
      "Monthly",
      "Yearly",
    ]);
    expect(collectIds(node).size).toBe(3);
  });
});
