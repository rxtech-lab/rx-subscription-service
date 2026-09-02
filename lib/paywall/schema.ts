import { z } from "zod";
import { describeShape, type JsonSchemaNode } from "@/lib/ai/ui-catalog";

/**
 * The paywall document.
 *
 * A paywall is a nested tree of layout and content nodes, named after the
 * SwiftUI and Jetpack Compose primitives an app renders it with: a `VStack` is
 * a `VStack` (or a `Column`), a `ScrollView` is a `ScrollView`, and so on. The
 * tree is what the editor edits, what the database stores, and — with product
 * placeholders resolved — what `GET /api/v1/paywall` hands to the app. There
 * is no expression language: a client maps node types to native views, applies
 * the modifiers, and handles five actions.
 *
 * This module is shared by the server (validation, agent tools, export) and
 * the browser (editor, inspector), so it must stay free of `server-only`
 * imports.
 */

export const COLOR_TOKENS = [
  "primary",
  "background",
  "foreground",
  "muted",
  "accent",
  "success",
  "warning",
  "danger",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const colorSchema = z
  .union([z.enum(COLOR_TOKENS), z.string().regex(HEX_COLOR)])
  .describe("A theme token such as primary, or a hex color like #1D4ED8.");

export const actionSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("purchase"),
      productId: z
        .string()
        .optional()
        .describe("A plan id or key. Omit to buy the product the user selected."),
    }),
    z.object({ type: z.literal("restorePurchases") }),
    z.object({ type: z.literal("dismiss") }),
    z.object({ type: z.literal("openUrl"), url: z.string().url() }),
    z.object({ type: z.literal("selectProduct"), productId: z.string() }),
  ])
  .describe("What tapping the control does.");

const edgesSchema = z
  .object({
    top: z.number().min(0).optional(),
    leading: z.number().min(0).optional(),
    bottom: z.number().min(0).optional(),
    trailing: z.number().min(0).optional(),
  })
  .strict();

