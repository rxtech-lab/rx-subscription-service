import { createTestUserAction } from "@/app/actions/test-users";
import { ActionForm } from "@/components/forms/action-form";
import { TestUserFields } from "@/components/testing/test-user-fields";
import { TestUserRow } from "@/components/testing/test-user-row";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Card,
  CardHeader,
  EmptyState,
  Table,
  Th,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { sandboxConfigured, stripeMode } from "@/lib/stripe/client";
import { listRoles } from "@/lib/subscription/roles";
import { listPurchasablePlans } from "@/lib/subscription/subscriptions";
import { listTestUserIdentities } from "@/lib/subscription/test-users";
import { listBalanceUnits } from "@/lib/subscription/units";
import { listUsageItems } from "@/lib/subscription/usage-items";

export default async function TestPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [identities, plans, units, roles, usageItems] = await Promise.all([
    listTestUserIdentities(appId),
    listPurchasablePlans(appId),
    listBalanceUnits(appId),
    listRoles(appId),
    listUsageItems(appId),
  ]);
  const sandboxReady = sandboxConfigured();
  const sandboxMode = stripeMode("sandbox");

  return (
    <div className="space-y-4">
      {sandboxReady ? null : (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Set <code className="font-mono">STRIPE_SANDBOX_SECRET_KEY</code> to run
          checkout in the test app. Test users, plan grants and balances work without
          it.
        </div>
      )}
      {sandboxReady && sandboxMode === "live" ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <code className="font-mono">STRIPE_SANDBOX_SECRET_KEY</code> is a live key.
          Test checkouts would create real charges — replace it with a sandbox key.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Test users"
          description="Disposable users for exercising the subscriber experience. They are hidden from the Users tab and bill against the Stripe sandbox, never the live account."
          action={
            <FormDialog
              triggerLabel="Create"
              title="Create a test user"
              description="No RxLab identity is required — a synthetic one is generated."
              size="md"
              triggerSize="sm"
            >
              <ActionForm
                action={createTestUserAction}
                submitLabel="Create test user"
                pendingLabel="Creating…"
                autoComplete="off"
              >
                <input type="hidden" name="applicationId" value={appId} />
                <TestUserFields
                  plans={plans}
                  units={units}
                  roles={roles}
                  usageItems={usageItems}
                />
              </ActionForm>
            </FormDialog>
          }
        />

        {identities.length === 0 ? (
          <EmptyState
            title="No test users yet"
            description="Create one to open the test app and walk through subscribing, buying a topup, and spending a balance as a subscriber would."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Subscriptions</Th>
                <Th>Roles &amp; limits</Th>
                <Th>Balances</Th>
                <Th>Level</Th>
                <Th>Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {identities.map((identity) => (
                <TestUserRow
                  key={identity.rxlabUserId}
                  appId={appId}
                  identity={identity}
                  plans={plans}
                  units={units}
                  roles={roles}
                  usageItems={usageItems}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
