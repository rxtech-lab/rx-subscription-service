import { jwtVerify, SignJWT } from "jose";

/**
 * The credential a running sandbox presents to the control endpoint.
 *
 * It is minted per run and expires with it, and it names both the application
 * and the run. The endpoint re-derives everything it needs from these claims,
 * so a suite cannot widen its own scope by editing the request body — the worst
 * a leaked token allows is more of what that run could already do, until it
 * expires.
 *
 * Kept free of `server-only` and of database imports so the token rules stay
 * unit-testable on their own.
 */

const ISSUER = "rx-subscription";
const AUDIENCE = "test-runner";

/** Long enough for a slow suite, short enough that a leaked token dies quickly. */
export const CONTROL_TOKEN_TTL_SECONDS = 20 * 60;

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new Error("AUTH_SECRET_NOT_CONFIGURED");
  return new TextEncoder().encode(value);
}

export interface ControlTokenClaims {
  applicationId: string;
  runId: string;
}

export async function signControlToken(claims: ControlTokenClaims): Promise<string> {
  return new SignJWT({ applicationId: claims.applicationId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.runId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CONTROL_TOKEN_TTL_SECONDS}s`)
    .sign(secret());
}

/** Returns null for anything unusable — expired, tampered, or foreign. */
export async function verifyControlToken(
  token: string,
): Promise<ControlTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.applicationId !== "string" || typeof payload.sub !== "string") {
      return null;
    }
    return { applicationId: payload.applicationId, runId: payload.sub };
  } catch {
    return null;
  }
}
