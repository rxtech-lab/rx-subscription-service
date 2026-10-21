"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui/primitives";

export function BalanceGrantCadence() {
  const [interval, setInterval] = useState("period");
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Grant balance" hint="Recurring plans: starts at the billing period start and repeats until it ends. Expiry is separate.">
        <Select name="balanceGrantInterval" value={interval} onChange={(event) => setInterval(event.target.value)}>
          <option value="period">Per billing period</option>
          <option value="day">Per day</option>
          <option value="week">Per week</option>
          <option value="custom_days">Every X days</option>
        </Select>
      </Field>
      {interval === "custom_days" && (
        <Field label="Number of days">
          <Input name="balanceGrantIntervalDays" type="number" min="1" max="3650" step="1" required />
        </Field>
      )}
    </div>
  );
}