export const modifiersSchema = z
  .object({
    padding: z
      .union([z.number().min(0), edgesSchema])
      .optional()
      .describe("Points on every edge, or per edge."),
    frame: z
      .object({
        width: z.number().min(0).optional(),
        height: z.number().min(0).optional(),
        maxWidth: z.number().min(0).optional(),
        maxHeight: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
    background: colorSchema.optional(),
    cornerRadius: z.number().min(0).optional(),
    border: z
      .object({ color: colorSchema, width: z.number().min(0) })
      .strict()
      .optional(),
    opacity: z.number().min(0).max(1).optional(),
    hidden: z.boolean().optional(),
  })
  .strict();

export type Modifiers = z.infer<typeof modifiersSchema>;
export type PaywallAction = z.infer<typeof actionSchema>;

export const TEXT_STYLES = [
  "largeTitle",
  "title",
  "title2",
  "title3",
  "headline",
  "body",
  "callout",
  "subheadline",
  "footnote",
  "caption",
] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const BILLING_INTERVAL_OPTIONS = ["month", "quarter", "year", "one_time"] as const;

const zAlignment9 = z.enum([
  "topLeading",
  "top",
  "topTrailing",
  "leading",
  "center",
  "trailing",
  "bottomLeading",
  "bottom",
  "bottomTrailing",
]);

/**
 * Prop schemas, one per node type. The inspector derives its form from these,
 * the agent's tool schemas and prompt reference are derived from these, and
 * every stored spec is validated against these — so they cannot drift apart.
 */
export const nodeProps = {
  VStack: z
    .object({
      spacing: z.number().min(0).optional().describe("Points between children."),
      alignment: z.enum(["leading", "center", "trailing"]).optional(),
    })
    .strict(),
  HStack: z
    .object({
      spacing: z.number().min(0).optional(),
      alignment: z.enum(["top", "center", "bottom"]).optional(),
    })
    .strict(),
  ZStack: z.object({ alignment: zAlignment9.optional() }).strict(),
  Grid: z
    .object({
      columns: z.number().int().min(1).max(4),
      spacing: z.number().min(0).optional(),
    })
    .strict(),
  List: z
    .object({
      spacing: z.number().min(0).optional(),
      showsSeparators: z.boolean().optional(),
    })
    .strict(),
  ScrollView: z
    .object({
      axis: z.enum(["vertical", "horizontal"]).optional(),
      showsIndicators: z.boolean().optional(),
    })
    .strict(),

  Text: z
    .object({
      text: z.string().max(2000),
      style: z.enum(TEXT_STYLES).optional().describe("SwiftUI text style. Defaults to body."),
      weight: z.enum(["regular", "medium", "semibold", "bold"]).optional(),
      color: colorSchema.optional(),
      alignment: z.enum(["leading", "center", "trailing"]).optional(),
      maxLines: z.number().int().min(1).optional(),
    })
    .strict(),
  Image: z
    .object({
      url: z.string().url().optional().describe("A remote image."),
      systemName: z
        .string()
        .max(80)
        .optional()
        .describe("An SF Symbol name, e.g. checkmark.seal.fill."),
      width: z.number().min(0).optional(),
      height: z.number().min(0).optional(),
      contentMode: z.enum(["fit", "fill"]).optional(),
      cornerRadius: z.number().min(0).optional(),
      tint: colorSchema.optional(),
    })
    .strict()
    .refine((value) => Boolean(value.url) !== Boolean(value.systemName), {
      message: "Image needs exactly one of url or systemName",
    }),
  Button: z
    .object({
      label: z.string().max(120),
      action: actionSchema,
      style: z.enum(["filled", "outlined", "plain"]).optional(),
      fullWidth: z.boolean().optional(),
      color: colorSchema.optional(),
    })
    .strict(),
  Spacer: z.object({ minLength: z.number().min(0).optional() }).strict(),
  Divider: z.object({}).strict(),
  Badge: z.object({ text: z.string().max(60), color: colorSchema.optional() }).strict(),
  FeatureRow: z
    .object({
      icon: z.string().max(80).describe("An SF Symbol name, e.g. bolt.fill."),
      title: z.string().max(200),
      subtitle: z.string().max(400).optional(),
    })
    .strict(),
  Link: z.object({ text: z.string().max(200), url: z.string().url() }).strict(),

  ProductList: z
    .object({
      filter: z
        .object({
          planGroup: z.string().optional().describe("Only plans in this group."),
          billingIntervals: z.array(z.enum(BILLING_INTERVAL_OPTIONS)).optional(),
        })
        .strict()
        .optional(),
      sort: z
        .enum(["default", "priceAscending", "priceDescending"])
        .optional()
        .describe("Order of products. Default keeps the console's plan order."),
      layout: z.enum(["vertical", "horizontal"]).optional(),
      style: z.enum(["card", "row"]).optional(),
      highlight: z
        .enum(["none", "first", "cheapest", "longest"])
        .optional()
        .describe("Which product is emphasised and preselected."),
      highlightBadge: z
        .string()
        .max(40)
        .optional()
        .describe("Label shown on the highlighted product, e.g. Most popular."),
      showTrialBadge: z.boolean().optional(),
      showSavings: z.boolean().optional(),
      showDescription: z.boolean().optional().describe("Defaults to true."),
      showPeriod: z.boolean().optional().describe("Show per month / per year. Defaults to true."),
      showSelector: z
        .boolean()
        .optional()
        .describe("Radio indicator on row-style products. Defaults to true."),
      spacing: z.number().min(0).optional().describe("Points between products."),
      cornerRadius: z.number().min(0).optional().describe("Defaults to the theme's corner radius."),
      borderWidth: z.number().min(0).optional(),
      cardBackground: colorSchema.optional(),
      cardBorderColor: colorSchema.optional(),
      highlightColor: colorSchema
        .optional()
        .describe("Border, selector, and badge color of the highlighted product. Defaults to primary."),
      highlightBackground: colorSchema.optional(),
      nameColor: colorSchema.optional(),
      priceColor: colorSchema.optional(),
      detailColor: colorSchema.optional().describe("Period, description, and secondary text. Defaults to muted."),
      overrides: z
        .array(
          z
            .object({
              productKey: z.string().describe("The plan's key, as shown on the Plans page."),
              name: z.string().max(80).optional(),
              description: z.string().max(200).optional(),
              badge: z.string().max(40).optional().describe("A label on this product, e.g. Best value."),
              hidden: z.boolean().optional().describe("Leave this plan out of the list."),
            })
            .strict(),
        )
        .max(20)
        .optional()
        .describe("Per-plan text changes, matched by plan key."),
    })
    .strict(),
} as const;

export type NodeType = keyof typeof nodeProps;
export type NodePropsOf<K extends NodeType> = z.infer<(typeof nodeProps)[K]>;

export const NODE_TYPES = Object.keys(nodeProps) as NodeType[];

export const LAYOUT_TYPES = [
  "VStack",
  "HStack",
  "ZStack",
  "Grid",
  "List",
  "ScrollView",
] as const satisfies readonly NodeType[];

export const NODE_GROUPS: { label: string; types: NodeType[] }[] = [
  { label: "Layout", types: [...LAYOUT_TYPES] },
  { label: "Content", types: ["Text", "Image", "Button", "Badge", "FeatureRow", "Link", "Spacer", "Divider"] },
  { label: "Commerce", types: ["ProductList"] },
];

export function isLayoutType(type: string): type is (typeof LAYOUT_TYPES)[number] {
  return (LAYOUT_TYPES as readonly string[]).includes(type);
}

/**
 * The node as the editor and renderer handle it. Props are loosely typed here
 * because the tree is heterogeneous; `validatePaywallSpec` is what guarantees
 * that a `Text` node's props really are `Text` props.
 */
export interface PaywallNode {
  id: string;
  type: NodeType;
  props: Record<string, unknown>;
  modifiers?: Modifiers;
  children?: PaywallNode[];
}

export const themeSchema = z
  .object({
    colorScheme: z.enum(["system", "light", "dark"]),
    colors: z
      .object({
        primary: z.string().regex(HEX_COLOR),
        background: z.string().regex(HEX_COLOR),
        foreground: z.string().regex(HEX_COLOR),
        muted: z.string().regex(HEX_COLOR),
        accent: z.string().regex(HEX_COLOR),
      })
      .strict(),
    cornerRadius: z.number().min(0),
    fontDesign: z.enum(["default", "rounded", "serif", "monospaced"]),
  })
  .strict();

export type PaywallTheme = z.infer<typeof themeSchema>;

export const PAYWALL_DEVICE_LAYOUT_IDS = ["android", "foldable", "ipad", "macos"] as const;
export type PaywallDeviceLayoutId = (typeof PAYWALL_DEVICE_LAYOUT_IDS)[number];

export interface MaterialYouConfig {
  /** Seed used by Material Color Utilities to derive every Android color role. */
  seedColor: string;
}

export interface PaywallSpec {
  version: 1;
  theme: PaywallTheme;
  /** The iPhone design is the canonical fallback for every device. */
  root: PaywallNode;
  /** Optional roots let each non-iPhone device diverge without duplicating the whole document. */
  deviceLayouts?: Partial<Record<PaywallDeviceLayoutId, PaywallNode>>;
  /** Android and foldable renderers generate Material You colors from this one seed. */
  materialYou?: MaterialYouConfig;
}

const nodeVariants = NODE_TYPES.map((type) => {
  const base = {
    id: z.string().regex(NODE_ID).describe("Unique within the paywall."),
    type: z.literal(type),
    props: nodeProps[type],
    modifiers: modifiersSchema.optional(),
  };
  if (isLayoutType(type)) {
    return z
      .object({
        ...base,
        // Deferred so the union can refer to itself; resolved at parse time.
        children: z
          .array(z.lazy((): z.ZodType<PaywallNode> => paywallNodeSchema))
          .optional(),
      })
      .strict();
  }
  return z.object(base).strict();
});

/** The recursive node schema. Layout nodes hold children; leaves cannot. */
export const paywallNodeSchema: z.ZodType<PaywallNode> = z.discriminatedUnion(
  "type",
  nodeVariants as unknown as [z.ZodObject, ...z.ZodObject[]],
) as unknown as z.ZodType<PaywallNode>;

export const paywallSpecSchema = z
  .object({
    version: z.literal(1),
    theme: themeSchema,
    root: paywallNodeSchema,
    deviceLayouts: z
      .object({
        android: paywallNodeSchema.optional(),
        foldable: paywallNodeSchema.optional(),
        ipad: paywallNodeSchema.optional(),
        macos: paywallNodeSchema.optional(),
      })
      .strict()
      .optional(),
    materialYou: z
      .object({ seedColor: z.string().regex(HEX_COLOR) })
      .strict()
      .optional(),
  })
  .strict();

export const MAX_NODES = 300;
export const MAX_DEPTH = 12;
export const MAX_PRODUCT_LISTS = 3;

export type ValidationResult =
  | { ok: true; spec: PaywallSpec }
  | { ok: false; error: string };

/**
 * Check a paywall before it is stored, rendered, or handed back to the agent.
 *
 * The zod schema covers node types and props. This adds the structural rules a
 * per-node schema cannot see — ids must be unique, the root must be a layout
 * node, the tree must stay a sane size — and reports the first failure as one
 * readable sentence rather than a stack of issues.
 */
export function validatePaywallSpec(input: unknown): ValidationResult {
  const parsed = paywallSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `${issue.path.join(".") || "spec"}: ${issue.message}`
        : "The paywall is not a valid node tree.",
    };
  }

  const spec = parsed.data as PaywallSpec;

  const validateRoot = (root: PaywallNode, path: string): string | null => {
    if (!isLayoutType(root.type)) {
      return `${path}: must be a layout node such as VStack or ScrollView.`;
    }
    const seen = new Set<string>();
    let count = 0;
    let productLists = 0;

    const walk = (node: PaywallNode, depth: number): string | null => {
      if (depth > MAX_DEPTH) return `${node.id}: nested deeper than ${MAX_DEPTH} levels.`;
      if (seen.has(node.id)) return `Duplicate node id "${node.id}".`;
      seen.add(node.id);
      count += 1;
      if (count > MAX_NODES) return `The paywall has more than ${MAX_NODES} nodes.`;
      if (node.type === "ProductList") {
        productLists += 1;
        if (productLists > MAX_PRODUCT_LISTS) {
          return `At most ${MAX_PRODUCT_LISTS} ProductList nodes are allowed.`;
        }
      }
      for (const child of node.children ?? []) {
        const failure = walk(child, depth + 1);
        if (failure) return failure;
      }
      return null;
    };

    return walk(root, 1);
  };

  let failure = validateRoot(spec.root, "root");
  if (!failure) {
    for (const id of PAYWALL_DEVICE_LAYOUT_IDS) {
      const root = spec.deviceLayouts?.[id];
      if (!root) continue;
      failure = validateRoot(root, `deviceLayouts.${id}`);
      if (failure) break;
    }
  }
  if (failure) return { ok: false, error: failure };
  return { ok: true, spec };
}

