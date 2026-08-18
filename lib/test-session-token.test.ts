import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { signTestSessionToken, verifyTestSessionToken } from "./test-session-token";

const PREVIOUS = process.env.AUTH_SECRET;
const SECRET = "test-secret-for-unit-tests";

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
});
afterAll(() => {
  process.env.AUTH_SECRET = PREVIOUS;
});

const claims = { applicationId: "app_1", appUserId: "user_1" };
const key = () => new TextEncoder().encode(SECRET);

describe("test session token", () => {
  it("round-trips the application and user it names", async () => {
    const token = await signTestSessionToken(claims);
    expect(await verifyTestSessionToken(token)).toEqual(claims);
  });

  it("rejects a tampered payload", async () => {
    const token = await signTestSessionToken(claims);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ applicationId: "app_other", sub: "user_other" }),
    ).toString("base64url");
    expect(await verifyTestSessionToken(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const foreign = await new SignJWT({ applicationId: "app_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user_1")
      .setIssuer("rx-subscription")
      .setAudience("test-storefront")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret"));
    expect(await verifyTestSessionToken(foreign)).toBeNull();
  });

  it("rejects a token minted for a different audience", async () => {
    // An admin session token must not double as a storefront credential.
    const wrongAudience = await new SignJWT({ applicationId: "app_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user_1")
      .setIssuer("rx-subscription")
      .setAudience("console")
      .setExpirationTime("1h")
      .sign(key());
    expect(await verifyTestSessionToken(wrongAudience)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ applicationId: "app_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user_1")
      .setIssuer("rx-subscription")
      .setAudience("test-storefront")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key());
    expect(await verifyTestSessionToken(expired)).toBeNull();
  });

  it("rejects a token with no user subject", async () => {
    const noSubject = await new SignJWT({ applicationId: "app_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("rx-subscription")
      .setAudience("test-storefront")
      .setExpirationTime("1h")
      .sign(key());
    expect(await verifyTestSessionToken(noSubject)).toBeNull();
  });
});
