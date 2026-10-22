import { metadata } from "@/lib/mcp/oauth";
import { json, preflight } from "@/lib/mcp/http";
export const OPTIONS = preflight;
export function GET() {
  return json(metadata());
}
