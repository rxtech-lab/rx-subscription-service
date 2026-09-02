import "server-only";
import { tool } from "ai";
import { z } from "zod";
import type { ResolvedProduct } from "@/lib/paywall/export";
import {
  insertNode,
  moveNode,
  outline,
  PaywallEditError,
  removeNode,
  updateNodeProps,
} from "@/lib/paywall/operations";
import {
  modifiersSchema,
  nodeCatalogReference,
  nodeProps,
  NODE_TYPES,
  paywallNodeSchema,
  paywallSpecSchema,
  themeSchema,
  validatePaywallSpec,
  type PaywallSpec,
} from "@/lib/paywall/schema";

/**
 * The paywall editor's agent.
 *
 * Unlike the subscription assistant, nothing here writes to the database. The
 * browser sends the draft it is editing, every tool call edits a working copy
 * of that draft, and each result carries the whole updated document back so the
 * editor can adopt it — into its undo history, unsaved, exactly as if the admin
 * had typed the change. Publishing stays a human button.
 */

export interface PaywallAgentContext {
  paywallName: string;
  spec: PaywallSpec;
  /** The products the editor is previewing with, so the copy can name real plans. */
  products?: Pick<ResolvedProduct, "name" | "priceLabel" | "periodLabel" | "planGroup" | "trialDays">[];
}

/**
 * Every prop any node accepts, all optional, so `updateNode` can take a plain
 * object without a record type (the AI SDK drops record value schemas). A key
 * two nodes define differently — `alignment` on a VStack versus a Text — is
 * offered as the union; the real node type is enforced when the result is
 * validated.
 */
function flatPropsSchema() {
  const byKey = new Map<string, z.ZodType[]>();
  for (const type of NODE_TYPES) {
    const shape = (nodeProps[type] as z.ZodObject).shape as Record<string, z.ZodType>;
    for (const [key, schema] of Object.entries(shape)) {
      const list = byKey.get(key) ?? [];
      // Identical schemas across nodes (e.g. `color`) need listing once.
      if (!list.includes(schema)) list.push(schema);
      byKey.set(key, list);
    }
  }
  const fields: Record<string, z.ZodType> = {};
  for (const [key, schemas] of byKey) {
    const base =
      schemas.length === 1
        ? schemas[0]
        : z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    fields[key] = base.optional();
  }
  return z.object(fields).strict();
}

export const paywallToolSchemas = {
  listNodes: z.object({}),
  updateNode: z.object({
    id: z.string().describe("The node to change."),
    props: flatPropsSchema()
      .optional()
      .describe("Props to set. Only the keys given change; others stay."),
    unset: z
      .array(z.string())
      .optional()
      .describe("Prop keys to remove, e.g. [\"maxLines\"]."),
    modifiers: modifiersSchema
      .optional()
      .describe("Modifiers to set; merged with the existing ones."),
  }),
  insertNode: z.object({
    parentId: z.string().describe("A layout node that will hold the new node."),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Position among the parent's children. Omit to append."),
    node: paywallNodeSchema.describe(
      "The node to insert, with a fresh unique id. Layout nodes may include children.",
    ),
  }),
  removeNode: z.object({ id: z.string() }),
  moveNode: z.object({
    id: z.string(),
    parentId: z.string().describe("The layout node to move it into."),
    index: z.number().int().min(0).describe("Position among the new parent's children."),
  }),
  setTheme: z.object({
    theme: themeSchema
      .partial()
      .extend({ colors: themeSchema.shape.colors.partial().optional() })
      .describe("Theme fields to change; omitted fields stay."),
  }),
  replacePaywall: z.object({
    spec: paywallSpecSchema.describe("A complete paywall document."),
  }),
};

type ToolResult =
  | { ok: true; summary: string; spec: PaywallSpec }
  | { ok: false; error: string };

export function buildPaywallTools(initialSpec: PaywallSpec) {
  let working = initialSpec;

  /** Validate a candidate; adopt it only when it passes. */
  const commit = (candidate: unknown, summary: string): ToolResult => {
    const result = validatePaywallSpec(candidate);
    if (!result.ok) return { ok: false, error: result.error };
    working = result.spec;
    return { ok: true, summary, spec: working };
  };

  const attempt = (edit: () => ToolResult): ToolResult => {
    try {
      return edit();
    } catch (error) {
      if (error instanceof PaywallEditError) return { ok: false, error: error.message };
      throw error;
    }
  };

  const tools = {
    listNodes: tool({
      description:
        "List every node as an indented outline with ids, types, and a short label. Call this before editing by id.",
      inputSchema: paywallToolSchemas.listNodes,
      execute: async () => ({
        ok: true,
        nodes: outline(working).map((entry) => ({
          id: entry.id,
          type: entry.type,
          label: entry.label,
          depth: entry.depth,
        })),
      }),
    }),

    updateNode: tool({
      description:
        "Change one node's props or modifiers. Pass only what should change. Use unset to remove a prop.",
      inputSchema: paywallToolSchemas.updateNode,
      execute: async ({ id, props, unset, modifiers }) =>
        attempt(() => {
          const patch: Record<string, unknown> = { ...(props ?? {}) };
          for (const key of unset ?? []) patch[key] = undefined;
          const next = updateNodeProps(working, id, {
            props: Object.keys(patch).length ? patch : undefined,
            modifiers,
          });
          return commit(next, `Updated ${id}`);
        }),
    }),

    insertNode: tool({
      description:
        "Insert a new node (optionally with a subtree) into a layout node at a position. Ids must be new and unique.",
      inputSchema: paywallToolSchemas.insertNode,
      execute: async ({ parentId, index, node }) =>
        attempt(() =>
          commit(insertNode(working, parentId, index, node), `Inserted ${node.type} ${node.id}`),
        ),
    }),

    removeNode: tool({
      description: "Remove a node and everything under it. The root cannot be removed.",
      inputSchema: paywallToolSchemas.removeNode,
      execute: async ({ id }) => attempt(() => commit(removeNode(working, id), `Removed ${id}`)),
    }),

    moveNode: tool({
      description: "Move a node under a different parent, or to a new position among its siblings.",
      inputSchema: paywallToolSchemas.moveNode,
      execute: async ({ id, parentId, index }) =>
        attempt(() => commit(moveNode(working, id, parentId, index), `Moved ${id}`)),
    }),

    setTheme: tool({
      description:
        "Change theme colors, the color scheme, corner radius, or font design. Colors here are hex only.",
      inputSchema: paywallToolSchemas.setTheme,
      execute: async ({ theme }) =>
        commit(
          {
            ...working,
            theme: {
              ...working.theme,
              ...theme,
              colors: { ...working.theme.colors, ...(theme.colors ?? {}) },
            },
          },
          "Updated theme",
        ),
    }),

    replacePaywall: tool({
      description:
        "Replace the entire document. Use only for a redesign from scratch; prefer the smaller tools for edits.",
      inputSchema: paywallToolSchemas.replacePaywall,
      execute: async ({ spec }) => commit(spec, "Replaced the paywall"),
    }),
  };

  return { tools, current: () => working };
}

