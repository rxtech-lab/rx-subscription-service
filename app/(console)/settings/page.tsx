import { Plug, ShieldCheck, Settings2 } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { McpUrl } from "@/app/settings/mcp-url";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  requireConsoleUser,
  getManagedApplications,
} from "@/lib/console/session";
import { db } from "@/lib/db";
import { mcpClients, mcpGrants } from "@/lib/db/schema";
import { resource } from "@/lib/mcp/oauth";
import { Connections } from "@/app/settings/connections";
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
    <div className="min-h-full bg-transparent">
      <main className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Workspace preferences</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Settings</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">Connect your tools and control how they access your applications.</p>
        </header>
        <div className="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="lg:sticky lg:top-24">
            <a href="#connected-clients" aria-current="page" className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
              <Plug className="size-4" aria-hidden="true" />
              Connected clients
            </a>
            <p className="mt-4 hidden px-4 text-xs leading-5 text-slate-400 lg:block">Manage the agents and tools connected to your workspace.</p>
          </nav>
          <div id="connected-clients" className="min-w-0 scroll-mt-24 space-y-8">
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-5 border-b border-slate-100 p-6 sm:flex-row sm:items-start sm:p-7">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-100"><Settings2 className="size-6" aria-hidden="true" /></span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-base font-semibold text-slate-950">Subscription MCP</h2>
                    <Badge tone="blue">OAuth connection</Badge>
                  </div>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Bring your subscription workspace into your AI tools. Connect a client to manage the applications you choose.</p>
                </div>
              </div>
              <div className="space-y-3 p-6 sm:p-7">
                <p className="text-xs font-semibold text-slate-700">Server URL</p>
                <McpUrl url={resource()} />
                <p className="text-xs leading-5 text-slate-500">Paste this URL into your client’s MCP settings, then sign in to select applications and approve access.</p>
              </div>
              <div className="flex items-start gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4 sm:px-7">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
                <p className="text-xs leading-5 text-slate-500">You stay in control. Review permissions or disconnect a client at any time.</p>
              </div>
            </Card>
            <section aria-labelledby="clients-heading">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 id="clients-heading" className="text-base font-semibold text-slate-950">Connected clients</h2>
                  <p className="mt-1 text-sm text-slate-500">Clients with active access to your workspace.</p>
                </div>
                <Badge>{rows.length} active</Badge>
              </div>
        <Connections
          apps={apps}
          connections={rows.map((r) => ({
            ...r,
            expiresAt: r.expiresAt.toISOString(),
          }))}
        />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
