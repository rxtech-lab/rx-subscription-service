"use client";

import { useState } from "react";
import { grantSubscriptionAction } from "@/app/actions/subscriptions";
import { ActionForm } from "@/components/forms/action-form";
import { FormDialog } from "@/components/ui/form-dialog";
import { Field, Input, Select } from "@/components/ui/primitives";

type UserOption = {
  id: string;
  label: string;
  environment: string;
};

type PlanOption = { id: string; name: string; planGroup: string };

export function GrantSubscriptionDialog({
  applicationId, users, plans,
}: {
  applicationId: string;
  users: UserOption[];
  plans: PlanOption[];
}) {
  return (
    <FormDialog triggerLabel="Grant subscription" title="Grant a subscription" size="sm"
      description="Give complimentary plan access without charging the user. Access expires after the selected duration and does not renew.">
      <GrantForm applicationId={applicationId} users={users} plans={plans} />
    </FormDialog>
  );
}

function GrantForm({ applicationId, users, plans }: {
  applicationId: string; users: UserOption[]; plans: PlanOption[];
}) {
  const [environment, setEnvironment] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());
  const eligibleUsers = users.filter((user) => user.environment === environment);
  return (
    <ActionForm action={grantSubscriptionAction} submitLabel="Grant subscription" pendingLabel="Granting subscription…">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="operationId" value={operationId} />
      <div className="space-y-4">
        <Field label="Environment">
          <Select name="environment" required value={environment} onChange={(event) => setEnvironment(event.target.value)}>
            <option value="" disabled>Select an environment</option>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </Select>
        </Field>
        <Field label="User" hint={environment && !eligibleUsers.length ? "No users in this environment." : undefined}>
          <Select key={environment} name="appUserId" required defaultValue="">
            <option value="" disabled>Select a user</option>
            {eligibleUsers.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}
          </Select>
        </Field>
        <Field label="Plan" hint={!plans.length ? "Activate a plan without automatic free access first." : undefined}>
          <Select name="planId" required defaultValue="">
            <option value="" disabled>Select a plan</option>
            {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.planGroup}</option>)}
          </Select>
        </Field>
        <Field label="Duration (days)" hint="Starts immediately, including the plan’s configured allowances.">
          <Input name="periodDays" type="number" min={1} max={3650} step={1} required />
        </Field>
        <Field label="Reason" hint="Recorded in the audit history.">
          <Input name="reason" maxLength={500} required />
        </Field>
      </div>
    </ActionForm>
  );
}
