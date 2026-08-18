import {
  addPlanEntitlementAction,
  createPlanAction,
  removePlanEntitlementAction,
  setPlanStatusAction,
  updatePlanAction,
} from "@/app/actions/plans";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu } from "@/components/ui/action-menu";
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
  Textarea,
  Th,
  statusTone,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { listPlanEntitlements, listPlans } from "@/lib/subscription/plans";
import { listRoles } from "@/lib/subscription/roles";
import { listUsageItems } from "@/lib/subscription/usage-items";
import { listBalanceUnits } from "@/lib/subscription/units";
import { formatInterval, formatMoney } from "@/lib/utils";

export default async function PlansPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [plans, roles, usageItems, units] = await Promise.all([
    listPlans(appId, { includeArchived: true }),
    listRoles(appId),
    listUsageItems(appId),
    listBalanceUnits(appId),
  ]);

  const entitlementsByPlan = new Map(
    await Promise.all(
      plans.map(
        async (plan) => [plan.id, await listPlanEntitlements(plan.id)] as const,
      ),
    ),
  );

  const labelFor = {
    role: (id: string | null) => roles.find((role) => role.id === id)?.key ?? id,
    usage: (id: string | null) =>
      usageItems.find((item) => item.id === id)?.key ?? id,
    unit: (id: string | null) => units.find((unit) => unit.id === id)?.key ?? id,
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Plans"
          description="Monthly, quarterly, yearly, or one-time. Publish a plan to make it purchasable."
        />
        {plans.length === 0 ? (
          <EmptyState title="No plans yet" description="Create your first plan below." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Price</Th>
                <Th>Grants</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const entitlements = entitlementsByPlan.get(plan.id) ?? [];
                return (
                  <tr key={plan.id}>
                    <Td>
                      <p className="font-medium text-neutral-900">{plan.name}</p>
                      <p className="font-mono text-xs text-neutral-500">{plan.key}</p>
                    </Td>
                    <Td>
                      <p>{formatMoney(plan.priceAmountCents, plan.currency)}</p>
                      <p className="text-xs text-neutral-500">
                        {formatInterval(plan.billingInterval, plan.intervalCount)}
                        {plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
                      </p>
                    </Td>
                    <Td>
                      {entitlements.length === 0 ? (
                        <span className="text-xs text-neutral-400">None</span>
                      ) : (
                        <ul className="space-y-1">
                          {entitlements.map((entitlement) => (
                            <li key={entitlement.id} className="flex items-center gap-2">
                              <span className="text-xs text-neutral-700">
                                {entitlement.kind === "role"
                                  ? `role: ${labelFor.role(entitlement.roleId)}`
                                  : entitlement.kind === "usage_limit"
                                    ? `${labelFor.usage(entitlement.usageItemId)}: ${entitlement.limitValue ?? "unlimited"}`
                                    : entitlement.kind === "balance_grant"
                                      ? `${entitlement.amount} ${labelFor.unit(entitlement.unitId)}/period`
                                      : entitlement.kind === "permission"
                                        ? `${entitlement.permissionKey}:${entitlement.permissionScope === "all" ? "all" : (entitlement.permissionTargetIds ?? []).join(",")}`
                                        : `${entitlement.featureKey}=${entitlement.featureValue ?? "on"}`}
                              </span>
                              <InlineActionButton
                                action={removePlanEntitlementAction}
                                label="×"
                              >
                                <input type="hidden" name="applicationId" value={appId} />
                                <input type="hidden" name="planId" value={plan.id} />
                                <input
                                  type="hidden"
                                  name="entitlementId"
                                  value={entitlement.id}
                                />
                              </InlineActionButton>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(plan.status)}>{plan.status}</Badge>
                    </Td>
                    <Td>
                      <ActionMenu label={`Actions for ${plan.name}`}>
                        <FormDialog
                          triggerLabel="Edit"
                          title={`Edit ${plan.name}`}
                          description="Update the plan details and price. Its key and billing interval stay fixed."
                          icon="edit"
                          triggerVariant="menu"
                          triggerSize="sm"
                        >
                          <ActionForm action={updatePlanAction} submitLabel="Save plan">
                            <input
                              type="hidden"
                              name="applicationId"
                              value={appId}
                            />
                            <input type="hidden" name="planId" value={plan.id} />
                            <div className="mt-4 space-y-3">
                              <Field label="Name">
                                <Input name="name" defaultValue={plan.name} required />
                              </Field>
                              <Field label="Description">
                                <Textarea
                                  name="description"
                                  rows={2}
                                  defaultValue={plan.description ?? ""}
                                />
                              </Field>
                              <div className="grid grid-cols-2 gap-3">
                                <Field label="Price">
                                  <Input
                                    name="price"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    defaultValue={(plan.priceAmountCents / 100).toFixed(2)}
                                    required
                                  />
                                </Field>
                                <Field label="Currency">
                                  <Input
                                    name="currency"
                                    defaultValue={plan.currency}
                                    maxLength={3}
                                    required
                                  />
                                </Field>
                              </div>
                              <Field label="Trial days">
                                <Input
                                  name="trialDays"
                                  type="number"
                                  min="0"
                                  defaultValue={plan.trialDays}
                                />
                              </Field>
                            </div>
                          </ActionForm>
                        </FormDialog>
                        {plan.status !== "active" ? (
                          <InlineActionButton
                            action={setPlanStatusAction}
                            label="Publish"
                            variant="menu"
                          >
                            <input type="hidden" name="applicationId" value={appId} />
                            <input type="hidden" name="planId" value={plan.id} />
                            <input type="hidden" name="status" value="active" />
                          </InlineActionButton>
                        ) : (
                          <InlineActionButton
                            action={setPlanStatusAction}
                            label="Unpublish"
                            variant="menu"
                          >
                            <input type="hidden" name="applicationId" value={appId} />
                            <input type="hidden" name="planId" value={plan.id} />
                            <input type="hidden" name="status" value="draft" />
                          </InlineActionButton>
                        )}
                        <InlineActionButton
                          action={setPlanStatusAction}
                          label="Archive"
                          variant="menuDanger"
                          confirmMessage="Archive this plan? Existing subscribers keep what they bought."
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input type="hidden" name="planId" value={plan.id} />
                          <input type="hidden" name="status" value="archived" />
                        </InlineActionButton>
                      </ActionMenu>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <FormDialog
          triggerLabel="New plan"
          title="Create a plan"
          description="Define the price, billing interval, and trial for a new subscription plan."
        >
          <ActionForm action={createPlanAction} submitLabel="Create plan">
            <input type="hidden" name="applicationId" value={appId} />
            <div className="mt-4 space-y-3">
              <Field label="Key" hint="Lowercase identifier, e.g. pro">
                <Input name="key" required placeholder="pro" />
              </Field>
              <Field label="Name">
                <Input name="name" required placeholder="Pro" />
              </Field>
              <Field label="Description">
                <Textarea name="description" rows={2} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Billing interval">
                  <Select name="billingInterval" defaultValue="month">
                    <option value="month">Monthly</option>
                    <option value="quarter">Quarterly</option>
                    <option value="year">Yearly</option>
                    <option value="one_time">One-time</option>
                  </Select>
                </Field>
                <Field label="Price" hint="In your currency, e.g. 19.00">
                  <Input name="price" type="number" step="0.01" min="0" required />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Currency">
                  <Input name="currency" defaultValue="usd" maxLength={3} />
                </Field>
                <Field label="Trial days">
                  <Input name="trialDays" type="number" min="0" defaultValue="0" />
                </Field>
              </div>
            </div>
          </ActionForm>
        </FormDialog>

        <FormDialog
          triggerLabel="Add grant"
          title="Add a plan grant"
          description="Choose a grant kind, then complete only the fields that apply to it."
          size="lg"
          triggerVariant="secondary"
        >
          <ActionForm action={addPlanEntitlementAction} submitLabel="Add grant">
            <input type="hidden" name="applicationId" value={appId} />
            <div className="mt-4 space-y-3">
              <Field label="Plan">
                <Select name="planId" required>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Kind">
                <Select name="kind" defaultValue="role">
                  <option value="role">Role</option>
                  <option value="usage_limit">Usage limit</option>
                  <option value="balance_grant">Balance grant</option>
                  <option value="permission">Permission</option>
                  <option value="feature">Feature flag</option>
                </Select>
              </Field>
              <Field label="Role (for role grants)">
                <Select name="roleId">
                  <option value="">—</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Usage item">
                  <Select name="usageItemId">
                    <option value="">—</option>
                    {usageItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Limit" hint="Blank = unlimited">
                  <Input name="limitValue" type="number" min="0" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Balance unit">
                  <Select name="unitId">
                    <option value="">—</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount per period">
                  <Input name="amount" type="number" min="1" />
                </Field>
              </div>
              <Field label="Permission key" hint="Bare key such as read:a">
                <Input name="permissionKey" placeholder="read:a" />
              </Field>
              <label className="flex items-center gap-2 text-xs text-neutral-700">
                <input type="checkbox" name="permissionAll" defaultChecked />
                Grant over all targets
              </label>
              <Field label="Target ids" hint="Comma separated, when not all">
                <Input name="permissionTargetIds" placeholder="id1,id2" />
              </Field>
            </div>
          </ActionForm>
        </FormDialog>
      </div>
    </div>
  );
}
