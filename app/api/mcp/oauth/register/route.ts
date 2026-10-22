import { registerClient } from "@/lib/mcp/oauth";
import { body, failure, json, preflight } from "@/lib/mcp/http";
export const OPTIONS = preflight;
export async function POST(request: Request) {
  try {
    let input;
    try {
      input = JSON.parse(await body(request));
    } catch {
      return json({ error: "invalid_client_metadata" }, 400);
    }
    return json(await registerClient(input), 201);
  } catch (e) {
    return failure(e);
  }
}
