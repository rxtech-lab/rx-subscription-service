import { OAuthError, origin } from "./oauth";
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
  "Cache-Control": "no-store",
};
export const preflight = () =>
  new Response(null, { status: 204, headers: cors });
export function json(value: unknown, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { ...cors, ...headers } });
}
export function checkOrigin(request: Request) {
  const supplied = request.headers.get("origin");
  if (supplied && supplied !== origin())
    throw new OAuthError("access_denied", "Untrusted request origin", 403);
}
export async function body(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 1024 * 1024) {
      await reader.cancel();
      throw new OAuthError("invalid_request", "Request is too large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function failure(error: unknown) {
  return error instanceof OAuthError
    ? json(
        { error: error.code, error_description: error.message },
        error.status,
      )
    : json(
        {
          error: "server_error",
          error_description: "The request could not be completed",
        },
        500,
      );
}
