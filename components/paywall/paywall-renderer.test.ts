import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SAMPLE_PRODUCTS } from "@/lib/paywall/export";
import { TEMPLATES } from "@/lib/paywall/templates";
import type { PaywallNode, PaywallSpec } from "@/lib/paywall/schema";
import { PaywallRenderer } from "./paywall-renderer";

/**
 * Server-rendered snapshots of the preview, which is where a node type first
 * proves it draws at all: the editor is behind a console login, so a broken
 * TabView would otherwise only turn up by hand.
 */
function render(root: PaywallNode): string {
  const spec: PaywallSpec = { version: 1, theme: TEMPLATES.blank.build().theme, root };
  return renderToStaticMarkup(
    createElement(PaywallRenderer, {
      spec,
      products: SAMPLE_PRODUCTS,
      scheme: "light" as const,
      mode: "preview" as const,
    }),
  );
}

function tabs(selectedIndex?: number): PaywallNode {
  return {
    id: "root",
    type: "VStack",
    props: {},
    children: [
      {
        id: "tabs",
        type: "TabView",
        props: {
          tabs: [{ title: "Monthly" }, { title: "Yearly", badge: "-20%" }],
          ...(selectedIndex === undefined ? {} : { selectedIndex }),
        },
        children: [
          { id: "p1", type: "Text", props: { text: "Monthly page" } },
          { id: "p2", type: "Text", props: { text: "Yearly page" } },
        ],
      },
    ],
  };
}

describe("TabView", () => {
  it("draws every tab but only the open page", () => {
    const html = render(tabs());
    expect(html).toContain("Monthly");
    expect(html).toContain("-20%");
    expect(html).toContain("Monthly page");
    expect(html).not.toContain("Yearly page");
  });

  it("opens on selectedIndex", () => {
    const html = render(tabs(1));
    expect(html).toContain("Yearly page");
    expect(html).not.toContain("Monthly page");
  });

  it("labels a page that has no tab of its own", () => {
    const node = tabs();
    const view = node.children![0];
    view.children!.push({ id: "p3", type: "Text", props: { text: "Third page" } });
    expect(render(node)).toContain("Tab 3");
  });
});

describe("ProductList period switcher", () => {
  function list(props: Record<string, unknown>): PaywallNode {
    return {
      id: "root",
      type: "VStack",
      props: {},
      children: [{ id: "plans", type: "ProductList", props }],
    };
  }

  it("shows the switcher and only the opening period's plans", () => {
    const html = render(list({ periodFilter: { defaultInterval: "year" } }));
    expect(html).toContain("Monthly");
    expect(html).toContain("Yearly");
    expect(html).toContain("One-time");
    // The Yearly plan's card, and not the other two.
    expect(html).toContain("$79.99");
    expect(html).not.toContain("$9.99");
    expect(html).not.toContain("$199.00");
  });

  it("draws a plain list when no period filter is set", () => {
    const html = render(list({}));
    expect(html).toContain("$9.99");
    expect(html).toContain("$79.99");
    expect(html).not.toContain("One-time");
  });
});
