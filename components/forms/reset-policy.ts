import type { ResetPolicy } from "@/lib/db/schema";

export function resetPolicyHasInterval(resetPolicy: ResetPolicy): boolean {
  return resetPolicy === "rolling_window" || resetPolicy === "calendar_period";
}
