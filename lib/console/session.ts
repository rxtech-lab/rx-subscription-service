import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
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
 * Applications this admin may manage, straight from rxlab-auth. Their
 * `read:oauth_clients` grant *is* the authorization model here — there is no
 * second permission list to keep in sync.
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

    if (user.accessToken === E2E_CONSOLE_ACCESS_TOKEN) {
      const localApplications = await db.select().from(applications);
      return localApplications.map((application) => ({
        id: application.id,
        name: application.name,
        description: application.description,
        iconUrl: application.iconUrl,
      }));
    }

    let clients: OAuthClientSummary[];
    try {
      clients = await listAllOAuthClients(user.accessToken);
    } catch (error) {
      if (isPermissionError(error)) return [];
      throw error;
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

/** Upsert the rxlab client list into the local mirror. */
async function syncApplications(clients: OAuthClientSummary[]): Promise<void> {
  if (clients.length === 0) return;
  const now = new Date();

  const existing = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      inArray(
        applications.id,
        clients.map((client) => client.id),
      ),
    );
  const existingIds = new Set(existing.map((row) => row.id));

  for (const client of clients) {
    if (existingIds.has(client.id)) {
      await db
        .update(applications)
        .set({
          name: client.name,
          description: client.description,
          iconUrl: client.iconUrl,
          updatedAt: now,
          syncedAt: now,
        })
        .where(eq(applications.id, client.id));
      continue;
    }
    await db
      .insert(applications)
      .values({
        id: client.id,
        name: client.name,
        description: client.description,
        iconUrl: client.iconUrl,
        status: "active",
        defaultCurrency: "usd",
        createdAt: now,
        updatedAt: now,
        syncedAt: now,
      })
      .onConflictDoNothing();
  }
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
