"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui/primitives";
import type { ResetPolicy, ResetUnit } from "@/lib/db/schema";
import { resetPolicyHasInterval } from "./reset-policy";

export function ResetPolicyFields({
  initialPolicy = "never",
  initialIntervalCount,
  initialIntervalUnit,
}: {
  initialPolicy?: ResetPolicy;
  initialIntervalCount?: number | null;
  initialIntervalUnit?: ResetUnit | null;
}) {
  const [resetPolicy, setResetPolicy] = useState<ResetPolicy>(initialPolicy);
  const hasInterval = resetPolicyHasInterval(resetPolicy);

  return (
    <>
      <Field
        label="Reset policy"
        hint="Rolling counts from first use; calendar snaps to clock boundaries."
      >
        <Select
          name="resetPolicy"
          value={resetPolicy}
          onChange={(event) => setResetPolicy(event.target.value as ResetPolicy)}
        >
          <option value="never">Never</option>
          <option value="rolling_window">Rolling window</option>
          <option value="calendar_period">Calendar period</option>
          <option value="billing_period">Billing period</option>
        </Select>
      </Field>

      {hasInterval ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every">
            <Input
              name="resetIntervalCount"
              type="number"
              min="1"
              defaultValue={initialIntervalCount ?? undefined}
              placeholder="24"
            />
          </Field>
          <Field label="Unit">
            <Select
              name="resetIntervalUnit"
              defaultValue={initialIntervalUnit ?? ""}
              required
            >
              <option value="">—</option>
              <option value="hour">Hours</option>
              <option value="day">Days</option>
              <option value="week">Weeks</option>
              <option value="month">Months</option>
            </Select>
          </Field>
        </div>
      ) : null}
    </>
  );
}
