import {
  defineCatalog,
  formatSpecIssues,
  validateSpec,
  type Spec,
} from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/**
 * The catalog the assistant may draw from when it wants to *show* something
 * rather than describe it.
 *
 * json-render turns a JSON spec into React, and the catalog is the guardrail:
 * the model can only name components listed here, with props that pass these
 * schemas. Every entry is read-only on purpose — there are no inputs, buttons,
 * or actions, so a generated view can display data but never change it. Writes
 * keep going through the approval-gated write tools.
 *
 * This module is shared by the server (tool input validation, prompt text) and
 * the browser (the component registry), so it must stay free of `server-only`
 * imports.
 */

const chartFormat = z
  .enum(["number", "currency", "percent"])
  .describe("How to format y values and axis ticks. Defaults to number.");

const chartSeries = z
  .array(
    z.object({
      label: z.string().describe("Series name, shown in the legend."),
      points: z
        .array(
          z.object({
            x: z.string().describe("Category or date label, e.g. 2026-08-01."),
            y: z.number(),
          }),
        )
        .describe("Points in x order. Every series should share the same x values."),
    }),
  )
  .describe("One entry per series. Keep it to 4 or fewer.");

const tone = z.enum(["neutral", "success", "warning", "danger", "info"]);

/**
 * Prop schemas, named so the browser registry can infer exactly what each
 * component receives from the same source the server validates against.
 */
export const uiComponentProps = {
  Stack: z.object({
    direction: z.enum(["vertical", "horizontal"]).optional(),
    gap: z.enum(["sm", "md", "lg"]).optional(),
  }),

  Grid: z.object({
    columns: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe("Columns on a wide panel; collapses to one when narrow."),
  }),

  Card: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
  }),

  Heading: z.object({
    text: z.string(),
    level: z.number().int().min(1).max(3).optional(),
  }),

  Text: z.object({
    text: z.string(),
    tone: z.enum(["default", "muted", "strong"]).optional(),
  }),

  Badge: z.object({ text: z.string(), tone: tone.optional() }),

  Metric: z.object({
    label: z.string().describe("Sentence case, no trailing colon."),
    value: z.string().describe("Pre-formatted, e.g. $1,284 or 12.9K."),
    delta: z
      .string()
      .optional()
      .describe("Signed change against a named period, e.g. 12% vs last month."),
    deltaDirection: z.enum(["up", "down", "flat"]).optional(),
    deltaIsGood: z
      .boolean()
      .optional()
      .describe("Whether the direction is good news. Defaults to up being good."),
    hint: z.string().optional(),
  }),

  LineChart: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    series: chartSeries,
    format: chartFormat.optional(),
    currency: z
      .string()
      .optional()
      .describe("ISO code, required when format is currency."),
  }),

  BarChart: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    series: chartSeries,
    orientation: z
      .enum(["vertical", "horizontal"])
      .optional()
      .describe("Use horizontal when category names are long."),
    format: chartFormat.optional(),
    currency: z.string().optional(),
  }),

  Table: z.object({
    title: z.string().optional(),
    columns: z.array(
      z.object({
        label: z.string(),
        align: z.enum(["left", "right"]).optional(),
      }),
    ),
    rows: z
      .array(z.array(z.union([z.string(), z.number()])))
      .describe("Each row has one cell per column, already formatted."),
  }),

  KeyValue: z.object({
    items: z.array(z.object({ label: z.string(), value: z.string() })),
  }),

  Callout: z.object({
    text: z.string(),
    title: z.string().optional(),
    tone: tone.optional(),
  }),

  Divider: z.object({}),
} as const;

export type UiComponentName = keyof typeof uiComponentProps;
export type UiProps<K extends UiComponentName> = z.infer<(typeof uiComponentProps)[K]>;

