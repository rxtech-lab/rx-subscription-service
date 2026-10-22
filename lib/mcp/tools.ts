import "server-only";
import { z } from "zod";
import { buildTools } from "@/lib/ai/tools";
import { writeToolSchemas } from "@/lib/ai/tool-schemas";
import { listAllOAuthClients } from "@/lib/rxlab/oauth-clients";
import { type McpGrant } from "@/lib/db/schema";
import {
  createPaywall,
  listPaywalls,
  requirePaywall,
  saveDraft,
} from "@/lib/paywall/paywalls";
import { paywallSpecSchema } from "@/lib/paywall/schema";
import { requirePlan } from "@/lib/subscription/plans";
import { unseal, OAuthError } from "./oauth";
import { revalidatePath } from "next/cache";

type Definition = {
  description?: string;
  inputSchema: z.ZodType;
  execute: (
    input: never,
    options: { toolCallId: string; messages: [] },
  ) => unknown;
};
const omitted = new Set(["renderUI", "confirmation"]);
function agentTools(applicationId: string, userId: string) {
  return buildTools(applicationId, {
    type: "ai",
    id: userId,
  }) as unknown as Record<string, Definition>;
}
const extras = {
  listProjects: {
    scope: "projects:read",
    description:
      "List projects approved for this connection that you currently have permission to manage.",
    schema: z.object({}),
  },
  listPaywalls: {
    scope: "paywalls:read",
    description: "List shared console-wide paywall templates.",
    schema: z.object({}),
  },
  getPaywall: {
    scope: "paywalls:read",
    description:
      "Read a shared paywall, including its draft specification, before editing it.",
    schema: z.object({ paywallId: z.string().min(1) }),
  },
  createPaywall: {
    scope: "paywalls:write",
    description:
      "Create a shared paywall template. Obtain user approval first. Does not publish or assign it.",
    schema: z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(2000).optional(),
      template: z.string().default("classic"),
      confirmed: z.literal(true),
    }),
  },
  updatePaywall: {
    scope: "paywalls:write",
    description:
      "Save a validated draft of a shared paywall. Obtain user approval first. Does not publish it.",
    schema: z.object({
      paywallId: z.string().min(1),
      spec: paywallSpecSchema,
      confirmed: z.literal(true),
    }),
  },
};
export function toolCatalog(grant: McpGrant) {
  const tools = Object.entries(agentTools("", grant.userId))
    .filter(([name]) => !omitted.has(name))
    .map(([name, definition]) => {
      const write = Object.hasOwn(writeToolSchemas, name);
      const scope = write ? "subscriptions:write" : "subscriptions:read";
      const schema = z.object({
        applicationId: z.string().min(1),
        input: definition.inputSchema,
        ...(write
          ? {
              confirmed: z
                .literal(true)
                .describe(
                  "Set only after the user approves this specific action",
                ),
            }
          : {}),
      });
      return {
        name,
        description: definition.description,
        scope,
        schema,
        write,
      };
    });
  const all = [
    ...tools,
    ...Object.entries(extras).map(([name, t]) => ({
      name,
      ...t,
      write: t.scope.endsWith(":write"),
    })),
  ];
  return all
    .filter((t) => grant.scopes.includes(t.scope))
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.schema, { io: "input" }),
      annotations: {
        readOnlyHint: !t.write,
        destructiveHint: t.write,
        openWorldHint: true,
      },
    }));
}
export async function callTool(grant: McpGrant, name: string, args: unknown) {
  const extra = Object.hasOwn(extras, name)
    ? extras[name as keyof typeof extras]
    : null;
  const definition = agentTools("", grant.userId)[name];
  const write = Object.hasOwn(writeToolSchemas, name);
  if (!extra && (!definition || omitted.has(name)))
    throw new OAuthError("invalid_request", "Unknown tool");
  const scope =
    extra?.scope ?? (write ? "subscriptions:write" : "subscriptions:read");
  if (!grant.scopes.includes(scope))
    throw new OAuthError("insufficient_scope", `Requires ${scope}`, 403);
  let clients;
  try {
    clients = await listAllOAuthClients(unseal(grant.upstreamToken));
  } catch {
    throw new OAuthError(
      "access_denied",
      "Unable to verify RxLab permissions. Reconnect your client if your login expired.",
      403,
    );
  }
  const allowed = clients.filter(
    (c) =>
      c.id !== process.env.AUTH_CLIENT_ID &&
      grant.applicationIds.includes(c.id),
  );
  const actor = { type: "ai" as const, id: grant.userId };
  if (extra) {
    const input = extra.schema.parse(args ?? {});
    switch (name) {
      case "listProjects":
        return allowed.map(({ id, name, description }) => ({
          id,
          name,
          description,
        }));
      case "listPaywalls":
        return listPaywalls();
      case "getPaywall":
        return requirePaywall(extras.getPaywall.schema.parse(input).paywallId);
      case "createPaywall": {
        const data = extras.createPaywall.schema.parse(input);
        const result = await createPaywall({ ...data, actor });
        revalidatePath("/paywalls");
        return result;
      }
      case "updatePaywall": {
        const data = extras.updatePaywall.schema.parse(input);
        const result = await saveDraft({ ...data, actor });
        revalidatePath(`/paywalls/${data.paywallId}`);
        revalidatePath("/paywalls");
        return result;
      }
    }
  }
  const envelope = z
    .object({
      applicationId: z.string().min(1),
      input: z.unknown(),
      ...(write ? { confirmed: z.literal(true) } : {}),
    })
    .parse(args);
  if (!allowed.some((c) => c.id === envelope.applicationId))
    throw new OAuthError(
      "access_denied",
      "Project is not approved or no longer accessible",
      403,
    );
  const tool = agentTools(envelope.applicationId, grant.userId)[name];
  const input = tool.inputSchema.parse(envelope.input);
  // This legacy read helper takes only a plan ID; enforce the project boundary first.
  if (name === "getPlanEntitlements")
    await requirePlan(
      envelope.applicationId,
      (input as { planId: string }).planId,
    );
  return tool.execute(input as never, {
    toolCallId: crypto.randomUUID(),
    messages: [],
  });
}
