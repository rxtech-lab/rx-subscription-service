import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { SAMPLE_PRODUCTS } from "@/lib/paywall/export";
import { TEMPLATES } from "@/lib/paywall/templates";
import type { PaywallSpec } from "@/lib/paywall/schema";
import { PaywallRenderer } from "@/components/paywall/paywall-renderer";

describe("bar", () => {
  it("dumps", () => {
    const spec: PaywallSpec = {
      version: 1,
      theme: TEMPLATES.blank.build().theme,
      root: {
        id: "root",
        type: "VStack",
        props: {},
        children: [{ id: "plans", type: "ProductList", props: { periodFilter: {} } }],
      },
    };
    const html = renderToStaticMarkup(
      createElement(PaywallRenderer, {
        spec,
        products: SAMPLE_PRODUCTS,
        scheme: "light" as const,
        mode: "preview" as const,
      }),
    );
    const start = html.indexOf('role="group"');
    writeFileSync("/tmp/bar.html", html);
  });
});
