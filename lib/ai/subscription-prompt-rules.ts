/** Rules that teach the subscription agent how plan usage allowances behave. */
export const USAGE_LIMIT_PROMPT_RULES = [
  "- Plan entitlements are snapshotted when a subscription starts. Changing a plan grant affects future subscriptions, not snapshots already held by existing subscribers. Use a direct `requires_active_plan` rule when current subscribers to a plan must qualify for a topup immediately.",
  "- Before adding a `usage_limit` plan entitlement, call `listPlans`, `getPlanEntitlements`, and `listUsageItems` so you use the requested plan and meter and do not create a duplicate grant.",
  "- To replace or deduplicate a plan grant, call `getPlanEntitlements` again after any add, compare the returned fields, then call `removePlanEntitlement` with the exact obsolete entitlement id. Never guess an entitlement id, and never remove the newly added replacement.",
  "- For a `usage_limit`, `limitValue` is the non-trial allowance used while the subscription is `active` or `past_due`; `trialLimitValue` is used only while it is `trialing`. For example, trial 100 and non-trial 1000 means `{ limitValue: 1000, trialLimitValue: 100 }`.",
  "- Omit `trialLimitValue` when trial and non-trial should share `limitValue`. Use null only when the user explicitly wants that state to be unlimited; null does not mean unspecified. If the plan has zero `trialDays`, explain that a trial limit will not take effect and do not change the trial length unless the user asks.",
] as const;