export const uiCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: uiComponentProps.Stack,
      slots: ["default"],
      description:
        "Lay children out in one direction. The default is a vertical stack.",
      example: { direction: "vertical", gap: "md" },
    },

    Grid: {
      props: uiComponentProps.Grid,
      slots: ["default"],
      description: "A responsive grid, typically holding a row of Metric tiles.",
      example: { columns: 2 },
    },

    Card: {
      props: uiComponentProps.Card,
      slots: ["default"],
      description: "A bordered panel with an optional heading. Group related content.",
      example: { title: "Revenue", description: "Last 30 days" },
    },

    Heading: {
      props: uiComponentProps.Heading,
      slots: [],
      description: "A short section title.",
      example: { text: "Plan mix", level: 2 },
    },

    Text: {
      props: uiComponentProps.Text,
      slots: [],
      description:
        "A paragraph of plain text. Keep prose in chat; use this for captions.",
      example: { text: "Excludes test users.", tone: "muted" },
    },

    Badge: {
      props: uiComponentProps.Badge,
      slots: [],
      description: "A small status pill, such as a subscription status.",
      example: { text: "active", tone: "success" },
    },

    Metric: {
      props: uiComponentProps.Metric,
      slots: [],
      description:
        "A stat tile for one headline number. Use this instead of a one-bar chart.",
      example: { label: "Monthly recurring revenue", value: "$4,210" },
    },

    LineChart: {
      props: uiComponentProps.LineChart,
      slots: [],
      description:
        "Trend over time. Prefer this whenever the x axis is a date. Pass whole series, not one point.",
      example: {
        title: "Active subscriptions",
        series: [
          {
            label: "Active",
            points: [
              { x: "2026-08-01", y: 12 },
              { x: "2026-08-02", y: 14 },
            ],
          },
        ],
      },
    },

    BarChart: {
      props: uiComponentProps.BarChart,
      slots: [],
      description:
        "Compare magnitude across categories, such as revenue per plan. One series unless the comparison is the point.",
      example: {
        title: "Revenue by plan",
        orientation: "horizontal",
        format: "currency",
        currency: "usd",
        series: [
          {
            label: "Revenue",
            points: [
              { x: "Pro", y: 42000 },
              { x: "Starter", y: 18000 },
            ],
          },
        ],
      },
    },

    Table: {
      props: uiComponentProps.Table,
      slots: [],
      description:
        "Rows of records or the table view behind a chart. Use it past about seven categories.",
      example: {
        columns: [{ label: "Plan" }, { label: "Subscribers", align: "right" }],
        rows: [
          ["Pro", 12],
          ["Starter", 40],
        ],
      },
    },

    KeyValue: {
      props: uiComponentProps.KeyValue,
      slots: [],
      description: "A compact label/value list for the details of a single record.",
      example: { items: [{ label: "Interval", value: "month" }] },
    },

    Callout: {
      props: uiComponentProps.Callout,
      slots: [],
      description: "A highlighted note, such as a caveat about what the data excludes.",
      example: { text: "Test users are excluded.", tone: "info" },
    },

    Divider: {
      props: uiComponentProps.Divider,
      slots: [],
      description: "A hairline rule between sections.",
      example: {},
    },
  },
  // The catalog deliberately declares no actions: a generated view is a
  // read-only display, never a control surface.
  actions: {},
});

/**
 * The spec shape the model must produce.
 *
 * Two deliberate departures from json-render's own spec type:
 *
 * - Elements are a **list** with a `key` field rather than a keyed record. The
 *   AI SDK's tool-schema conversion drops the value schema of a Zod record and
 *   emits `additionalProperties: false`, which would tell the model that no
 *   element may be sent at all. Arrays convert faithfully.
 * - The element is a union discriminated on `type`, so every component's real
 *   prop schema reaches the model and is validated before the call is executed,
 *   instead of props travelling as an opaque object.
 *
 * `validateUiSpec` folds the list back into the record spec the renderer wants.
 */
const elementSchema = z.discriminatedUnion(
  "type",
  Object.entries(uiComponentProps).map(([name, props]) =>
    z.object({
      key: z.string().describe("Short unique id, referenced by a parent's children."),
      type: z.literal(name),
      props,
      children: z
        .array(z.string())
        .default([])
        .describe("Keys of child elements. Empty unless the component holds children."),
    }),
  ) as unknown as [z.ZodObject, ...z.ZodObject[]],
);

export const uiSpecSchema = z.object({
  root: z.string().describe("Key of the outermost element."),
  elements: z
    .array(elementSchema)
    .min(1)
    .describe("Every element in the view, including the root."),
});

