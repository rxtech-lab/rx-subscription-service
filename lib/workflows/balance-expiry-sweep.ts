import { expireBalanceLots } from "@/lib/subscription/balance-lots";

/**
 * Expire lapsed balance lots across every user.
 *
 * The debit and read paths already sweep lazily, so a balance is never *used*
 * while stale. This job exists for the user who touches nothing: without it
 * their displayed balance and their ledger would keep showing units that
 * lapsed weeks ago, and an application reading the API would bill against a
 * number the next debit is about to correct.
 *
 * Correctness never depends on this running. If the schedule is paused the
 * lazy sweep still catches everything at the moment it matters.
 */

const BATCH_SIZE = 500;
/** Bounds one run so a large backlog cannot stall the schedule indefinitely. */
const MAX_BATCHES = 40;

async function sweepBatch(limit: number) {
  "use step";
  const result = await expireBalanceLots({ limit });
  return result;
}

export async function balanceExpirySweepWorkflow() {
  "use workflow";

  let lots = 0;
  let units = 0;

  // Drain in batches until a pass finds nothing left to expire. Each batch is
  // its own step, so a failure retries that batch rather than the whole sweep.
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const result = await sweepBatch(BATCH_SIZE);
    lots += result.lots;
    units += result.units;
    if (result.lots === 0 && result.units === 0) break;
  }

  return { lots, units };
}
