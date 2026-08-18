import {
  createBalanceUnitAction,
  deleteBalanceUnitAction,
  setPointRateAction,
  updateBalanceUnitAction,
} from "@/app/actions/catalog";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu } from "@/components/ui/action-menu";
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
  Th,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { listBalanceUnits, listPointRates, NANO } from "@/lib/subscription/units";
import { formatMoney } from "@/lib/utils";

export default async function UnitsPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [units, rates] = await Promise.all([
    listBalanceUnits(appId),
    listPointRates(appId),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Balance units"
          description="What this application meters. Amounts are stored as integers, so balances never drift."
        />
        {units.length === 0 ? (
          <EmptyState
            title="No units yet"
            description="Most applications start with a single unit called points."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Unit</Th>
                <Th>Kind</Th>
                <Th>Rates</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => {
                const unitRates = rates.filter((rate) => rate.unitId === unit.id);
                return (
                  <tr key={unit.id}>
                    <Td>
                      <p className="font-medium text-neutral-900">{unit.name}</p>
                      <p className="font-mono text-xs text-neutral-500">{unit.key}</p>
                    </Td>
                    <Td>{unit.kind}</Td>
                    <Td>
                      {unitRates.length === 0 ? (
                        <span className="text-xs text-neutral-400">Not priced</span>
                      ) : (
                        <ul className="space-y-0.5 text-xs text-neutral-700">
                          {unitRates.map((rate) => (
                            <li key={rate.id}>
                              1,000 {unit.key} ={" "}
                              {formatMoney(
                                Math.round((1000 * rate.nanoMinorPerUnit) / NANO),
                                rate.currency,
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td>
                      <ActionMenu label={`Actions for ${unit.name}`}>
                        <FormDialog
                          triggerLabel="Edit"
                          title={`Edit ${unit.name}`}
                          description="Update the display details for this balance unit. Its key and kind stay fixed."
                          icon="edit"
                          triggerVariant="menu"
                          triggerSize="sm"
                        >
                          <ActionForm
                            action={updateBalanceUnitAction}
                            submitLabel="Save unit"
                          >
                            <input
                              type="hidden"
                              name="applicationId"
                              value={appId}
                            />
                            <input type="hidden" name="unitId" value={unit.id} />
                            <div className="mt-4 space-y-3">
                              <Field label="Name">
                                <Input name="name" defaultValue={unit.name} required />
                              </Field>
                              <Field label="Symbol">
                                <Input
                                  name="symbol"
                                  defaultValue={unit.symbol ?? ""}
                                  placeholder="pts"
                                />
                              </Field>
                            </div>
                          </ActionForm>
                        </FormDialog>
                        <InlineActionButton
                          action={deleteBalanceUnitAction}
                          label="Delete"
                          variant="menuDanger"
                          confirmMessage="Delete this unit? Balances and topups using it will be removed."
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input type="hidden" name="unitId" value={unit.id} />
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
          triggerLabel="New unit"
          title="Create a balance unit"
          description="Add a unit this application can grant, meter, and sell."
        >
          <ActionForm action={createBalanceUnitAction} submitLabel="Create unit">
            <input type="hidden" name="applicationId" value={appId} />
            <div className="mt-4 space-y-3">
              <Field label="Key">
                <Input name="key" required placeholder="points" />
              </Field>
              <Field label="Name">
                <Input name="name" required placeholder="Points" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Symbol">
                  <Input name="symbol" placeholder="pts" />
                </Field>
                <Field label="Kind">
                  <Select name="kind" defaultValue="points">
                    <option value="points">Points</option>
                    <option value="currency">Currency</option>
                    <option value="custom">Custom</option>
                  </Select>
                </Field>
              </div>
            </div>
          </ActionForm>
        </FormDialog>

        <FormDialog
          triggerLabel="Set rate"
          title="Set a unit rate"
          description="Set how much a quantity of units is worth. Values are stored exactly as integers."
          triggerVariant="secondary"
        >
          <ActionForm action={setPointRateAction} submitLabel="Save rate">
            <input type="hidden" name="applicationId" value={appId} />
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
              <div className="grid grid-cols-3 gap-3">
                <Field label="Units">
                  <Input name="units" type="number" min="1" defaultValue="1000" required />
                </Field>
                <Field label="Cost">
                  <Input name="price" type="number" step="0.01" min="0" required />
                </Field>
                <Field label="Currency">
                  <Input name="currency" defaultValue="usd" maxLength={3} />
                </Field>
              </div>
            </div>
          </ActionForm>
        </FormDialog>
      </div>
    </div>
  );
}
