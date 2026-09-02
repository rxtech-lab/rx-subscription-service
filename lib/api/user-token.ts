import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { ApiError } from "./errors";

/**
 * The end user a publishable-key request acts for, proven by their rxlab
 * access token rather than asserted by the caller.
 */
export interface UserTokenPrincipal {
  subject: string;
  clientId: string;
  email: string | null;
  displayName: string | null;
}

export interface UserTokenVerifierConfig {
  issuer: string;
  /** OAuth clients whose tokens the presented key accepts. Never empty. */
  allowedClientIds: readonly string[];
  /**
   * Verification key. Left unset in production so the issuer's published JWKS
   * is fetched and cached; tests pass a local key to stay off the network.
   */
  key?: JWTVerifyGetKey | CryptoKey;
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

// `createRemoteJWKSet` caches the fetched keys and honours the issuer's cache
// headers, so it is worth holding one per issuer rather than per request.
const remoteKeys = new Map<string, JWTVerifyGetKey>();

function remoteKeyFor(issuer: string): JWTVerifyGetKey {
  let key = remoteKeys.get(issuer);
  if (!key) {
    key = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    remoteKeys.set(issuer, key);
  }
  return key;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Turn a verified payload into a principal, or reject it.
 *
 * Split out from {@link verifyUserToken} so the claim rules can be tested
 * without minting signatures.
 */
export function principalFromUserTokenPayload(
  payload: JWTPayload,
  allowedClientIds: readonly string[],
): UserTokenPrincipal {
  const subject = optionalString(payload.sub);
  if (!subject) {
    throw new ApiError(401, "invalid_user_token", "The user token is missing a subject");
  }
  const clientId = optionalString(payload.client_id) ?? optionalString(payload.azp);
  if (!clientId) {
    throw new ApiError(401, "invalid_user_token", "The user token is missing a client id");
  }
  if (!allowedClientIds.includes(clientId)) {
    throw new ApiError(
      403,
      "client_not_allowed",
      `OAuth client "${clientId}" is not accepted by this publishable key`,
    );
  }
  return {
    subject,
    clientId,
    email: optionalString(payload.email),
    displayName: optionalString(payload.name) ?? optionalString(payload.preferred_username),
  };
}

/**
 * Verify an end user's rxlab access token.
 *
 * Every failure — bad signature, wrong issuer, expired, missing claim — comes
 * back as `401 invalid_user_token` so the response never tells an attacker
 * which part of their forgery was wrong. The one exception is a well-formed
 * token from an OAuth client this key does not accept, which is a
 * configuration problem worth naming.
 */
export async function verifyUserToken(
  token: string,
  config: UserTokenVerifierConfig,
): Promise<UserTokenPrincipal> {
  const issuer = normalizeIssuer(config.issuer);
  const key = config.key ?? remoteKeyFor(issuer);

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key as JWTVerifyGetKey, {
      issuer,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp"],
    }));
  } catch {
    throw new ApiError(401, "invalid_user_token", "The user token is invalid or expired");
  }

  return principalFromUserTokenPayload(payload, config.allowedClientIds);
}

/** Read the issuer every rxlab user token must come from. */
export function requireUserTokenIssuer(): string {
  const issuer = process.env.AUTH_ISSUER?.trim();
  if (!issuer) {
    throw new ApiError(
      503,
      "user_tokens_not_configured",
      "AUTH_ISSUER must be set before publishable keys can be used",
    );
  }
  return normalizeIssuer(issuer);
}
