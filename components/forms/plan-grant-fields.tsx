"use client";

import { useState, type ReactNode } from "react";
import { Field, Input, Select } from "@/components/ui/primitives";

/** Each grant kind gets its own fields inside the dedicated grant dialog. */
export function PlanGrantFields({ role, usage, balance, permission }: {
  role: ReactNode; usage: ReactNode; balance: ReactNode; permission: ReactNode;
}) {
  const [kind, setKind] = useState("role");
  return <>
    <Field label="Kind">
      <Select name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="role">Role</option>
        <option value="usage_limit">Usage limit</option>
        <option value="balance_grant">Balance grant</option>
        <option value="permission">Permission</option>
        <option value="feature">Feature flag</option>
      </Select>
    </Field>
    {kind === "role" && role}
    {kind === "usage_limit" && usage}
    {kind === "balance_grant" && balance}
    {kind === "permission" && permission}
    {kind === "feature" && <>
      <Field label="Feature key"><Input name="featureKey" required /></Field>
      <Field label="Feature value" hint="Blank = on"><Input name="featureValue" /></Field>
    </>}
  </>;
}
