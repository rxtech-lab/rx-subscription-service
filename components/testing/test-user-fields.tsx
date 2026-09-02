"use client";

import { Field, Input, Select } from "@/components/ui/primitives";
import type { listRoles } from "@/lib/subscription/roles";
import type { listPurchasablePlans } from "@/lib/subscription/subscriptions";
import type { TestUserSummary } from "@/lib/subscription/test-users";
import type { listBalanceUnits } from "@/lib/subscription/units";
import type { listUsageItems } from "@/lib/subscription/usage-items";
import { formatInterval, formatMoney } from "@/lib/utils";

export type Plan = Awaited<ReturnType<typeof listPurchasablePlans>>[number];
export type Unit = Awaited<ReturnType<typeof listBalanceUnits>>[number];
export type Role = Awaited<ReturnType<typeof listRoles>>[number];
export type UsageItem = Awaited<ReturnType<typeof listUsageItems>>[number];

export function planOption(plan: Plan) {
  return `${plan.name} · ${plan.planGroup} · ${formatMoney(plan.priceAmountCents, plan.currency)} ${formatInterval(
    plan.billingInterval,
    plan.intervalCount,
  )}`;
}

export function TestUserFields({
  plans,
  units,
  roles,
  usageItems,
  user,
  roleIds = [],
}: {
  plans: Plan[];
  units: Unit[];
  roles: Role[];
  usageItems: UsageItem[];
  user?: TestUserSummary["user"];
  roleIds?: string[];
}) {
  const held = new Set(roleIds);
  return (
    <div className="space-y-4">
      <Field label="Display name">
        <Input
          name="displayName"
          required
          maxLength={120}
          defaultValue={user?.displayName ?? ""}
          placeholder="Pro subscriber"
        />
      </Field>
      <Field label="Email" hint="Optional. Used for the Stripe customer record.">
        <Input name="email" type="email" defaultValue={user?.email ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Level">
          <Input name="level" type="number" step="1" defaultValue={user?.level ?? 0} />
        </Field>
        <Field label="Level key" hint="Optional.">
          <Input name="levelKey" defaultValue={user?.levelKey ?? ""} />
        </Field>
      </div>
      <Field label="Note" hint="What this user is set up to exercise.">
        <Input
          name="note"
          maxLength={200}
          defaultValue={user?.testNote ?? ""}
          placeholder="Pro annual, low balance"
        />
      </Field>

      {roles.length > 0 ? (
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-700">Roles</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Granted directly, with no plan behind them — the way to try a
            permission-gated screen without paying for it. Roles that come with a
            subscription still apply on top.
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {roles.map((role) => (
              <label
                key={role.id}
                className="flex items-center gap-2 text-xs text-slate-700"
              >
                <input
                  type="checkbox"
                  name="roleIds"
                  value={role.id}
                  defaultChecked={held.has(role.id)}
                />
                <code className="rounded bg-slate-100 px-1.5 py-0.5">{role.key}</code>
                <span className="truncate text-slate-500">{role.title}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {user ? null : (
        <>
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-700">Starting state</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Optional. A granted plan skips checkout — it creates the subscription
              directly, with the same entitlement snapshot and balance grants a real
              purchase would produce.
            </p>
          </div>
          <Field label="Subscribe to plan">
            <Select name="planId" defaultValue="">
              <option value="">No subscription</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {planOption(plan)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starting balance unit">
              <Select name="unitId" defaultValue="">
                <option value="">None</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount">
              <Input name="amount" type="number" min="0" step="1" defaultValue={0} />
            </Field>
          </div>
          {usageItems.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Usage limit for">
                <Select name="usageItemId" defaultValue="">
                  <option value="">No override</option>
                  {usageItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Limit"
                hint="Overrides the plan allowance for this user only."
              >
                <Input name="usageLimit" type="number" min="0" step="1" />
              </Field>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
