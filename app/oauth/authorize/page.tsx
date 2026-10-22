import { getConsoleUser, getManagedApplications } from "@/lib/console/session";
import { validateAuthorization } from "@/lib/mcp/oauth";
import { SCOPE_LABELS } from "@/lib/mcp/scopes";
import { decide, loginForMcp } from "./actions";
import { Button, Card } from "@/components/ui/primitives";
import { ProjectAccessSelector } from "@/components/console/project-access-selector";
import { ToastForm } from "@/components/ui/toast";
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    if (typeof value === "string") query.set(key, value);
  let request;
  try {
    request = await validateAuthorization(query);
  } catch {
    return (
      <main className="m-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">Invalid authorization request</h1>
        <p>Return to your MCP client and start connecting again.</p>
      </main>
    );
  }
  const user = await getConsoleUser();
  if (!user)
    return (
      <main className="m-auto max-w-xl p-8">
        <Card className="p-5 sm:p-8">
          <h1 className="text-xl font-semibold">
            Connect {request.client.name}
          </h1>
          <p className="my-4">Sign in to review this client’s access.</p>
          <ToastForm
            action={loginForMcp.bind(null, query.toString())}
            pendingMessage="Signing in…"
          >
            <Button type="submit">Sign in with RxLab</Button>
          </ToastForm>
        </Card>
      </main>
    );
  const apps = await getManagedApplications();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <Card className="p-5 sm:p-8">
        <h1 className="text-2xl font-semibold">
          Connect {request.client.name}
        </h1>
        <p className="my-4 text-sm text-slate-600">
          Signed in as {user.email || user.name}. Choose what this client can
          access. Write access allows changes after approval in your MCP client.
          Paywall access covers shared templates.
        </p>
        <p className="mb-6 break-all text-xs text-slate-500">
          Return to: {request.redirectUri}
        </p>
        <ToastForm
          action={decide.bind(null, query.toString())}
          pendingMessage="Saving your decision…"
          className="space-y-6"
        >
          <fieldset className="space-y-3">
            <legend className="mb-3 font-semibold">Scopes</legend>
            {request.scopes.map((scope) => (
              <label key={scope} className="flex gap-3 text-sm">
                <input
                  type="checkbox"
                  name="scopes"
                  value={scope}
                  defaultChecked={!scope.endsWith(":write")}
                />
                {SCOPE_LABELS[scope as keyof typeof SCOPE_LABELS]}
              </label>
            ))}
          </fieldset>
          <ProjectAccessSelector apps={apps.map(({ id, name }) => ({ id, name }))} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" name="decision" value="allow">
              Allow selected access
            </Button>
            <Button
              variant="secondary"
              type="submit"
              name="decision"
              value="deny"
            >
              Deny
            </Button>
          </div>
        </ToastForm>
      </Card>
    </main>
  );
}
