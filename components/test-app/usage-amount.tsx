"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { recordTestUsageAction } from "@/app/actions/test-usage";
import { FormDialog, useCloseFormDialog } from "@/components/ui/form-dialog";
import { Button, Field, Input } from "@/components/ui/primitives";
import { FormPendingToast } from "@/components/ui/toast";

/** What a click spends until you say otherwise. */
const DEFAULT_AMOUNT = 1;

function storageKey(appId: string, itemId: string): string {
  return `rx-test-usage-amount:${appId}:${itemId}`;
}

function parseAmount(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * The stored amounts, read through `useSyncExternalStore` so the first paint
 * matches the server's and the value settles on the client — and so a second
 * tab that changes it is picked up here too.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function storeAmount(key: string, amount: number) {
  window.localStorage.setItem(key, String(amount));
  for (const listener of listeners) listener();
}

function AmountForm({
  current,
  onSave,
}: {
  current: number;
  onSave: (amount: number) => void;
}) {
  const close = useCloseFormDialog();
  const [value, setValue] = useState(String(current));
  const parsed = parseAmount(value);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed === null) return;
        onSave(parsed);
        close?.();
      }}
    >
      <Field
        label="Amount per click"
        hint="Set it once — every later click spends this much. Remembered in this browser."
      >
        <Input
          type="number"
          min="1"
          step="1"
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        {parsed === null ? (
          <p className="mr-auto text-sm text-rose-600">
            Enter a whole number of 1 or more.
          </p>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={close ?? undefined}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={parsed === null}>
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * Spend against a usage item, in whatever size step you are testing with.
 *
 * The amount is a property of how you are poking at the limit rather than of
 * the account, so it lives in this browser: set it once, then click through it
 * as many times as the test needs without retyping.
 */
export function UsageAmountActions({
  appId,
  itemId,
  itemName,
}: {
  appId: string;
  itemId: string;
  itemName: string;
}) {
  const key = storageKey(appId, itemId);
  const stored = useSyncExternalStore(
    subscribe,
    useCallback(() => window.localStorage.getItem(key), [key]),
    () => null,
  );
  const amount = parseAmount(stored) ?? DEFAULT_AMOUNT;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={recordTestUsageAction} className="inline">
        <input type="hidden" name="usageItemId" value={itemId} />
        <input type="hidden" name="amount" value={amount} />
        <Button type="submit" size="sm" variant="secondary">
          Use {amount.toLocaleString()}
        </Button>
        <FormPendingToast message={`Recording ${amount.toLocaleString()} of ${itemName}…`} />
      </form>
      <FormDialog
        triggerLabel="Set amount"
        title={`Amount per click for ${itemName}`}
        description="How much each Use click spends against this item."
        icon="edit"
        size="sm"
        triggerVariant="ghost"
        triggerSize="sm"
      >
        <AmountForm current={amount} onSave={(next) => storeAmount(key, next)} />
      </FormDialog>
    </div>
  );
}
