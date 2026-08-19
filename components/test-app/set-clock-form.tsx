"use client";

import { useState } from "react";
import { setTestClockAction } from "@/app/actions/test-usage";
import { Button, Input } from "@/components/ui/primitives";
import { FormPendingToast } from "@/components/ui/toast";

/** `datetime-local` text ("2026-08-20T09:30") as epoch milliseconds, or null. */
function toEpochMs(value: string): number | null {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Jump the simulated clock to an exact moment.
 *
 * The conversion happens here rather than on the server because a
 * `datetime-local` field carries no timezone: the same text means different
 * instants in the browser's zone and the server's. Resolving it in the browser
 * and posting epoch milliseconds means the moment picked is the moment set.
 */
export function SetClockForm() {
  // Starts empty rather than at the current time: a value rendered on the
  // server would be written in the server's zone and read in the browser's.
  const [value, setValue] = useState("");
  const atMs = toEpochMs(value);

  return (
    <form action={setTestClockAction} className="flex flex-wrap items-end gap-2">
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-slate-700">Set the clock to</span>
        <Input
          type="datetime-local"
          name="at"
          value={value}
          className="w-auto"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <input type="hidden" name="atMs" value={atMs ?? ""} />
      <Button type="submit" size="sm" variant="secondary" disabled={atMs === null}>
        Set time
      </Button>
      <FormPendingToast message="Setting the clock…" />
    </form>
  );
}
