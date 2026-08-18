import { notFound } from "next/navigation";
import { adjustBalanceAction, setUserLevelAction } from "@/app/actions/users";
import { ActionForm } from "@/components/forms/action-form";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui/primitives";
import { TestBadge } from "@/components/ui/test-badge";
import { requireApplicationAccess } from "@/lib/console/session";
import { resolveEntitlements } from "@/lib/subscription/entitlements";
import { listSubscriptions } from "@/lib/subscription/subscriptions";
import { listBalanceUnits } from "@/lib/subscription/units";
import { getUsageStatus } from "@/lib/subscription/usage";
import { getBalances, getLedger, requireAppUser } from "@/lib/subscription/users";
import { formatDate } from "@/lib/utils";

export default async function UserDetailPage({
  params,
}: PageProps<"/apps/[appId]/users/[userId]">) {
  const { appId, userId } = await params;
  await requireApplicationAccess(appId);

  let user;
  try {
    user = await requireAppUser(appId, userId);
  } catch {
    notFound();
  }

  const [balances, units, entitlements, usage, subscriptions, ledger] =
    await Promise.all([
      getBalances(user.id),
      listBalanceUnits(appId),
      resolveEntitlements({ applicationId: appId, appUserId: user.id }),
      getUsageStatus({ applicationId: appId, appUserId: user.id }),
      listSubscriptions(appId, { appUserId: user.id }),
      getLedger(user.id),
    ]);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h1 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          {user.displayName || user.email || "Unnamed user"}
          {user.isTest ? <TestBadge /> : null}
        </h1>
        <p className="mt-1 font-mono text-xs text-neutral-500">{user.rxlabUserId}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {entitlements.roleKeys.map((key) => (
            <Badge key={key} tone="blue">
              {key}
            </Badge>
          ))}
          {entitlements.permissions.map((expression) => (
            <code
              key={expression}
              className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-100"
            >
              {expression}
            </code>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Balances" />
          {balances.length === 0 ? (
            <EmptyState title="No balances" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Unit</Th>
                  <Th>Amount</Th>
                  <Th>Available</Th>
                </tr>
              </thead>
              <tbody>
                {balances.map((balance) => (
                  <tr key={balance.balanceId}>
                    <Td>{balance.unitName}</Td>
                    <Td>{balance.amount.toLocaleString("en-US")}</Td>
                    <Td>
                      {(balance.amount - balance.reserved).toLocaleString("en-US")}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Usage" />
          {usage.length === 0 ? (
            <EmptyState title="No usage items" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Used</Th>
                  <Th>Resets</Th>
                </tr>
              </thead>
              <tbody>
                {usage.map((item) => (
                  <tr key={item.itemId}>
                    <Td>{item.name}</Td>
                    <Td>
                      {item.used}
                      {item.limit === null ? "" : ` / ${item.limit}`}
                    </Td>
                    <Td>
                      <span className="text-xs text-neutral-500">
                        {item.resetsAt ? formatDate(item.resetsAt) : "never"}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Subscriptions" />
        {subscriptions.length === 0 ? (
          <EmptyState title="No subscriptions" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Status</Th>
                <Th>Period ends</Th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <tr key={subscription.id}>
                  <Td>{subscription.planName}</Td>
                  <Td>
                    <Badge tone={statusTone(subscription.status)}>
                      {subscription.status}
                    </Badge>
                    {subscription.cancelAtPeriodEnd ? (
                      <span className="ml-2 text-xs text-neutral-500">
                        cancels at period end
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-xs text-neutral-500">
                      {formatDate(subscription.currentPeriodEnd)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <FormDialog
          triggerLabel="Adjust balance"
          title="Adjust user balance"
          description="Add or deduct balance and record the reason in the ledger."
        >
          <ActionForm action={adjustBalanceAction} submitLabel="Apply adjustment">
            <input type="hidden" name="applicationId" value={appId} />
            <input type="hidden" name="appUserId" value={user.id} />
            <div className="mt-4 space-y-3">
              <Field label="Unit">
                <Select name="unitId" required>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Delta" hint="Negative to deduct">
                <Input name="delta" type="number" required placeholder="1000" />
              </Field>
              <Field label="Reason">
                <Input name="reason" required placeholder="Support credit" />
              </Field>
            </div>
          </ActionForm>
        </FormDialog>

        <FormDialog
          triggerLabel="Edit user level"
          title="Edit user level"
          description="Set this application's custom tier and optional level key."
          icon="edit"
          triggerVariant="secondary"
        >
          <ActionForm action={setUserLevelAction} submitLabel="Save level">
            <input type="hidden" name="applicationId" value={appId} />
            <input type="hidden" name="appUserId" value={user.id} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Level">
                <Input name="level" type="number" defaultValue={user.level} />
              </Field>
              <Field label="Level key">
                <Input name="levelKey" defaultValue={user.levelKey ?? ""} />
              </Field>
            </div>
          </ActionForm>
        </FormDialog>
      </div>

      <Card>
        <CardHeader title="Ledger" description="Every balance movement, newest first." />
        {ledger.entries.length === 0 ? (
          <EmptyState title="No entries" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Kind</Th>
                <Th>Change</Th>
                <Th>Balance</Th>
                <Th>Description</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.map((entry) => (
                <tr key={entry.id}>
                  <Td>
                    <span className="text-xs text-neutral-500">
                      {formatDate(entry.createdAt)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs">{entry.kind}</span>
                  </Td>
                  <Td>
                    <span
                      className={entry.delta < 0 ? "text-red-600" : "text-green-700"}
                    >
                      {entry.delta > 0 ? "+" : ""}
                      {entry.delta.toLocaleString("en-US")} {entry.unitKey}
                    </span>
                  </Td>
                  <Td>{entry.balanceAfter.toLocaleString("en-US")}</Td>
                  <Td>
                    <span className="text-xs text-neutral-600">
                      {entry.description}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
