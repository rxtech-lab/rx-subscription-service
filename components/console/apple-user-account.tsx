import { manageAppleAccountTokenAction } from "@/app/actions/apple-accounts";
import { ActionForm } from "@/components/forms/action-form";
import { FormDialog } from "@/components/ui/form-dialog";
import { Card, CardHeader, Field, Input } from "@/components/ui/primitives";
import { getAppleUserAccount } from "@/lib/iap/apple/admin";
import { listAppleLogs } from "@/lib/iap/apple/logs";
import { AppleIapLogTable } from "./apple-iap-log-table";

export async function AppleUserAccount({ applicationId, appUserId }: { applicationId: string; appUserId: string }) {
  const [state, logs] = await Promise.all([getAppleUserAccount(applicationId, appUserId), listAppleLogs(applicationId, appUserId)]);
  return <Card>
    <CardHeader title="Apple IAP" />
    <div className="space-y-4 p-5">
      <p className="text-sm text-neutral-600">Account token · {state.environment}</p>
      <code className="block break-all text-xs">{state.account?.providerAccountToken ?? "No token bound"}</code>
      <div className="flex flex-wrap gap-2">
        {([...(state.account ? [] : ["create"]), "bind", ...(state.account ? ["remove", ...(state.environment !== "xcode" ? ["repair"] : [])] : [])] as const).map(operation => {
          const label = { create: "Create token", bind: "Bind token", remove: "Remove token", repair: "Repair Apple purchase" }[operation as "create" | "bind" | "remove" | "repair"];
          return <FormDialog key={operation} triggerLabel={label} title={label} icon="key" triggerVariant="secondary"
            description={operation === "repair" ? "Updates Apple's current and future subscription token association. Historical transactions stay unchanged. This does not grant credits or transfer existing balances." : "Changes only this user's local mapping. Removing or replacing it can make existing Apple purchases fail with unknown token; it does not cancel or reset those purchases."}>
            <ActionForm action={manageAppleAccountTokenAction} submitLabel={label}>
              <input type="hidden" name="applicationId" value={applicationId} />
              <input type="hidden" name="appUserId" value={appUserId} />
              <input type="hidden" name="environment" value={state.environment} />
              <input type="hidden" name="expectedToken" value={state.account?.providerAccountToken ?? ""} />
              <input type="hidden" name="operation" value={operation} />
              {operation === "bind" && <Field label="App account token (UUID)"><Input name="token" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></Field>}
              {operation === "repair" && <Field label="Original transaction ID"><Input name="originalTransactionId" required inputMode="numeric" pattern="[0-9]{1,32}" /></Field>}
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="acknowledged" required className="mt-1" />
                {operation === "repair" ? "I verified this purchase belongs to this login and reviewed its previous grants." : "I understand this changes only the local token mapping and may affect existing purchases."}
              </label>
            </ActionForm>
          </FormDialog>;
        })}
      </div>
      <h3 className="text-sm font-semibold">Recent IAP logs</h3>
      <p className="text-xs text-neutral-500">Latest 100 events for this user and environment. Identifiers are shown here for authorized troubleshooting. Refresh the page for new events.</p>
      <AppleIapLogTable logs={logs} />
    </div>
  </Card>;
}
