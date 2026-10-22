"use client";
import { ProjectAccessSelector } from "@/components/console/project-access-selector";
import { useState } from "react";
import { FormDialog, useCloseFormDialog } from "@/components/ui/form-dialog";
import { Button, Card } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { SCOPE_LABELS } from "@/lib/mcp/scopes";
import { updateConnection } from "./actions";
type Connection = {
  id: string;
  name: string;
  scopes: string[];
  applicationIds: string[];
  expiresAt: string;
};
type App = { id: string; name: string };
function ConnectionForm({
  connection,
  apps,
  disconnect = false,
}: {
  connection: Connection;
  apps: App[];
  disconnect?: boolean;
}) {
  const close = useCloseFormDialog();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-6"
      action={async (form) => {
        setPending(true);
        const status = toast.loading(
          disconnect ? "Disconnecting…" : "Updating client access…",
          { position: "top-right" },
        );
        try {
          const result = await updateConnection(connection.id, form);
          if (result.error)
            toast.error(result.error, { id: status, position: "top-right" });
          else {
            toast.success(result.success, {
              id: status,
              position: "top-right",
            });
            close?.();
          }
        } catch {
          toast.error("Unable to update connection", {
            id: status,
            position: "top-right",
          });
        } finally {
          setPending(false);
        }
      }}
    >
      <input
        type="hidden"
        name="operation"
        value={disconnect ? "disconnect" : "update"}
      />
      {disconnect ? (
        <p>
          Disconnect {connection.name}? Its access and refresh tokens will stop
          working immediately.
        </p>
      ) : (
        <>
          <fieldset disabled={pending} className="space-y-3">
            <legend className="mb-3 font-semibold">Scopes</legend>
            {Object.entries(SCOPE_LABELS).map(([scope, label]) => (
              <label key={scope} className="flex gap-3 text-sm">
                <input
                  type="checkbox"
                  name="scopes"
                  value={scope}
                  defaultChecked={connection.scopes.includes(scope)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <ProjectAccessSelector
            apps={apps}
            defaultSelectedIds={connection.applicationIds}
            disabled={pending}
          />
        </>
      )}
      <Button disabled={pending} type="submit">
        {disconnect ? "Disconnect client" : "Save access"}
      </Button>
    </form>
  );
}
export function Connections({
  connections,
  apps,
}: {
  connections: Connection[];
  apps: App[];
}) {
  if (!connections.length)
    return (
      <Card className="p-8">
        <h2 className="font-semibold">No connected clients</h2>
        <p className="mt-2 text-sm text-slate-500">
          Add the MCP URL in your client and sign in to connect.
        </p>
      </Card>
    );
  return (
    <div className="space-y-3">
      {connections.map((c) => (
        <Card
          key={c.id}
          className="flex flex-wrap items-center justify-between gap-5 p-6"
        >
          <div>
            <h2 className="font-semibold">{c.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {c.applicationIds.length} projects · {c.scopes.length} scopes ·
              Expires {c.expiresAt.slice(0, 10)}
            </p>
          </div>
          <div className="flex gap-2">
            <FormDialog
              triggerLabel="Edit access"
              size="lg"
              title={`Access for ${c.name}`}
              icon="edit"
              triggerVariant="secondary"
            >
              <ConnectionForm connection={c} apps={apps} />
            </FormDialog>
            <FormDialog
              triggerLabel="Disconnect"
              title="Disconnect client"
              icon="remove"
              triggerVariant="secondary"
              size="sm"
            >
              <ConnectionForm connection={c} apps={apps} disconnect />
            </FormDialog>
          </div>
        </Card>
      ))}
    </div>
  );
}
