import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { principalFromUserTokenPayload, verifyUserToken } from "./user-token";

const ISSUER = "https://auth.rxlab.test";
const IOS_CLIENT = "client_ios";

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

async function sign(
  claims: JWTPayload,
  options: { issuer?: string; expiresIn?: string; algorithm?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: options.algorithm ?? "RS256" })
    .setIssuer(options.issuer ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(privateKey);
}

function verify(token: string, allowedClientIds: string[] = [IOS_CLIENT]) {
  return verifyUserToken(token, { issuer: ISSUER, allowedClientIds, key: publicKey });
}

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    return { status: apiError.status, code: apiError.code };
  }
}

describe("verifyUserToken", () => {
  it("accepts a well-formed token from an allowed client", async () => {
    const token = await sign({
      sub: "user_1",
      client_id: IOS_CLIENT,
      email: "a@example.test",
      name: "Ada",
    });
    await expect(verify(token)).resolves.toEqual({
      subject: "user_1",
      clientId: IOS_CLIENT,
      email: "a@example.test",
      displayName: "Ada",
    });
  });

  it("tolerates a trailing slash on the configured issuer", async () => {
    const token = await sign({ sub: "user_1", client_id: IOS_CLIENT });
    await expect(
      verifyUserToken(token, {
        issuer: `${ISSUER}/`,
        allowedClientIds: [IOS_CLIENT],
        key: publicKey,
      }),
    ).resolves.toMatchObject({ subject: "user_1" });
  });

  it("rejects a token from another issuer", async () => {
    const token = await sign({ sub: "user_1", client_id: IOS_CLIENT }, {
      issuer: "https://evil.test",
    });
    expect(await statusOf(verify(token))).toEqual({
      status: 401,
      code: "invalid_user_token",
    });
  });

  it("rejects an expired token", async () => {
    const token = await sign({ sub: "user_1", client_id: IOS_CLIENT }, {
      expiresIn: "-1m",
    });
    expect(await statusOf(verify(token))).toEqual({
      status: 401,
      code: "invalid_user_token",
    });
  });

  it("rejects a token signed by a different key", async () => {
    const other = await generateKeyPair("RS256", { extractable: true });
    const token = await new SignJWT({ sub: "user_1", client_id: IOS_CLIENT })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);
    expect(await statusOf(verify(token))).toEqual({
      status: 401,
      code: "invalid_user_token",
    });
  });

  it("rejects an unsigned token even though its claims are perfect", async () => {
    // `alg: none` is the classic forgery; jose refuses it, and the failure must
    // look like every other bad token.
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user_1",
        client_id: IOS_CLIENT,
        iss: ISSUER,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString("base64url");
    expect(await statusOf(verify(`${header}.${payload}.`))).toEqual({
      status: 401,
      code: "invalid_user_token",
    });
  });

  it("names the problem when the client is simply not on the key's list", async () => {
    const token = await sign({ sub: "user_1", client_id: "client_web" });
    expect(await statusOf(verify(token))).toEqual({
      status: 403,
      code: "client_not_allowed",
    });
  });
});

describe("principalFromUserTokenPayload", () => {
  it("falls back to azp when the issuer uses that claim", () => {
    expect(
      principalFromUserTokenPayload({ sub: "user_1", azp: IOS_CLIENT }, [IOS_CLIENT]),
    ).toMatchObject({ subject: "user_1", clientId: IOS_CLIENT });
  });

  it("returns null rather than empty strings for a missing profile", () => {
    expect(
      principalFromUserTokenPayload({ sub: "user_1", client_id: IOS_CLIENT }, [IOS_CLIENT]),
    ).toEqual({
      subject: "user_1",
      clientId: IOS_CLIENT,
      email: null,
      displayName: null,
    });
  });

  it("rejects a payload with no subject", () => {
    expect(() =>
      principalFromUserTokenPayload({ client_id: IOS_CLIENT }, [IOS_CLIENT]),
    ).toThrow(/subject/);
  });

  it("rejects a payload with no client id", () => {
    expect(() => principalFromUserTokenPayload({ sub: "user_1" }, [IOS_CLIENT])).toThrow(
      /client id/,
    );
  });

  it("refuses every client when the allow-list is empty", () => {
    expect(() =>
      principalFromUserTokenPayload({ sub: "user_1", client_id: IOS_CLIENT }, []),
    ).toThrow(/not accepted/);
  });
});

describe("key material", () => {
  it("uses an RSA key, matching the algorithms the verifier accepts", async () => {
    await expect(exportJWK(publicKey)).resolves.toMatchObject({ kty: "RSA" });
  });
});
