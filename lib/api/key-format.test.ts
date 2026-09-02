import { describe, expect, it } from "vitest";
import { isTestApiEnvironment } from "@/lib/db/schema";
import { apiKeySecretPrefix, isApiKeyKind, parseAllowedClientIds } from "./key-format";

describe("apiKeySecretPrefix", () => {
  it("keeps the existing shape for secret keys so old credentials still resolve", () => {
    expect(apiKeySecretPrefix("xcode")).toBe("rxs_xcode_");
    expect(apiKeySecretPrefix("sandbox")).toBe("rxs_sandbox_");
    expect(apiKeySecretPrefix("production")).toBe("rxs_production_");
    expect(apiKeySecretPrefix("production", "secret")).toBe("rxs_production_");
  });

  it("marks publishable keys so a leaked one is recognisable on sight", () => {
    expect(apiKeySecretPrefix("xcode", "publishable")).toBe("rxs_pk_xcode_");
    expect(apiKeySecretPrefix("sandbox", "publishable")).toBe("rxs_pk_sandbox_");
    expect(apiKeySecretPrefix("production", "publishable")).toBe("rxs_pk_production_");
  });

  it("still starts with rxs_, which is what the bearer disambiguation keys off", () => {
    expect(apiKeySecretPrefix("sandbox", "publishable").startsWith("rxs_")).toBe(true);
  });
});

describe("API environments", () => {
  it("treats Xcode and sandbox as test data planes", () => {
    expect(isTestApiEnvironment("xcode")).toBe(true);
    expect(isTestApiEnvironment("sandbox")).toBe(true);
    expect(isTestApiEnvironment("production")).toBe(false);
  });
});

describe("isApiKeyKind", () => {
  it("accepts the two kinds and nothing else", () => {
    expect(isApiKeyKind("secret")).toBe(true);
    expect(isApiKeyKind("publishable")).toBe(true);
    expect(isApiKeyKind("admin")).toBe(false);
    expect(isApiKeyKind("")).toBe(false);
  });
});

describe("parseAllowedClientIds", () => {
  it("reads a stored list", () => {
    expect(parseAllowedClientIds('["client_a","client_b"]')).toEqual([
      "client_a",
      "client_b",
    ]);
  });

  it("grants nothing for a secret key's null column", () => {
    expect(parseAllowedClientIds(null)).toEqual([]);
  });

  it("grants nothing rather than throwing on a corrupt value", () => {
    expect(parseAllowedClientIds("not json")).toEqual([]);
    expect(parseAllowedClientIds('{"client":"a"}')).toEqual([]);
  });

  it("drops non-string and empty entries", () => {
    expect(parseAllowedClientIds('["client_a", 42, "", null]')).toEqual(["client_a"]);
  });
});
