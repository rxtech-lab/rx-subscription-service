import { exchange } from "@/lib/mcp/oauth";
import { body, failure, json, preflight } from "@/lib/mcp/http";
export const OPTIONS = preflight;
export async function POST(request: Request) {
  try {
    return json(await exchange(new URLSearchParams(await body(request))));
  } catch (e) {
    return failure(e);
  }
}
