import {
  addEligibilityRuleAction,
  createTopupAction,
  deleteTopupAction,
  removeEligibilityRuleAction,
  setTopupStatusAction,
  updateTopupAction,
} from "@/app/actions/catalog";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { TopupEligibilityFields } from "@/components/forms/topup-eligibility-fields";
import { ActionMenu, ActionMenuDivider } from "@/components/ui/action-menu";
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
import { listPlans } from "@/lib/subscription/plans";
import { listRoles } from "@/lib/subscription/roles";
import { listEligibilityRules, listTopupProducts } from "@/lib/subscription/topups";
import { listBalanceUnits } from "@/lib/subscription/units";
import { formatMoney } from "@/lib/utils";

export default async function TopupsPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [topups, units, plans, roles] = await Promise.all([
    listTopupProducts(appId, { includeArchived: true }),
    listBalanceUnits(appId),
    listPlans(appId),
    listRoles(appId),
  ]);

  const rulesByTopup = new Map(
    await Promise.all(
      topups.map(
        async (topup) => [topup.id, await listEligibilityRules(topup.id)] as const,
      ),
    ),
  );

  const unitKey = (id: string) => units.find((unit) => unit.id === id)?.key ?? id;
  const planName = (id: string | null) =>
    plans.find((plan) => plan.id === id)?.name ?? id;
  const roleTitle = (id: string | null) =>
    roles.find((role) => role.id === id)?.title ?? id;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Topups"
          description="Extra balance to buy. Eligibility rules are checked at checkout and again when payment settles."
        />
        {topups.length === 0 ? (
          <EmptyState
            title="No topups yet"
            description="Create a pack below. You will need a balance unit first."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Pack</Th>
                <Th>Grants</Th>
                <Th>Price</Th>
                <Th>Requires</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {topups.map((topup) => {
                const rules = rulesByTopup.get(topup.id) ?? [];
                return (
                  <tr key={topup.id}>
                    <Td>
                      <p className="font-medium text-neutral-900">{topup.name}</p>
                      <p className="font-mono text-xs text-neutral-500">{topup.key}</p>
                    </Td>
                    <Td>
                      {topup.amount.toLocaleString("en-US")} {unitKey(topup.unitId)}
                    </Td>
                    <Td>{formatMoney(topup.priceAmountCents, topup.currency)}</Td>
                    <Td>
                      {rules.length === 0 ? (
                        <span className="text-xs text-neutral-400">Anyone</span>
                      ) : (
                        <ul className="space-y-1">
                          {rules.map((rule) => (
                            <li key={rule.id} className="flex items-center gap-2">
                              <span className="text-xs text-neutral-700">
                                {rule.ruleType === "requires_any_plan"
                                  ? "any active plan"
                                  : rule.ruleType === "requires_active_plan"
                                    ? `plan: ${planName(rule.planId)}`
                                    : `role: ${roleTitle(rule.roleId)}`}
                              </span>
                              <InlineActionButton
                                action={removeEligibilityRuleAction}
                                label="×"
                              >
                                <input type="hidden" name="applicationId" value={appId} />
                                <input type="hidden" name="topupId" value={topup.id} />
                                <input type="hidden" name="ruleId" value={rule.id} />
                              </InlineActionButton>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(topup.status)}>{topup.status}</Badge>
                    </Td>
                    <Td>
                      <ActionMenu label={`Actions for ${topup.name}`}>
                        <FormDialog
                          triggerLabel="Edit"
                          title={`Edit ${topup.name}`}
                          description="Update the pack details, amount, and price. Its key and balance unit stay fixed."
                          icon="edit"
                          triggerVariant="menu"
                          triggerSize="sm"
                        >
                          <ActionForm action={updateTopupAction} submitLabel="Save topup">
                            <input
                              type="hidden"
                              name="applicationId"
                              value={appId}
                            />
                            <input type="hidden" name="topupId" value={topup.id} />
                            <div className="mt-4 space-y-3">
                              <Field label="Name">
                                <Input name="name" defaultValue={topup.name} required />
                              </Field>
                              <Field label="Description">
                                <Textarea
                                  name="description"
                                  rows={2}
                                  defaultValue={topup.description ?? ""}
                                />
                              </Field>
                              <Field label="Units granted">
                                <Input
                                  name="amount"
                                  type="number"
                                  min="1"
                                  defaultValue={topup.amount}
                                  required
                                />
                              </Field>
                              <div className="grid grid-cols-3 gap-3">
                                <Field label="Price">
                                  <Input
                                    name="price"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    defaultValue={(
                                      topup.priceAmountCents / 100
                                    ).toFixed(2)}
                                    required
                                  />
                                </Field>
                                <Field label="Currency">
                                  <Input
                                    name="currency"
                                    defaultValue={topup.currency}
                                    maxLength={3}
                                    required
                                  />
                                </Field>
                                <Field label="Max per user">
                                  <Input
                                    name="maxPurchasesPerUser"
                                    type="number"
                                    min="1"
                                    defaultValue={
                                      topup.maxPurchasesPerUser ?? undefined
                                    }
                                  />
                                </Field>
                              </div>
                            </div>
                          </ActionForm>
                        </FormDialog>
                        <InlineActionButton
                          action={setTopupStatusAction}
                          label={topup.status === "active" ? "Unpublish" : "Publish"}
                          variant="menu"
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input type="hidden" name="topupId" value={topup.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={topup.status === "active" ? "draft" : "active"}
                          />
                        </InlineActionButton>

                        <ActionMenuDivider />

                        <InlineActionButton
                          action={deleteTopupAction}
                          label="Delete"
                          variant="menuDanger"
                          confirmMessage="Delete this topup?"
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input type="hidden" name="topupId" value={topup.id} />
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
          triggerLabel="New topup"
          title="Create a topup"
          description="Create a standalone pack or require a subscribed plan or subscription role."
          size="lg"
        >
          <ActionForm action={createTopupAction} submitLabel="Create topup">
            <input type="hidden" name="applicationId" value={appId} />
            <div className="mt-4 space-y-3">
              <Field label="Key">
                <Input name="key" required placeholder="points_5000" />
              </Field>
              <Field label="Name">
                <Input name="name" required placeholder="5,000 points" />
              </Field>
              <Field label="Description">
                <Textarea name="description" rows={2} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Unit">
                  <Select name="unitId" required>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Units granted">
                  <Input name="amount" type="number" min="1" required />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Price">
                  <Input name="price" type="number" step="0.01" min="0" required />
                </Field>
                <Field label="Currency">
                  <Input name="currency" defaultValue="usd" maxLength={3} />
                </Field>
                <Field label="Max per user">
                  <Input name="maxPurchasesPerUser" type="number" min="1" />
                </Field>
              </div>
              <TopupEligibilityFields
                plans={plans.map(({ id, name }) => ({ id, name }))}
                roles={roles.map(({ id, title }) => ({ id, title }))}
              />
            </div>
          </ActionForm>
        </FormDialog>

        <FormDialog
          triggerLabel="Add eligibility rule"
          title="Gate a topup"
          description="Rules are combined with AND. A user must satisfy all of them to buy."
          triggerVariant="secondary"
        >
          <ActionForm action={addEligibilityRuleAction} submitLabel="Add rule">
            <input type="hidden" name="applicationId" value={appId} />
            <div className="mt-4 space-y-3">
              <Field label="Topup">
                <Select name="topupId" required>
                  {topups.map((topup) => (
                    <option key={topup.id} value={topup.id}>
                      {topup.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Rule">
                <Select name="ruleType" defaultValue="requires_any_plan">
                  <option value="requires_any_plan">Has any active plan</option>
                  <option value="requires_active_plan">Has a specific plan</option>
                  <option value="requires_role">Has a role</option>
                </Select>
              </Field>
              <Field label="Plan (for specific-plan rules)">
                <Select name="planId">
                  <option value="">—</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Role (for role rules)">
                <Select name="roleId">
                  <option value="">—</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.title}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </ActionForm>
        </FormDialog>
      </div>
    </div>
  );
}
