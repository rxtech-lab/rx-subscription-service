import { jwtVerify, SignJWT } from "jose";

/**
 * Sign and verify the storefront's browser session.
 *
 * Kept free of `server-only` and of any database import so the token rules —
 * the ones deciding whether a cookie is honoured — are unit-testable. Note that
 * a valid token is necessary but not sufficient: `readTestSession` still
 * re-loads the user and re-asserts that it is a test user on every request.
 */
export const TEST_SESSION_COOKIE = "rx_test_session";
export const TEST_SESSION_COOKIE_PATH = "/test";
export const TEST_SESSION_TTL_SECONDS = 8 * 60 * 60;

const ISSUER = "rx-subscription";
const AUDIENCE = "test-storefront";

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new Error("AUTH_SECRET_NOT_CONFIGURED");
  return new TextEncoder().encode(value);
}

export interface TestSessionClaims {
  applicationId: string;
  appUserId: string;
}

export async function signTestSessionToken(
  claims: TestSessionClaims,
): Promise<string> {
  return new SignJWT({ applicationId: claims.applicationId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.appUserId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TEST_SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

/** Returns null for anything unusable — expired, tampered, or foreign. */
export async function verifyTestSessionToken(
  token: string,
): Promise<TestSessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.applicationId !== "string" || typeof payload.sub !== "string") {
      return null;
    }
    return { applicationId: payload.applicationId, appUserId: payload.sub };
  } catch {
    return null;
  }
}
