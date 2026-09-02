import { looksLikeApiKey } from "./key-format";

export interface RequestCredentials {
  apiKey: string;
  userToken: string | null;
}

/**
 * Split the two credentials a request can carry.
 *
 * Historically `Authorization: Bearer` was an alternate way to send the API
 * key, and server-to-server callers still do that. Publishable keys need both
 * a key and an end-user token at once, so the disambiguation is: when
 * `X-Api-Key` is present the bearer slot belongs to the user token; otherwise
 * a bearer value is read as an API key only if it looks like one.
 *
 * Kept apart from `context.ts` so it can be tested without the database.
 */
export function readRequestCredentials(request: Request): RequestCredentials {
  const explicitKey = request.headers.get("x-api-key")?.trim() ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";

  if (explicitKey) {
    return { apiKey: explicitKey, userToken: bearer || null };
  }
  if (looksLikeApiKey(bearer)) {
    return { apiKey: bearer, userToken: null };
  }
  return { apiKey: "", userToken: bearer || null };
}