export function paywallSystemPrompt(context: PaywallAgentContext): string {
  const products = context.products?.length
    ? context.products
        .map(
          (product) =>
            `  - ${product.name}: ${product.priceLabel} ${product.periodLabel}${
              product.trialDays ? `, ${product.trialDays}-day trial` : ""
            } (group ${product.planGroup})`,
        )
        .join("\n")
    : "  (sample products — the real plans are filled in per application)";

  return [
    `You design and edit the paywall template "${context.paywallName}" for mobile apps built with SwiftUI or Jetpack Compose.`,
    "",
    "How to work:",
    "- The document is a tree of nodes. Call `listNodes` first to see ids, then make focused edits with `updateNode`, `insertNode`, `removeNode`, and `moveNode`. Use `replacePaywall` only when asked for a wholesale redesign.",
    "- Every tool returns the full updated document on success, or an error naming the exact problem. When you get an error, fix the call and retry rather than apologising.",
    "- Your edits land in the admin's editor as unsaved changes; they decide when to save or publish. Do not claim anything is saved or live.",
    "- Ids are short and unique, like `hero-title`. Keep existing ids stable so the admin's selection does not jump.",
    "- Only layout nodes (VStack, HStack, ZStack, Grid, List, ScrollView, TabView) hold children. The root must be a layout node — usually a ScrollView wrapping a VStack.",
    "- A TabView shows one child per tab: `tabs[0]` titles the first child, `tabs[1]` the second. Keep the two counts equal — a tab with no child shows an empty page, and a child with no tab is labelled `Tab 3`.",
    "- Colors are hex or a theme token (primary, background, foreground, muted, accent, success, warning, danger). Prefer tokens so a theme change recolours the whole paywall.",
    "- Sizes are in points, as on iOS. Body text is 17pt; keep the CTA at least 48pt tall by giving it padding.",
    "- Icons (`Image.systemName`, `FeatureRow.icon`) are SF Symbol names such as `checkmark.circle.fill`, `bolt.fill`, `infinity`, `lock.open.fill`, `person.2.fill`, `cloud.fill`, `sparkles`, `star.fill`, `gift.fill`, `shield.fill`. Prefer names from the editor's installed SF Symbols catalog; unknown names show a placeholder.",
    "- An Image carries exactly one source: `systemName` for an SF Symbol or `url` for a remote image. A node with neither, or with both, is rejected.",
    "",
    "Paywall craft:",
    "- Structure top to bottom: a hero (icon or image, headline, one-line value statement), three to five FeatureRows of concrete benefits, the ProductList, one primary Button with the purchase action, then fine print, a restorePurchases button, and Terms/Privacy links.",
    "- One primary call to action. Secondary actions (dismiss, restore) are `plain` buttons in the muted color.",
    "- The ProductList shows the plans the application actually sells; do not add fake prices as Text. Use its `highlight` to preselect the plan you want to push, `showSavings` when there is a yearly plan, and `filter.planGroup` to show one group when the app sells add-ons separately.",
    "- To let buyers switch between monthly and yearly, prefer one ProductList with `periodFilter` over one list per period — it needs no TabView and drops periods the app has no plans for. Reach for a TabView when the pages differ by more than the plans, such as a personal tab and a team tab with their own copy.",
    "- Customize the product cards through ProductList props: `highlightBadge` (e.g. Most popular), `sort`, `showDescription`/`showPeriod`/`showSelector`, spacing and corner radius, and the colors (`cardBackground`, `cardBorderColor`, `highlightColor`, `highlightBackground`, `nameColor`, `priceColor`, `detailColor`). Use `overrides`, keyed by plan key, to rename a plan, change its description, give it a badge like Best value, or hide it — never add fake prices as Text.",
    "- Copy is short and specific: benefits, not features; no exclamation marks; sentence case.",
    "- Keep contrast readable in both light and dark schemes if the theme is `system`.",
    "",
    "Products the editor is previewing with:",
    products,
    "",
    "Node catalog (props are TypeScript-style; `?` marks optional):",
    nodeCatalogReference(),
    "",
    "Current document (JSON):",
    JSON.stringify(context.spec),
    "",
    "Be concise. After editing, say in one or two sentences what changed and why; do not paste JSON into the chat.",
  ].join("\n");
}
