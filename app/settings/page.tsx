import { and, eq, gt, isNull } from "drizzle-orm";
import { ConsoleHeader } from "@/components/console/console-header";
import {
  requireConsoleUser,
  getManagedApplications,
} from "@/lib/console/session";
import { db } from "@/lib/db";
import { mcpClients, mcpGrants } from "@/lib/db/schema";
import { resource } from "@/lib/mcp/oauth";
import { Connections } from "./connections";
export default async function SettingsPage() {
  const user = await requireConsoleUser();
  const apps = await getManagedApplications();
  const rows = await db
    .select({
      id: mcpGrants.id,
      name: mcpClients.name,
      scopes: mcpGrants.scopes,
      applicationIds: mcpGrants.applicationIds,
      expiresAt: mcpGrants.expiresAt,
    })
    .from(mcpGrants)
    .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
    .where(
      and(
        eq(mcpGrants.userId, user.id),
        isNull(mcpGrants.revokedAt),
        gt(mcpGrants.expiresAt, new Date()),
      ),
    );
  return (
    <div className="min-h-full bg-[#f7f8fc]">
      <ConsoleHeader displayName={user.name} email={user.email} />
      <main className="mx-auto max-w-7xl space-y-6 px-5 py-10 sm:px-8">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <nav aria-label="Settings sections" className="border-b pb-3">
          <span className="font-medium text-blue-700">Connected clients</span>
        </nav>
        <div>
          <h2 className="text-lg font-semibold">Subscription MCP</h2>
          <p className="mt-2 text-sm text-slate-600">
            Connect an agent using OAuth. Review its permissions here at any
            time.
          </p>
          <code className="mt-3 block break-all rounded-lg bg-white p-3 text-sm">
            {resource()}
          </code>
        </div>
        <Connections
          apps={apps}
          connections={rows.map((r) => ({
            ...r,
            expiresAt: r.expiresAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
