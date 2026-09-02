import { describe, expect, it } from "vitest";
import { readRequestCredentials } from "./credentials";

function requestWith(headers: Record<string, string>) {
  return new Request("https://example.test/api/v1/entitlements", { headers });
}

describe("readRequestCredentials", () => {
  it("treats a bare rxs_ bearer as the api key, as server callers have always sent it", () => {
    const credentials = readRequestCredentials(
      requestWith({ authorization: "Bearer rxs_production_abc" }),
    );
    expect(credentials).toEqual({ apiKey: "rxs_production_abc", userToken: null });
  });

  it("reads X-Api-Key on its own", () => {
    const credentials = readRequestCredentials(
      requestWith({ "x-api-key": "rxs_sandbox_abc" }),
    );
    expect(credentials).toEqual({ apiKey: "rxs_sandbox_abc", userToken: null });
  });

  it("hands the bearer slot to the user token once X-Api-Key is present", () => {
    const credentials = readRequestCredentials(
      requestWith({
        "x-api-key": "rxs_pk_sandbox_abc",
        authorization: "Bearer header.payload.signature",
      }),
    );
    expect(credentials).toEqual({
      apiKey: "rxs_pk_sandbox_abc",
      userToken: "header.payload.signature",
    });
  });

  it("never mistakes a user token for an api key", () => {
    const credentials = readRequestCredentials(
      requestWith({ authorization: "Bearer header.payload.signature" }),
    );
    expect(credentials.apiKey).toBe("");
    expect(credentials.userToken).toBe("header.payload.signature");
  });

  it("ignores surrounding whitespace and a lower-case scheme", () => {
    const credentials = readRequestCredentials(
      requestWith({ "x-api-key": "  rxs_pk_sandbox_abc  ", authorization: "bearer  token  " }),
    );
    expect(credentials).toEqual({ apiKey: "rxs_pk_sandbox_abc", userToken: "token" });
  });

  it("reports no credentials at all when neither header is set", () => {
    expect(readRequestCredentials(requestWith({}))).toEqual({
      apiKey: "",
      userToken: null,
    });
  });
});