export type UiSpecInput = z.infer<typeof uiSpecSchema>;
export type UiSpec = Spec;

/**
 * Check a model-generated spec before anything renders it.
 *
 * `uiSpecSchema` covers the element types and their props; this adds the
 * structural rules a per-element schema cannot see — the root has to exist,
 * child keys have to resolve, and a leaf component may not carry children — and
 * reports the first failure back to the model instead of to React.
 */
export function validateUiSpec(
  input: unknown,
): { ok: true; spec: UiSpec } | { ok: false; error: string } {
  const parsed = uiSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `${issue.path.join(".") || "spec"}: ${issue.message}`
        : "The spec is not a valid element tree.",
    };
  }

  const elements: Spec["elements"] = {};
  // The union is assembled from a generated list, so its parsed member type is
  // wider than the schema guarantees; every element has these four fields.
  const parsedElements = parsed.data.elements as {
    key: string;
    type: string;
    props: Record<string, unknown>;
    children: string[];
  }[];

  for (const element of parsedElements) {
    if (elements[element.key]) {
      return { ok: false, error: `Duplicate element key "${element.key}".` };
    }
    if (!holdsChildren(element.type) && element.children.length) {
      return {
        ok: false,
        error: `${element.key} (${element.type}) cannot hold children.`,
      };
    }
    elements[element.key] = {
      type: element.type,
      props: element.props as Record<string, unknown>,
      children: element.children,
    };
  }

  const spec: Spec = { root: parsed.data.root, elements };
  const structure = validateSpec(spec);
  if (!structure.valid) {
    return {
      ok: false,
      error: formatSpecIssues(
        structure.issues.filter((issue) => issue.severity === "error"),
      ),
    };
  }

  return { ok: true, spec };
}

interface CatalogComponent {
  props: z.ZodType;
  slots?: string[];
  description?: string;
}

function catalogComponents(): Record<string, CatalogComponent> {
  return uiCatalog.data.components as Record<string, CatalogComponent>;
}

function holdsChildren(type: string): boolean {
  return Boolean(catalogComponents()[type]?.slots?.length);
}

export interface JsonSchemaNode {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
}

export function describeNode(node: JsonSchemaNode): string {
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map((value) => JSON.stringify(value)).join("|");
  if (node.anyOf) return node.anyOf.map(describeNode).join("|");
  if (node.oneOf) return node.oneOf.map(describeNode).join(" | ");
  if (node.type === "array") {
    const item = node.items ?? {};
    // `(string|number)[]` — an unparenthesized union would read as an array of
    // the last member only. Only a union itself needs the parentheses.
    const text = describeNode(item);
    return isUnion(item) ? `(${text})[]` : `${text}[]`;
  }
  if (node.type === "object" && node.properties) return describeShape(node);
  return Array.isArray(node.type) ? node.type.join("|") : node.type ?? "any";
}

function isUnion(node: JsonSchemaNode): boolean {
  return (
    (node.enum?.length ?? 0) > 1 ||
    (node.anyOf?.length ?? 0) > 1 ||
    (node.oneOf?.length ?? 0) > 1
  );
}

export function describeShape(node: JsonSchemaNode): string {
  const required = new Set(node.required ?? []);
  const fields = Object.entries(node.properties ?? {}).map(
    ([name, child]) =>
      `${name}${required.has(name) ? "" : "?"}: ${describeNode(child)}`,
  );
  return fields.length ? `{ ${fields.join("; ")} }` : "{}";
}

/**
 * A compact component reference for the system prompt.
 *
 * `catalog.prompt()` documents json-render's streaming JSONL patch protocol,
 * which this integration does not use — the model returns a whole spec as tool
 * input instead. What it does need is the vocabulary, and the prop signatures
 * are derived from the same schemas that validate the result, so the two cannot
 * drift apart.
 */
export function uiCatalogReference(): string {
  return Object.entries(catalogComponents())
    .map(([name, definition]) => {
      const shape = describeShape(
        z.toJSONSchema(definition.props, { io: "input" }) as JsonSchemaNode,
      );
      const container = definition.slots?.length ? " [holds children]" : "";
      return `- ${name}${container} ${shape}\n  ${definition.description ?? ""}`.trimEnd();
    })
    .join("\n");
}
