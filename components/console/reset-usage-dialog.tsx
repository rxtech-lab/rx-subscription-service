"use client";

import { useState } from "react";
import { resetUserUsageAction } from "@/app/actions/users";
import { ActionForm } from "@/components/forms/action-form";
import { FormDialog } from "@/components/ui/form-dialog";
import { Field, Select } from "@/components/ui/primitives";

type ResetUsageDialogProps = {
  applicationId: string;
  items: { id: string; name: string }[];
} & (
  | { scope: "all" }
  | { scope: "user"; appUserId: string; environment: string }
);

export function ResetUsageDialog(props: ResetUsageDialogProps) {
  return <FormDialog triggerLabel={props.scope === "all" ? "Reset all users’ usage" : "Reset usage"} title={props.scope === "all" ? "Reset all users’ usage" : "Reset this user’s usage"} icon="edit" triggerVariant="secondary" triggerSize="sm"
    description={`Reset current usage for ${props.scope === "all" ? "all users in this application" : "this user"}. Usage history and balance charges are retained.`}>
    <ResetUsageForm {...props} />
  </FormDialog>;
}

function ResetUsageForm(props: ResetUsageDialogProps) {
  const { applicationId, items, scope: userScope } = props;
  const [selectedEnvironment, setEnvironment] = useState("production");
  const environment = props.scope === "user" ? props.environment : selectedEnvironment;
  const appUserId = props.scope === "user" ? props.appUserId : "";
  const [usageItemId, setUsageItemId] = useState("");
  const [usageScope, setUsageScope] = useState("all");
  return <ActionForm action={resetUserUsageAction} submitLabel="Confirm reset" pendingLabel="Resetting usage…">
    <input type="hidden" name="applicationId" value={applicationId} />
    <input type="hidden" name="userScope" value={userScope} />
    {props.scope === "user" && <input type="hidden" name="appUserId" value={appUserId} />}
    <div className="space-y-4">
      {props.scope === "all" ? (
        <Field label="Data environment">
          <Select name="environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
            <option value="production">Production</option>
            <option value="sandbox">Sandbox</option>
            <option value="xcode">Xcode</option>
          </Select>
        </Field>
      ) : (
        <>
          <input type="hidden" name="environment" value={environment} />
          <p className="text-sm text-slate-600">This user only · {environment}</p>
        </>
      )}
      <Field label="Usage">
        <Select name="usageScope" value={usageScope} onChange={(event) => setUsageScope(event.target.value)}>
          <option value="all">All usage items</option>
          <option value="item" disabled={items.length === 0}>Specific usage item</option>
        </Select>
      </Field>
      {usageScope === "item" && <Field label="Usage item">
        <Select name="usageItemId" value={usageItemId} onChange={(event) => setUsageItemId(event.target.value)} required>
          <option value="" disabled>Select a usage item</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>}
      <label key={`${userScope}-${usageScope}-${environment}-${appUserId}-${usageItemId}`} className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="confirmed" required className="mt-1" />
        I confirm resetting {usageScope === "all" ? "all usage items" : "the selected usage item"} for {userScope === "all" ? "all users in this application" : "this user"} in {environment}. This cannot be undone.
      </label>
    </div>
  </ActionForm>;
}