/** Text style → point size and weight, shared by the web preview and the docs. */
export const TEXT_STYLE_METRICS: Record<TextStyle, { size: number; weight: number; lineHeight: number }> = {
  largeTitle: { size: 34, weight: 700, lineHeight: 41 },
  title: { size: 28, weight: 700, lineHeight: 34 },
  title2: { size: 22, weight: 700, lineHeight: 28 },
  title3: { size: 20, weight: 600, lineHeight: 25 },
  headline: { size: 17, weight: 600, lineHeight: 22 },
  body: { size: 17, weight: 400, lineHeight: 22 },
  callout: { size: 16, weight: 400, lineHeight: 21 },
  subheadline: { size: 15, weight: 400, lineHeight: 20 },
  footnote: { size: 13, weight: 400, lineHeight: 18 },
  caption: { size: 12, weight: 400, lineHeight: 16 },
};

export const NODE_DESCRIPTIONS: Record<NodeType, string> = {
  VStack: "Lay children out top to bottom.",
  HStack: "Lay children out side by side.",
  ZStack: "Layer children on top of each other, for a background image behind text.",
  Grid: "A fixed-column grid, for feature tiles or a plan comparison.",
  List: "A vertical list with optional separators between rows.",
  ScrollView: "Scrollable container. Usually the root, holding one VStack.",
  Text: "A run of text in one SwiftUI text style.",
  Image: "A remote image by url, or a system icon by symbol name.",
  Button: "A tappable control that runs one action.",
  Spacer: "Flexible empty space that pushes siblings apart.",
  Divider: "A hairline rule.",
  Badge: "A small pill, such as MOST POPULAR.",
  FeatureRow: "An icon with a title and optional subtitle — one benefit per row.",
  Link: "Inline text that opens a url, for terms and privacy.",
  ProductList:
    "The purchasable plans, filled in per application at export time. Tapping a product selects it; a Button with the purchase action buys the selection.",
};

