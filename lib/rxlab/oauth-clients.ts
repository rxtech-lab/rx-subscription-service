import "server-only";

/**
 * Client for rxlab-auth's admin OAuth-client API
 * (`app/api/admin/oauth-clients/route.ts`), which is where the list of
 * subscription-enabled applications comes from.
 *
 * Authorization is the *calling admin's* bearer token, not a service
 * credential: rxlab-auth resolves the token `sub` against its `users` table
 * (`lib/admin-api/authorize.ts`), so a `client_credentials` token — whose `sub`
 * is the client id — cannot authorize here. That also makes the response a
 * natural permission boundary: whatever clients come back are exactly the apps
 * this admin may manage, per their `read:oauth_clients:all|<ids>` grant.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface OAuthClientSummary {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  clientType: "public" | "confidential";
  isFirstParty: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthClientListResult {
  clients: OAuthClientSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export class RxLabAdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RxLabAdminApiError";
  }
}

/** True when the admin API rejected the caller's permissions, not their token. */
export function isPermissionError(error: unknown): boolean {
  return (
    error instanceof RxLabAdminApiError &&
    (error.status === 403 || error.code === "insufficient_permission")
  );
}

export function rxLabIssuerOrigin(): string {
  const issuer = process.env.AUTH_ISSUER?.trim();
  if (!issuer) throw new Error("AUTH_ISSUER_NOT_CONFIGURED");
  return new URL(issuer).origin;
}

export async function listOAuthClients(
  accessToken: string,
  options: { page?: number; pageSize?: number; keyword?: string } = {},
): Promise<OAuthClientListResult> {
  const url = new URL("/api/admin/oauth-clients", rxLabIssuerOrigin());
  url.searchParams.set("page", String(Math.max(1, options.page ?? 1)));
  url.searchParams.set(
    "pageSize",
    String(Math.min(MAX_PAGE_SIZE, options.pageSize ?? DEFAULT_PAGE_SIZE)),
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

  return (await response.json()) as OAuthClientListResult;
}

/**
 * Page through the admin API until every visible client is collected. The list
 * is small (one row per application), so this stays a handful of requests.
 */
export async function listAllOAuthClients(
  accessToken: string,
): Promise<OAuthClientSummary[]> {
  const collected: OAuthClientSummary[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await listOAuthClients(accessToken, {
      page,
      pageSize: MAX_PAGE_SIZE,
    });
    collected.push(...result.clients);
    totalPages = result.pagination.totalPages;
    page += 1;
  } while (page <= totalPages && page <= 50);

  return collected;
}
