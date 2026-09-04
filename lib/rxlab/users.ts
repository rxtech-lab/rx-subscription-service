import "server-only";
import {
  MAX_PAGE_SIZE,
  RxLabAdminApiError,
  rxLabIssuerOrigin,
} from "./oauth-clients";

export interface RxLabUserSummary {
  id: string;
  sub: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface RxLabUserListResult {
  users: RxLabUserSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface LocalUserIdentity {
  rxlabUserId: string;
  displayName: string | null;
  email: string | null;
}

export interface UserDisplayIdentity {
  name: string | null;
  email: string | null;
  image: string | null;
}

/** Index one directory response once, then reuse it for every row on a page. */
export function indexRxLabUsers(users: RxLabUserSummary[]) {
  return new Map(users.map((user) => [user.sub, user]));
}

/**
 * Resolve display data from RxLab Auth, which owns real-user identity fields.
 * Synthetic test users deliberately have no RxLab Auth record, so their local
 * editable profile remains the source of truth.
 */
export function resolveUserDisplayIdentity(
  user: LocalUserIdentity,
  directory: ReadonlyMap<string, RxLabUserSummary>,
): UserDisplayIdentity {
  const rxLabUser = directory.get(user.rxlabUserId);
  if (rxLabUser) {
    return {
      name: rxLabUser.name,
      email: rxLabUser.email,
      image: rxLabUser.image,
    };
  }
  if (user.rxlabUserId.startsWith("test:")) {
    return {
      name: user.displayName,
      email: user.email,
      image: null,
    };
  }
  return { name: null, email: null, image: null };
}

/** Load the directory for display without making the whole console unavailable. */
export async function listAllRxLabUsersForDisplay(
  accessToken: string,
): Promise<RxLabUserSummary[]> {
  try {
    return await listAllRxLabUsers(accessToken);
  } catch (error) {
    console.error("Failed to load RxLab user display identities", error);
    return [];
  }
}

export async function listRxLabUsers(
  accessToken: string,
  options: { page?: number; pageSize?: number; keyword?: string } = {},
): Promise<RxLabUserListResult> {
  const url = new URL("/api/admin/users", rxLabIssuerOrigin());
  url.searchParams.set("page", String(Math.max(1, options.page ?? 1)));
  url.searchParams.set(
    "pageSize",
    String(Math.min(MAX_PAGE_SIZE, options.pageSize ?? MAX_PAGE_SIZE)),
  );
  const keyword = options.keyword?.trim();
  if (keyword) url.searchParams.set("keyword", keyword);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      error_description?: string;
    } | null;
    throw new RxLabAdminApiError(
      response.status,
      body?.error ?? "request_failed",
      body?.error_description ?? `rxlab admin API returned ${response.status}`,
    );
  }

  return (await response.json()) as RxLabUserListResult;
}

export async function listAllRxLabUsers(
  accessToken: string,
): Promise<RxLabUserSummary[]> {
  const collected: RxLabUserSummary[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await listRxLabUsers(accessToken, {
      page,
      pageSize: MAX_PAGE_SIZE,
    });
    collected.push(...result.users);
    totalPages = result.pagination.totalPages;
    page += 1;
  } while (page <= totalPages && page <= 50);

  return collected;
}

export async function findRxLabUser(
  accessToken: string,
  userId: string,
): Promise<RxLabUserSummary | null> {
  const id = userId.trim();
  if (!id) return null;
  const result = await listRxLabUsers(accessToken, {
    pageSize: MAX_PAGE_SIZE,
    keyword: id,
  });
  return result.users.find((user) => user.id === id && user.sub === id) ?? null;
}
