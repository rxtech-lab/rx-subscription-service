import { z } from "zod";

export type EligibilityMode = "all" | "any";

export function parseEligibilityMode(value: unknown = "all"): EligibilityMode {
  return z.enum(["all", "any"]).parse(value);
}

/** An empty rule set is unrestricted. Purchase limits are applied separately. */
export function combineEligibilityFailures<T>(mode: EligibilityMode, ruleCount: number, failed: T[]): T[] {
  return mode === "any" && failed.length < ruleCount ? [] : [...failed];
}
