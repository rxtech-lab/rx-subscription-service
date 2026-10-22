import "server-only";
import {
  createHash,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbExecutor } from "@/lib/db";
import {
  mcpClients,
  mcpCredentials,
  mcpGrants,
  type McpGrant,
} from "@/lib/db/schema";
import { parseScopes, SCOPE_LABELS } from "./scopes";

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const challenge = (v: string) =>
  createHash("sha256").update(v).digest("base64url");
const secret = () => randomBytes(32).toString("base64url");
export function origin() {
  const url = new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("MCP requires HTTPS");
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.NEXT_PUBLIC_SITE_URL
  )
    throw new Error("NEXT_PUBLIC_SITE_URL is required for MCP");
  return url.origin;
}
export const resource = () => `${origin()}/api/mcp`;
function key() {
  if (!process.env.AUTH_SECRET)
    throw new Error("AUTH_SECRET is required for MCP");
  return createHash("sha256")
    .update(`mcp-delegation:${process.env.AUTH_SECRET}`)
    .digest();
}
export function seal(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function unseal(value: string) {
  const bytes = Buffer.from(value, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function validRedirect(value: string) {
  try {
    const u = new URL(value);
    if (u.hash || u.username || u.password) return false;
    return (
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) ||
      /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/.test(u.protocol)
    );
  } catch {
    return false;
  }
}
export async function registerClient(input: unknown) {
  const parsed = z
    .object({
      client_name: z.string().trim().min(1).max(100).default("MCP client"),
      redirect_uris: z
        .array(z.string().max(2048).refine(validRedirect))
        .min(1)
        .max(10),
      token_endpoint_auth_method: z.literal("none").optional(),
      grant_types: z
        .array(z.enum(["authorization_code", "refresh_token"]))
        .refine((v) => v.includes("authorization_code"))
        .optional(),
      response_types: z.array(z.literal("code")).length(1).optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    throw new OAuthError(
      "invalid_client_metadata",
      "Invalid client metadata or redirect URI",
    );
  // Serialize anonymous registrations across instances to enforce a global write cap.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(75231201)`);
    const [recent] = await tx
      .select({ n: count() })
      .from(mcpClients)
      .where(gt(mcpClients.createdAt, new Date(Date.now() - 60000)));
    if (recent.n >= 30)
      throw new OAuthError(
        "temporarily_unavailable",
        "Try registration again later",
        429,
      );
    const id = randomUUID();
    await tx
      .insert(mcpClients)
      .values({
        id,
        name: parsed.data.client_name,
        redirectUris: parsed.data.redirect_uris,
        createdAt: new Date(),
      });
    return {
      client_id: id,
      ...parsed.data,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  });
}
export async function validateAuthorization(params: URLSearchParams) {
  const [client] = await db
    .select()
    .from(mcpClients)
    .where(eq(mcpClients.id, params.get("client_id") || ""));
  const redirectUri = params.get("redirect_uri") || "";
  if (!client || !client.redirectUris.includes(redirectUri))
    throw new OAuthError("invalid_request", "Unknown client or redirect URI");
  if (
    params.get("response_type") !== "code" ||
    params.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") || "")
  )
    throw new OAuthError(
      "invalid_request",
      "Authorization code with S256 PKCE is required",
    );
  if (params.get("resource") !== resource())
    throw new OAuthError(
      "invalid_target",
      "Use the canonical MCP resource URL",
    );
  let scopes: string[];
  try {
    scopes = parseScopes(params.get("scope"));
  } catch {
    throw new OAuthError("invalid_scope", "Unsupported scope");
  }
  return {
    client,
    redirectUri,
    scopes,
    challenge: params.get("code_challenge")!,
    state: params.get("state"),
  };
}
export async function authorize(
  params: URLSearchParams,
  userId: string,
  upstreamToken: string,
  scopes: string[],
  applicationIds: string[],
) {
  const request = await validateAuthorization(params);
  if (scopes.length === 0 || scopes.some((s) => !request.scopes.includes(s)))
    throw new OAuthError("invalid_scope", "Choose requested scopes only");
  const code = secret(),
    now = new Date(),
    grantId = randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .insert(mcpGrants)
      .values({
        id: grantId,
        userId,
        clientId: request.client.id,
        resource: resource(),
        scopes,
        applicationIds,
        upstreamToken: seal(upstreamToken),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 86400000),
      });
    await tx
      .insert(mcpCredentials)
      .values({
        hash: digest(code),
        kind: "code",
        grantId,
        redirectUri: request.redirectUri,
        challenge: request.challenge,
        expiresAt: new Date(now.getTime() + 60000),
      });
  });
  return code;
}
async function issue(tx: DbExecutor, grant: McpGrant) {
  const access = secret(),
    refresh = secret();
  await tx.insert(mcpCredentials).values([
    {
      hash: digest(access),
      grantId: grant.id,
      kind: "access",
      expiresAt: new Date(
        Math.min(Date.now() + 3600000, grant.expiresAt.getTime()),
      ),
    },
    {
      hash: digest(refresh),
      grantId: grant.id,
      kind: "refresh",
      expiresAt: grant.expiresAt,
    },
  ]);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: Math.max(
      0,
      Math.min(
        3600,
        Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000),
      ),
    ),
    scope: grant.scopes.join(" "),
  };
}
export async function exchange(params: URLSearchParams) {
  const kind =
    params.get("grant_type") === "authorization_code"
      ? "code"
      : params.get("grant_type") === "refresh_token"
        ? "refresh"
        : null;
  if (!kind)
    throw new OAuthError("unsupported_grant_type", "Unsupported grant type");
  if (params.get("resource") !== resource())
    throw new OAuthError("invalid_target", "Use the canonical resource URL");
  const value = params.get(kind === "code" ? "code" : "refresh_token") || "";
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ credential: mcpCredentials, grant: mcpGrants })
      .from(mcpCredentials)
      .innerJoin(mcpGrants, eq(mcpCredentials.grantId, mcpGrants.id))
      .where(
        and(
          eq(mcpCredentials.hash, digest(value)),
          eq(mcpCredentials.kind, kind),
        ),
      )
      .for("update");
    if (
      !row ||
      row.grant.clientId !== params.get("client_id") ||
      row.grant.resource !== resource() ||
      row.grant.revokedAt ||
      row.grant.expiresAt <= new Date() ||
      row.credential.expiresAt <= new Date()
    )
      return null;
    if (
      kind === "code" &&
      (row.credential.redirectUri !== params.get("redirect_uri") ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(params.get("code_verifier") || "") ||
        challenge(params.get("code_verifier")!) !== row.credential.challenge)
    )
      return null;
    if (row.credential.usedAt) {
      await tx
        .update(mcpGrants)
        .set({ revokedAt: new Date() })
        .where(eq(mcpGrants.id, row.grant.id));
      return null; // Commit replay revocation before returning an error.
    }
    if (
      params.has("scope") &&
      params.get("scope") !== row.grant.scopes.join(" ")
    )
      throw new OAuthError(
        "invalid_scope",
        "Manage scopes in dashboard Settings",
      );
    await tx
      .update(mcpCredentials)
      .set({ usedAt: new Date() })
      .where(eq(mcpCredentials.hash, row.credential.hash));
    return issue(tx, row.grant);
  });
  if (!outcome)
    throw new OAuthError(
      "invalid_grant",
      "Expired, invalid or reused credential; reconnect if needed",
    );
  return outcome;
}
export async function revoke(token: string, clientId: string) {
  const [row] = await db
    .select({ grant: mcpGrants })
    .from(mcpCredentials)
    .innerJoin(mcpGrants, eq(mcpGrants.id, mcpCredentials.grantId))
    .where(
      and(
        eq(mcpCredentials.hash, digest(token)),
        eq(mcpGrants.clientId, clientId),
      ),
    );
  if (row)
    await db
      .update(mcpGrants)
      .set({ revokedAt: new Date() })
      .where(eq(mcpGrants.id, row.grant.id));
}
export async function authenticate(token: string): Promise<McpGrant | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({ grant: mcpGrants })
    .from(mcpCredentials)
    .innerJoin(mcpGrants, eq(mcpGrants.id, mcpCredentials.grantId))
    .where(
      and(
        eq(mcpCredentials.hash, digest(token)),
        eq(mcpCredentials.kind, "access"),
        gt(mcpCredentials.expiresAt, new Date()),
        gt(mcpGrants.expiresAt, new Date()),
        isNull(mcpGrants.revokedAt),
        eq(mcpGrants.resource, resource()),
      ),
    );
  return row?.grant ?? null;
}
export function metadata() {
  return {
    issuer: origin(),
    authorization_endpoint: `${origin()}/oauth/authorize`,
    token_endpoint: `${origin()}/api/mcp/oauth/token`,
    registration_endpoint: `${origin()}/api/mcp/oauth/register`,
    revocation_endpoint: `${origin()}/api/mcp/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: Object.keys(SCOPE_LABELS),
    authorization_response_iss_parameter_supported: true,
  };
}
