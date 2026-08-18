import NextAuth, { type NextAuthResult } from "next-auth";
import type { NextMiddleware } from "next/server";
import {
  createRxLabAuth,
  RX_LAB_REFRESH_TOKEN_ERROR,
  type RxLabAuthResult,
} from "@rxtech-lab/authjs-rxlab";

const rxLabConfigured = Boolean(
  process.env.AUTH_ISSUER &&
    process.env.AUTH_CLIENT_ID &&
    process.env.AUTH_CLIENT_SECRET &&
    process.env.AUTH_SECRET,
);

/**
 * Falls back to an empty Auth.js config when RxLab credentials are absent so the
 * app still boots locally (and `/login` explains what is missing) instead of
 * throwing during an OAuth callback.
 */
const authResult = rxLabConfigured
  ? createRxLabAuth({
      issuer: process.env.AUTH_ISSUER!,
      clientId: process.env.AUTH_CLIENT_ID!,
      clientSecret: process.env.AUTH_CLIENT_SECRET!,
      signInPage: "/login",
      trustHost: true,
    })
  : NextAuth({
      providers: [],
      trustHost: true,
      secret:
        process.env.AUTH_SECRET ?? "local-development-only-secret-change-me",
    });

function hasRxLabProxy(result: NextAuthResult): result is RxLabAuthResult {
  return "proxy" in result;
}

const continueRequest: NextMiddleware = () => undefined;

export const { handlers, signIn, signOut, auth } = authResult;
export const proxy =
  hasRxLabProxy(authResult)
    ? authResult.proxy
    : authResult.auth(continueRequest);
export { RX_LAB_REFRESH_TOKEN_ERROR };

export const authStatus = { configured: rxLabConfigured };
