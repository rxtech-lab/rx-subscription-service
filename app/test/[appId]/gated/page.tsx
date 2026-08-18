import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Select,
} from "@/components/ui/primitives";
import { hasPermission } from "@/lib/permissions/expression";
import { resolveEntitlements } from "@/lib/subscription/entitlements";
import { getRolePermissions, listPermissions, listRoles } from "@/lib/subscription/roles";
import { readTestSessionFor } from "@/lib/test-session";

/**
 * A section of the simulated storefront that only a permission gets you into.
 *
 * The gate is the same check an application would run against
 * `/api/v1/entitlements`: resolve the user's permissions, then ask whether the
 * chosen key is among them. Which permission guards the door is a choice made
 * here rather than baked in, because every application defines its own — this
 * way any of them can be tried without editing code.
 */
export default async function TestGatedPage({
  params,
  searchParams,
}: PageProps<"/test/[appId]/gated">) {
  const { appId } = await params;
  const { permission: requested } = await searchParams;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  const [permissions, entitlements, roles] = await Promise.all([
    listPermissions(appId),
    resolveEntitlements({ applicationId: appId, appUserId: session.user.id }),
    listRoles(appId),
  ]);

  if (permissions.length === 0) {
    return (
      <Card>
        <CardHeader
          title="Members area"
          description="Gated on a permission your application defines."
        />
        <EmptyState
          title="No permissions defined"
          description="Define a permission in the console, grant it through a role, and this section will gate on it."
        />
      </Card>
    );
  }

  const requestedKey = Array.isArray(requested) ? requested[0] : requested;
  const gate =
    permissions.find((permission) => permission.key === requestedKey) ?? permissions[0];
  const allowed = hasPermission(entitlements.permissions, gate.key);

  // Which roles would open this door, so a locked user knows what to go get.
  const grantingRoles: string[] = [];
  for (const role of roles) {
    const { expressions } = await getRolePermissions(appId, role.id);
    if (hasPermission(expressions, gate.key)) grantingRoles.push(role.key);
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Members area"
          description="Pick the permission that guards this section. The check runs on the server against your resolved entitlements."
        />
        <form className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              Required permission
            </span>
            <Select name="permission" defaultValue={gate.key} className="w-auto">
              {permissions.map((permission) => (
                <option key={permission.id} value={permission.key}>
                  {permission.key} · {permission.title}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" size="sm" variant="secondary">
            Check access
          </Button>
        </form>
      </Card>

      <Card>
        <div className="px-5 py-6">
          {allowed ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <ShieldCheck className="size-4" aria-hidden="true" />
                You are in
              </p>
              <p className="text-sm leading-6 text-slate-600">
                This is the part of the application only{" "}
                <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-slate-100">
                  {gate.key}
                </code>{" "}
                holders reach. You got here through{" "}
                {entitlements.roleKeys.length > 0
                  ? "these roles:"
                  : "a direct permission grant."}
              </p>
              {entitlements.roleKeys.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {entitlements.roleKeys.map((key) => (
                    <Badge key={key} tone="blue">
                      {key}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Lock className="size-4" aria-hidden="true" />
                Locked
              </p>
              <p className="text-sm leading-6 text-slate-600">
                This section needs{" "}
                <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-slate-100">
                  {gate.key}
                </code>
                {gate.description ? ` — ${gate.description}` : ""}.
              </p>
              <p className="text-sm leading-6 text-slate-600">
                {grantingRoles.length === 0
                  ? "No role grants it yet. Add it to a role in the console first."
                  : `Granted by ${grantingRoles.join(", ")}. Subscribe to a plan that includes one, or have the console assign it to this test user.`}
              </p>
              <Link
                href={`/test/${encodeURIComponent(appId)}/plans`}
                className="inline-flex text-sm font-semibold text-blue-700 hover:text-blue-800"
              >
                See plans
              </Link>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
