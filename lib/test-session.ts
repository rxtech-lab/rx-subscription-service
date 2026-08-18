import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, type AppUser } from "@/lib/db/schema";
import { requireTestUser } from "@/lib/subscription/test-users";
import {
  signTestSessionToken,
  verifyTestSessionToken,
  TEST_SESSION_COOKIE,
  TEST_SESSION_COOKIE_PATH,
  TEST_SESSION_TTL_SECONDS,
} from "./test-session-token";

/**
 * Sign a browser session for the simulated storefront.
 *
 * The platform authenticates console admins and server-to-server API keys, and
 * neither fits a browser acting *as* one user — an API key can address any user
 * in the application. This token names exactly one test user and nothing else.
 */
export async function mintTestSession(input: {
  applicationId: string;
  appUserId: string;
}): Promise<string> {
  return signTestSessionToken(input);
}

export async function setTestSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(TEST_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: TEST_SESSION_COOKIE_PATH,
    maxAge: TEST_SESSION_TTL_SECONDS,
  });
}

export async function clearTestSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(TEST_SESSION_COOKIE, "", {
    path: TEST_SESSION_COOKIE_PATH,
    maxAge: 0,
  });
}

export interface TestSession {
  applicationId: string;
  applicationName: string;
  user: AppUser;
}

/**
 * Resolve the storefront's caller.
 *
 * A valid token is not enough: the user is re-loaded and re-checked as a test
 * user on every request rather than trusted from the claims, so a leaked cookie
 * still cannot reach a real account, and a test user deleted mid-session stops
 * working immediately.
 */
export const readTestSession = cache(async (): Promise<TestSession | null> => {
  const token = (await cookies()).get(TEST_SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyTestSessionToken(token);
  if (!claims) return null;

  try {
    const user = await requireTestUser(claims.applicationId, claims.appUserId);
    const [application] = await db
      .select({ name: applications.name })
      .from(applications)
      .where(eq(applications.id, claims.applicationId))
      .limit(1);
    if (!application) return null;
    return {
      applicationId: claims.applicationId,
      applicationName: application.name,
      user,
    };
  } catch {
    return null;
  }
});

/** Resolve the session for one application, or null if it belongs to another. */
export async function readTestSessionFor(
  applicationId: string,
): Promise<TestSession | null> {
  const session = await readTestSession();
  return session && session.applicationId === applicationId ? session : null;
}
