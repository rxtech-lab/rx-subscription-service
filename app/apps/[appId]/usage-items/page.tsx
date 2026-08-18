import {
  createUsageItemAction,
  deleteUsageItemAction,
  updateUsageItemAction,
} from "@/app/actions/catalog";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ResetPolicyFields } from "@/components/forms/reset-policy-fields";
import { ActionMenu, ActionMenuDivider } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { listUsageItems } from "@/lib/subscription/usage-items";
import { listBalanceUnits } from "@/lib/subscription/units";

function describeReset(item: {
  resetPolicy: string;
  resetIntervalCount: number | null;
  resetIntervalUnit: string | null;
}): string {
  if (item.resetPolicy === "never") return "Never resets";
  if (item.resetPolicy === "billing_period") return "Resets each billing period";
  const count = item.resetIntervalCount ?? 1;
  const unit = item.resetIntervalUnit ?? "month";
  const every = count === 1 ? unit : `${count} ${unit}s`;
  return item.resetPolicy === "rolling_window"
    ? `Rolling ${every} from first use`
    : `Every ${every}, on the clock`;
}

export default async function UsageItemsPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [items, units] = await Promise.all([
    listUsageItems(appId),
    listBalanceUnits(appId),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Usage items"
          description="Anything you count per user. Counters roll over lazily, so a reset is exact without a scheduled job."
        />
        {items.length === 0 ? (
          <EmptyState
            title="No usage items"
            description="Add one for each thing you meter, such as api_calls or video_minutes."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Reset</Th>
                <Th>Default limit</Th>
                <Th>Over limit</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <Td>
                    <p className="font-medium text-neutral-900">{item.name}</p>
                    <p className="font-mono text-xs text-neutral-500">{item.key}</p>
                  </Td>
                  <Td>
                    <span className="text-xs text-neutral-700">
                      {describeReset(item)}
                    </span>
                  </Td>
                  <Td>{item.defaultLimit ?? "Unlimited"}</Td>
                  <Td>
                    <span className="text-xs text-neutral-700">
                      {item.overagePolicy === "block"
                        ? "Block"
                        : item.overagePolicy === "allow"
                          ? "Allow"
                          : `Charge ${item.overageCostPerUnit ?? 0}/unit`}
                    </span>
                  </Td>
                  <Td>
                    <ActionMenu label={`Actions for ${item.name}`}>
                      <FormDialog
                        triggerLabel="Edit"
                        title={`Edit ${item.name}`}
                        description="Update how this usage item is displayed, reset, and enforced. Its key stays fixed."
                        icon="edit"
                        size="lg"
                        triggerVariant="menu"
                        triggerSize="sm"
                      >
                        <ActionForm
                          action={updateUsageItemAction}
                          submitLabel="Save item"
                        >
                          <input
                            type="hidden"
                            name="applicationId"
                            value={appId}
                          />
                          <input
                            type="hidden"
                            name="usageItemId"
                            value={item.id}
                          />
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <Field label="Name">
                              <Input name="name" defaultValue={item.name} required />
                            </Field>
                            <Field label="Default limit" hint="Blank = unlimited">
                              <Input
                                name="defaultLimit"
                                type="number"
                                min="0"
                                defaultValue={item.defaultLimit ?? undefined}
                              />
                            </Field>
                            <div className="sm:col-span-2">
                              <Field label="Description">
                                <Textarea
                                  name="description"
                                  rows={2}
                                  defaultValue={item.description ?? ""}
                                />
                              </Field>
                            </div>
                            <ResetPolicyFields
                              initialPolicy={item.resetPolicy}
                              initialIntervalCount={item.resetIntervalCount}
                              initialIntervalUnit={item.resetIntervalUnit}
                            />
                            <Field label="When over limit">
                              <Select
                                name="overagePolicy"
                                defaultValue={item.overagePolicy}
                              >
                                <option value="block">Block</option>
                                <option value="allow">Allow</option>
                                <option value="charge_balance">Charge balance</option>
                              </Select>
                            </Field>
                            <Field label="Charge from unit">
                              <Select
                                name="overageUnitId"
                                defaultValue={item.overageUnitId ?? ""}
                              >
                                <option value="">—</option>
                                {units.map((unit) => (
                                  <option key={unit.id} value={unit.id}>
                                    {unit.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Cost per extra unit">
                              <Input
                                name="overageCostPerUnit"
                                type="number"
                                min="1"
                                defaultValue={item.overageCostPerUnit ?? undefined}
                              />
                            </Field>
                          </div>
                        </ActionForm>
                      </FormDialog>

                      <ActionMenuDivider />

                      <InlineActionButton
                        action={deleteUsageItemAction}
                        label="Delete"
                        variant="menuDanger"
                        confirmMessage="Delete this usage item and its counters?"
                      >
                        <input type="hidden" name="applicationId" value={appId} />
                        <input type="hidden" name="usageItemId" value={item.id} />
                      </InlineActionButton>
                    </ActionMenu>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="flex justify-end">
        <FormDialog
          triggerLabel="New usage item"
          title="Create a usage item"
          description="Define what you count, when it resets, and what happens at the limit."
          size="lg"
        >
        <ActionForm action={createUsageItemAction} submitLabel="Create item">
          <input type="hidden" name="applicationId" value={appId} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Key">
              <Input name="key" required placeholder="api_calls" />
            </Field>
            <Field label="Name">
              <Input name="name" required placeholder="API calls" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <Textarea name="description" rows={2} />
              </Field>
            </div>
            <ResetPolicyFields />
            <Field label="Default limit" hint="Blank = unlimited">
              <Input name="defaultLimit" type="number" min="0" />
            </Field>
            <Field label="When over limit">
              <Select name="overagePolicy" defaultValue="block">
                <option value="block">Block</option>
                <option value="allow">Allow</option>
                <option value="charge_balance">Charge balance</option>
              </Select>
            </Field>
            <Field label="Charge from unit">
              <Select name="overageUnitId">
                <option value="">—</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cost per extra unit">
              <Input name="overageCostPerUnit" type="number" min="1" />
            </Field>
          </div>
        </ActionForm>
        </FormDialog>
      </div>
    </div>
  );
}
