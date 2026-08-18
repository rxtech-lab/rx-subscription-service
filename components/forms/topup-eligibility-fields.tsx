"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui/primitives";

type EligibilityType = "standalone" | "plan" | "role";

export function TopupEligibilityFields({
  plans,
  roles,
}: {
  plans: { id: string; name: string }[];
  roles: { id: string; title: string }[];
}) {
  const [type, setType] = useState<EligibilityType>("standalone");

  return (
    <>
      <Field
        label="Who can buy it?"
        hint="Standalone topups are available without a subscription."
      >
        <Select
          name="eligibilityType"
          value={type}
          onChange={(event) => setType(event.target.value as EligibilityType)}
        >
          <option value="standalone">Anyone (standalone)</option>
          <option value="plan">Subscribers to a specific plan</option>
          <option value="role">Users with a subscription role</option>
        </Select>
      </Field>

      {type === "plan" ? (
        <Field label="Required plan" hint="The user must have this active plan.">
          <Select name="planId" defaultValue="" required>
            <option value="" disabled>
              Choose a plan
            </option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {type === "role" ? (
        <Field
          label="Required role"
          hint="A qualifying plan must grant this role to its subscribers."
        >
          <Select name="roleId" defaultValue="" required>
            <option value="" disabled>
              Choose a role
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
