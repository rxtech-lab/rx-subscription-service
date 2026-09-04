import { afterEach, describe, expect, it, vi } from "vitest";
import {
  indexRxLabUsers,
  listAllRxLabUsersForDisplay,
  resolveUserDisplayIdentity,
  type RxLabUserSummary,
} from "./users";

const originalAuthIssuer = process.env.AUTH_ISSUER;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAuthIssuer === undefined) delete process.env.AUTH_ISSUER;
  else process.env.AUTH_ISSUER = originalAuthIssuer;
});

const directoryUser: RxLabUserSummary = {
  id: "auth-user",
  sub: "auth-user",
  name: "Current Name",
  email: "current@example.test",
  image: null,
};

describe("resolveUserDisplayIdentity", () => {
  it("uses RxLab Auth instead of stale local profile fields", () => {
    const identity = resolveUserDisplayIdentity(
      {
        rxlabUserId: "auth-user",
        displayName: "Old Name",
        email: "old@example.test",
      },
      indexRxLabUsers([directoryUser]),
    );

    expect(identity).toEqual({
      name: "Current Name",
      email: "current@example.test",
      image: null,
    });
  });

  it("does not show cached identity fields when a real user is missing", () => {
    expect(
      resolveUserDisplayIdentity(
        {
          rxlabUserId: "deleted-user",
          displayName: "Stale Name",
          email: "stale@example.test",
        },
        new Map(),
      ),
    ).toEqual({ name: null, email: null, image: null });
  });

  it("keeps local identity fields for synthetic test users", () => {
    expect(
      resolveUserDisplayIdentity(
        {
          rxlabUserId: "test:123",
          displayName: "Test User",
          email: "test@example.test",
        },
        new Map(),
      ),
    ).toEqual({
      name: "Test User",
      email: "test@example.test",
      image: null,
    });
  });
});

describe("listAllRxLabUsersForDisplay", () => {
  it("loads display identities from the RxLab Auth admin API in one page", async () => {
    process.env.AUTH_ISSUER = "https://auth.example.test/oauth";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://auth.example.test/api/admin/users?page=1&pageSize=100",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer admin-token",
      );
      return Response.json({
        users: [directoryUser],
        pagination: { page: 1, pageSize: 100, totalCount: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAllRxLabUsersForDisplay("admin-token")).resolves.toEqual([
      directoryUser,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