/**
 * A compact reference for the agent's system prompt, derived from the same
 * schemas that validate the result so the two cannot drift apart.
 */
export function nodeCatalogReference(): string {
  const lines = NODE_TYPES.map((type) => {
    const shape = describeShape(
      z.toJSONSchema(nodeProps[type], { io: "input" }) as JsonSchemaNode,
    );
    const container = isLayoutType(type) ? " [holds children]" : "";
    return `- ${type}${container} ${shape}\n  ${NODE_DESCRIPTIONS[type]}`;
  });
  const modifiers = describeShape(
    z.toJSONSchema(modifiersSchema, { io: "input" }) as JsonSchemaNode,
  );
  return [
    ...lines,
    "",
    `Every node may also carry \`modifiers\`: ${modifiers}`,
    `Colors are hex (#RRGGBB or #RRGGBBAA) or one of: ${COLOR_TOKENS.join(", ")}.`,
    "The top-level root is the default iPhone design. Optional deviceLayouts.android/foldable/ipad/macos roots customize other devices; omitted layouts inherit iPhone.",
    "Android and foldable colors come from materialYou.seedColor through Material You dynamic color roles.",
    "Actions: {type:purchase, productId?} {type:restorePurchases} {type:dismiss} {type:openUrl, url} {type:selectProduct, productId}.",
  ].join("\n");
}
