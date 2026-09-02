import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import {
  auth,
  authStatus,
  RX_LAB_REFRESH_TOKEN_ERROR,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { applications } from "@/lib/db/schema";
import { isAuthorizedE2EHeaders } from "@/lib/e2e/request";
import {
  isPermissionError,
  listAllOAuthClients,
  type OAuthClientSummary,
} from "@/lib/rxlab/oauth-clients";

export interface ConsoleUser {
  id: string;
  name: string;
  email: string;
  accessToken: string;
}

export interface ConsoleApplication {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
}

const E2E_CONSOLE_ACCESS_TOKEN = "rx-subscription-e2e-console";

/**
 * The signed-in admin. Cached per request so a page that checks the session in
 * several places still performs one session read.
 */
export const getConsoleUser = cache(async (): Promise<ConsoleUser | null> => {
  if (isAuthorizedE2EHeaders(await headers())) {
    return {
      id: "playwright-console-user",
      name: "Playwright Admin",
      email: "playwright@rxlab.test",
      accessToken: E2E_CONSOLE_ACCESS_TOKEN,
    };
  }
  if (!authStatus.configured) return null;
  const session = await auth();
  if (session?.error === RX_LAB_REFRESH_TOKEN_ERROR) return null;
  if (!session?.user?.id || !session.accessToken) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? "Admin",
    email: session.user.email ?? "",
    accessToken: session.accessToken,
  };
});

export async function requireConsoleUser(): Promise<ConsoleUser> {
  const user = await getConsoleUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Every OAuth client this admin can see, straight from rxlab-auth.
 *
 * Cached per request because two different questions are asked of the same
 * list — which applications may be managed, and which clients a publishable
 * key may accept tokens from — and neither is worth a second round trip.
 *
 * A permissions refusal comes back as an empty list rather than an error: an
 * admin with no `read:oauth_clients` grant has no applications, which is a
 * legitimate state, not a failure.
 */
const getVisibleOAuthClients = cache(async (): Promise<OAuthClientSummary[]> => {
  const user = await requireConsoleUser();

  if (user.accessToken === E2E_CONSOLE_ACCESS_TOKEN) {
    const localApplications = await db.select().from(applications);
    const stamp = new Date(0).toISOString();
    return localApplications.map((application) => ({
      id: application.id,
      name: application.name,
      description: application.description,
      iconUrl: application.iconUrl,
      clientType: "confidential" as const,
      isFirstParty: true,
      createdAt: stamp,
      updatedAt: stamp,
    }));
  }

  try {
    return await listAllOAuthClients(user.accessToken);
  } catch (error) {
    if (isPermissionError(error)) return [];
    throw error;
  }
});

/**
 * Applications this admin may manage. Their `read:oauth_clients` grant *is* the
 * authorization model here — there is no second permission list to keep in sync.
 *
 * The console's own OAuth client is dropped: it is the login for this tool, not
 * a product that sells subscriptions, and `requireApplicationAccess` reads this
 * same list, so it cannot be reached by typing its id into the URL either.
 *
 * Each call mirrors the clients into the local `applications` table so the rest
 * of the schema has a stable foreign key to point at.
 */
export const getManagedApplications = cache(
  async (): Promise<ConsoleApplication[]> => {
    const user = await requireConsoleUser();
    const clients = await getVisibleOAuthClients();

    if (user.accessToken === E2E_CONSOLE_ACCESS_TOKEN) {
      return clients.map((client) => ({
        id: client.id,
        name: client.name,
        description: client.description,
        iconUrl: client.iconUrl,
      }));
    }

    const consoleClientId = process.env.AUTH_CLIENT_ID?.trim();
    const managed = consoleClientId
      ? clients.filter((client) => client.id !== consoleClientId)
      : clients;

    await syncApplications(managed);
    return managed.map((client) => ({
      id: client.id,
      name: client.name,
      description: client.description,
      iconUrl: client.iconUrl,
    }));
  },
);

/** An OAuth client offered in the publishable-key allow-list picker. */
export interface OAuthClientOption {
  id: string;
  name: string;
  clientType: "public" | "confidential";
  isFirstParty: boolean;
}

/**
 * The clients a publishable key can be told to accept tokens from.
 *
 * Every client the admin can see, not just the subscription-enabled ones: the
 * app that ships the key is usually a *different* OAuth client from the
 * application it bills against — a native app needs a public client, while the
 * application row is typically the confidential one — so narrowing this to
 * managed applications would hide exactly the entry most keys need.
 *
 * Public clients sort first for the same reason: a publishable key belongs in a
 * binary, and a binary cannot hold a client secret.
 */
export async function getSelectableOAuthClients(): Promise<OAuthClientOption[]> {
  const clients = await getVisibleOAuthClients();
  const consoleClientId = process.env.AUTH_CLIENT_ID?.trim();

  return clients
    .filter((client) => client.id !== consoleClientId)
    .map((client) => ({
      id: client.id,
      name: client.name,
      clientType: client.clientType,
      isFirstParty: client.isFirstParty ?? false,
    }))
    .sort((a, b) => {
      if (a.clientType !== b.clientType) return a.clientType === "public" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Upsert the rxlab client list into the local mirror. */
async function syncApplications(clients: OAuthClientSummary[]): Promise<void> {
  if (clients.length === 0) return;
  const now = new Date();

  await db
    .insert(applications)
    .values(
      clients.map((client) => ({
        id: client.id,
        name: client.name,
        description: client.description,
        iconUrl: client.iconUrl,
        status: "active" as const,
        defaultCurrency: "usd",
        createdAt: now,
        updatedAt: now,
        syncedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: applications.id,
      set: {
        name: sql.raw("excluded.name"),
        description: sql.raw("excluded.description"),
        iconUrl: sql.raw("excluded.icon_url"),
        updatedAt: sql.raw("excluded.updated_at"),
        syncedAt: sql.raw("excluded.synced_at"),
      },
    });
}

export class ApplicationAccessError extends Error {
  constructor(readonly applicationId: string) {
    super(`No access to application ${applicationId}`);
    this.name = "ApplicationAccessError";
  }
}

/**
 * Authorize a single application. Every server action and AI tool funnels
 * through here, so `applicationId` can never be spoofed by a form field or a
 * model-generated argument.
 */
export async function requireApplicationAccess(
  applicationId: string,
): Promise<ConsoleApplication> {
  const managed = await getManagedApplications();
  const match = managed.find((application) => application.id === applicationId);
  if (!match) throw new ApplicationAccessError(applicationId);
  return match;
}
