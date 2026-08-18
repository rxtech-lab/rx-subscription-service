import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions/users";
import { ApiKeyForm, InlineActionButton } from "@/components/forms/action-form";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { listApiKeys } from "@/lib/api/keys";
import { requireApplicationAccess } from "@/lib/console/session";
import { formatDate } from "@/lib/utils";

export default async function SettingsPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  const application = await requireApplicationAccess(appId);
  const keys = await listApiKeys(appId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Application"
          description="Mirrored from rxlab-auth. Edit the name and icon there."
        />
        <dl className="space-y-2 px-5 py-4 text-sm">
          <div className="flex gap-3">
            <dt className="w-32 text-neutral-500">Name</dt>
            <dd className="text-neutral-900">{application.name}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-32 text-neutral-500">OAuth client id</dt>
            <dd className="font-mono text-xs text-neutral-900">{application.id}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="API keys"
          description="Server-to-server credentials for the /api/v1 endpoints. Only the hash is stored, so a key is shown once."
        />
        {keys.length === 0 ? (
          <EmptyState title="No API keys" description="Create one below." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Key</Th>
                <Th>Last used</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <Td>{key.name}</Td>
                  <Td>
                    <code className="text-xs">{key.keyPrefix}…</code>
                  </Td>
                  <Td>
                    <span className="text-xs text-neutral-500">
                      {key.lastUsedAt ? formatDate(key.lastUsedAt) : "never"}
                    </span>
                  </Td>
                  <Td>
                    {key.revokedAt ? (
                      <Badge tone="red">revoked</Badge>
                    ) : (
                      <Badge tone="green">active</Badge>
                    )}
                  </Td>
                  <Td>
                    {key.revokedAt ? null : (
                      <InlineActionButton
                        action={revokeApiKeyAction}
                        label="Revoke"
                        variant="danger"
                        confirmMessage="Revoke this key? Any app using it stops working immediately."
                      >
                        <input type="hidden" name="applicationId" value={appId} />
                        <input type="hidden" name="keyId" value={key.id} />
                      </InlineActionButton>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <div className="flex justify-end border-t border-slate-100 px-5 py-4">
          <FormDialog
            triggerLabel="Create API key"
            title="Create an API key"
            description="Give the key a name that identifies where it will be used."
            icon="key"
            size="sm"
          >
            <ApiKeyForm action={createApiKeyAction}>
              <input type="hidden" name="applicationId" value={appId} />
              <Field label="Key name" hint="Something that identifies where it is used">
                <Input name="name" required placeholder="production server" />
              </Field>
            </ApiKeyForm>
          </FormDialog>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Using the API"
          description="Send the key as X-Api-Key. Users are addressed by their rxlab id."
        />
        <pre className="overflow-x-auto px-5 py-4 text-xs text-neutral-700">
          {`# What is this user entitled to?
curl "$BASE/api/v1/entitlements?rxlabUserId=$USER" \\
  -H "X-Api-Key: $KEY"

# Meter one unit of usage
curl -X POST "$BASE/api/v1/usage" \\
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"rxlabUserId":"'$USER'","item":"api_calls","amount":1}'

# Start a checkout
curl -X POST "$BASE/api/v1/checkout" \\
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"rxlabUserId":"'$USER'","kind":"plan","planId":"..."}'`}
        </pre>
      </Card>
    </div>
  );
}
