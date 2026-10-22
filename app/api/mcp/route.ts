import { z } from "zod";
import { authenticate, origin } from "@/lib/mcp/oauth";
import { callTool, toolCatalog } from "@/lib/mcp/tools";
import { body, checkOrigin, failure, json, preflight } from "@/lib/mcp/http";
export const runtime = "nodejs";
export const OPTIONS = preflight;
const envelope = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const grant = await authenticate(
      request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1] ?? "",
    );
    if (!grant)
      return json({ error: "invalid_token" }, 401, {
        "WWW-Authenticate": `Bearer resource_metadata="${origin()}/.well-known/oauth-protected-resource/api/mcp"`,
      });
    let raw;
    try {
      raw = JSON.parse(await body(request));
    } catch {
      return json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        400,
      );
    }
    const parsed = envelope.safeParse(raw);
    if (!parsed.success)
      return json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid request" },
        },
        400,
      );
    const message = parsed.data;
    if (message.id === undefined) return new Response(null, { status: 202 });
    const reply = (result: unknown) =>
      json({ jsonrpc: "2.0", id: message.id, result });
    const error = (code: number, messageText: string) =>
      json({
        jsonrpc: "2.0",
        id: message.id,
        error: { code, message: messageText },
      });
    switch (message.method) {
      case "initialize":
        return reply({
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "rx-subscription", version: "1.0.0" },
          instructions:
            "Obtain user approval before write tools. Only set confirmed after approval. Shared paywall tools edit console-wide templates.",
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: toolCatalog(grant) });
      case "tools/call": {
        const call = z
          .object({
            name: z.string(),
            arguments: z.record(z.string(), z.unknown()).optional(),
          })
          .safeParse(message.params);
        if (!call.success) return error(-32602, "Invalid tool parameters");
        try {
          const result = await callTool(
            grant,
            call.data.name,
            call.data.arguments ?? {},
          );
          return reply({
            content: [{ type: "text", text: JSON.stringify(result) ?? "null" }],
            isError: Boolean(
              result &&
              typeof result === "object" &&
              "ok" in result &&
              result.ok === false,
            ),
          });
        } catch (e) {
          const message =
            e instanceof z.ZodError
              ? "Invalid tool arguments"
              : e instanceof Error &&
                  ["OAuthError", "ValidationError", "NotFoundError"].includes(
                    e.constructor.name,
                  )
                ? e.message
                : "Tool execution failed";
          return reply({
            isError: true,
            content: [{ type: "text", text: message }],
          });
        }
      }
      default:
        return error(-32601, "Method not found");
    }
  } catch (e) {
    return failure(e);
  }
}
export function GET() {
  return json({ error: "SSE is not supported" }, 405, {
    Allow: "POST, OPTIONS",
  });
}
export const DELETE = GET;
