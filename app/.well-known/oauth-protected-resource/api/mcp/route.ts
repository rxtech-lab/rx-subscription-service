import { origin, resource } from "@/lib/mcp/oauth";
import { SCOPE_LABELS } from "@/lib/mcp/scopes";
import { json, preflight } from "@/lib/mcp/http";
export const OPTIONS = preflight;
export function GET() {
  return json({
    resource: resource(),
    resource_name: "RxLab Subscriptions",
    authorization_servers: [origin()],
    scopes_supported: Object.keys(SCOPE_LABELS),
    bearer_methods_supported: ["header"],
  });
}
