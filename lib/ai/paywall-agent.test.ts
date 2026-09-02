import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { NODE_TYPES } from "@/lib/paywall/schema";
import { TEMPLATES } from "@/lib/paywall/templates";
import { buildPaywallTools, paywallSystemPrompt, paywallToolSchemas } from "./paywall-agent";

describe("paywallSystemPrompt", () => {
  it("carries the catalog, the products, and the current document", () => {
    const spec = TEMPLATES.classic.build();
    const prompt = paywallSystemPrompt({
      paywallName: "Onboarding",
      spec,
      products: [{ name: "Pro", priceLabel: "$19.00", periodLabel: "per month", planGroup: "default", trialDays: 7 }],
    });
    for (const type of NODE_TYPES) expect(prompt).toContain(`- ${type}`);
    expect(prompt).toContain("Pro: $19.00 per month, 7-day trial");
    expect(prompt).toContain('"hero-title"');
    expect(prompt).toContain("Onboarding");
  });
});

describe("tool schemas", () => {
  it("convert the recursive node to a JSON schema with definitions, not an empty object", () => {
    const insert = JSON.stringify(zodSchema(paywallToolSchemas.insertNode).jsonSchema);
    expect(insert).toMatch(/"\$ref"/);
    expect(insert).toMatch(/definitions|\$defs/);
    expect(insert).toContain('"const":"ProductList"');

    const replace = zodSchema(paywallToolSchemas.replacePaywall).jsonSchema as {
      properties: { spec: { properties?: Record<string, unknown>; $ref?: string } };
    };
    expect(JSON.stringify(replace)).toContain("colorScheme");
  });

  it("keeps updateNode props as explicit properties", () => {
    const json = zodSchema(paywallToolSchemas.updateNode).jsonSchema as {
      properties: { props: { properties: Record<string, unknown> } };
    };
    const keys = Object.keys(json.properties.props.properties);
    expect(keys).toEqual(expect.arrayContaining(["text", "label", "action", "columns", "highlight", "alignment"]));
  });
});

describe("buildPaywallTools", () => {
  it("compounds edits across calls and returns the working document", async () => {
    const { tools, current } = buildPaywallTools(TEMPLATES.blank.build());
    const options = { toolCallId: "t", messages: [] };

    const inserted = (await tools.insertNode.execute!(
      {
        parentId: "page",
        index: 0,
        node: { id: "new-badge", type: "Badge", props: { text: "New" } },
      },
      options,
    )) as { ok: boolean; spec?: { root: unknown } };
    expect(inserted.ok).toBe(true);

    const updated = (await tools.updateNode.execute!(
      { id: "new-badge", props: { text: "Most popular", color: "accent" } },
      options,
    )) as { ok: boolean; summary?: string };
    expect(updated.ok).toBe(true);
    expect(updated.summary).toBe("Updated new-badge");

    const listed = (await tools.listNodes.execute!({}, options)) as {
      nodes: { id: string; label: string }[];
    };
    expect(listed.nodes.find((node) => node.id === "new-badge")?.label).toBe("Most popular");
    expect(JSON.stringify(current())).toContain("Most popular");
  });

  it("reports validation failures without adopting them", async () => {
    const { tools, current } = buildPaywallTools(TEMPLATES.blank.build());
    const before = JSON.stringify(current());
    const options = { toolCallId: "t", messages: [] };

    const bad = (await tools.updateNode.execute!(
      { id: "title", props: { color: "not-a-color" } },
      options,
    )) as { ok: boolean; error?: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("color");

    const missing = (await tools.removeNode.execute!({ id: "nope" }, options)) as {
      ok: boolean;
      error?: string;
    };
    expect(missing).toEqual({ ok: false, error: 'No node with id "nope".' });
    expect(JSON.stringify(current())).toBe(before);
  });
});
