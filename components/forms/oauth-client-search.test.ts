import { describe, expect, it } from "vitest";
import type { OAuthClientOption } from "@/lib/console/session";
import { canUseRawClientId, matchOAuthClients } from "./oauth-client-search";

const CLIENTS: OAuthClientOption[] = [
  {
    id: "client_1ce3e6efd6da4214a61df67949a71622",
    name: "Sticker Factory iOS",
    clientType: "public",
    isFirstParty: true,
  },
  {
    id: "client_web_9f2",
    name: "Sticker Factory Web",
    clientType: "confidential",
    isFirstParty: true,
  },
  {
    id: "client_partner_44a",
    name: "Partner Portal",
    clientType: "confidential",
    isFirstParty: false,
  },
];

const ids = (clients: OAuthClientOption[]) => clients.map((client) => client.id);

describe("matchOAuthClients", () => {
  it("offers everything when nothing has been typed", () => {
    expect(matchOAuthClients(CLIENTS, "", [])).toHaveLength(3);
  });

  it("matches on the app name, which is what an admin actually knows", () => {
    expect(ids(matchOAuthClients(CLIENTS, "sticker", []))).toEqual([
      "client_1ce3e6efd6da4214a61df67949a71622",
      "client_web_9f2",
    ]);
  });

  it("matches on a pasted client id, whole or partial", () => {
    expect(ids(matchOAuthClients(CLIENTS, "client_web_9f2", []))).toEqual([
      "client_web_9f2",
    ]);
    expect(ids(matchOAuthClients(CLIENTS, "1ce3e6", []))).toEqual([
      "client_1ce3e6efd6da4214a61df67949a71622",
    ]);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(ids(matchOAuthClients(CLIENTS, "  PARTNER  ", []))).toEqual([
      "client_partner_44a",
    ]);
  });

  it("drops clients that are already selected", () => {
    expect(ids(matchOAuthClients(CLIENTS, "sticker", ["client_web_9f2"]))).toEqual([
      "client_1ce3e6efd6da4214a61df67949a71622",
    ]);
  });

  it("returns nothing rather than everything when a query matches no client", () => {
    expect(matchOAuthClients(CLIENTS, "nonexistent", [])).toEqual([]);
  });
});

describe("canUseRawClientId", () => {
  it("offers a typed id that matches no known client", () => {
    expect(canUseRawClientId(CLIENTS, "client_invisible_to_me", [])).toBe(true);
  });

  it("does not compete with a client already on the list", () => {
    expect(canUseRawClientId(CLIENTS, "client_web_9f2", [])).toBe(false);
  });

  it("does not offer a duplicate of something already selected", () => {
    expect(canUseRawClientId(CLIENTS, "client_invisible_to_me", ["client_invisible_to_me"]))
      .toBe(false);
  });

  it("stays quiet for an empty or whitespace-only query", () => {
    expect(canUseRawClientId(CLIENTS, "", [])).toBe(false);
    expect(canUseRawClientId(CLIENTS, "   ", [])).toBe(false);
  });

  it("is offered alongside a partial match, since a prefix is not a choice", () => {
    // "client_" narrows the list but is not itself any client's id, so both the
    // matches and the escape hatch are on offer.
    expect(matchOAuthClients(CLIENTS, "client_", []).length).toBe(3);
    expect(canUseRawClientId(CLIENTS, "client_", [])).toBe(true);
  });
});
