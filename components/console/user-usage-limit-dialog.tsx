"use client";

import { useState } from "react";
import { updateUserUsageLimitAction } from "@/app/actions/users";
import { ActionForm } from "@/components/forms/action-form";
import { FormDialog } from "@/components/ui/form-dialog";
import { Field, Input, Select } from "@/components/ui/primitives";

type Props = {
  applicationId: string;
  appUserId: string;
  userLabel: string;
  item: { itemId: string; name: string; used: number; limit: number | null; overagePolicy: string };
  override: number | null | undefined;
};

export function UserUsageLimitDialog(props: Props) {
  return <FormDialog triggerLabel="Edit limit" title={`Edit ${props.item.name} limit`}
    description="Changes apply immediately to this user only and persist across usage resets."
    icon="edit" triggerVariant="secondary" triggerSize="sm">
    <UsageLimitForm {...props} />
  </FormDialog>;
}

function UsageLimitForm({ applicationId, appUserId, userLabel, item, override }: Props) {
  const [mode, setMode] = useState(override === undefined ? "default" : override === null ? "unlimited" : "custom");
  const [limit, setLimit] = useState(String(override ?? item.limit ?? ""));
  return <ActionForm action={updateUserUsageLimitAction} submitLabel="Save limit" pendingLabel="Updating usage limit…">
    <input type="hidden" name="applicationId" value={applicationId} />
    <input type="hidden" name="appUserId" value={appUserId} />
    <input type="hidden" name="usageItemId" value={item.itemId} />
    <div className="space-y-4">
      <p className="break-words text-sm text-slate-600">{userLabel} · Used: {item.used} · Current limit: {item.limit ?? "Unlimited"}</p>
      <Field label="Limit setting">
        <Select name="mode" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="default">Use plan/default limit</option>
          <option value="custom">Custom limit for this user</option>
          <option value="unlimited">Unlimited for this user</option>
        </Select>
      </Field>
      {mode === "custom" && <>
        <Field label="Usage upper limit">
          <Input name="limitValue" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" required
            value={limit} onChange={(event) => setLimit(event.target.value)} />
        </Field>
        <p className="text-sm text-slate-500">The total allowance per usage period, including usage already recorded. Set 0 for no allowance.</p>
        {limit !== "" && Number(limit) < item.used && <p className="text-sm text-amber-700">This is below the user’s current usage. No allowance will remain until usage resets or the limit is raised.</p>}
      </>}
      {mode === "default" && <p className="text-sm text-slate-500">Removes this user’s override and restores the allowance from their plans or the usage item’s default.</p>}
      {item.overagePolicy !== "block" && <p className="text-sm text-amber-700">This item {item.overagePolicy === "allow" ? "allows usage above the limit" : "charges balance for usage above the limit"}. Its overage policy still applies.</p>}
    </div>
  </ActionForm>;
}
