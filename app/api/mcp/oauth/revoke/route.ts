import { revoke } from "@/lib/mcp/oauth";
import { body, failure, preflight, json } from "@/lib/mcp/http";
export const OPTIONS = preflight;
export async function POST(request: Request) {
  try {
    const params = new URLSearchParams(await body(request));
    await revoke(params.get("token") || "", params.get("client_id") || "");
    return json({});
  } catch (e) {
    return failure(e);
  }
}
