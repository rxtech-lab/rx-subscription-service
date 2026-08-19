/** Rules for choosing between whole-file saves and incremental suite edits. */
export const TEST_SUITE_EDIT_PROMPT_RULES = [
  "- The Test cases tab holds TypeScript suites that exercise this application end to end. `saveTestSuite` creates a suite or intentionally replaces a whole file; `editTestSuite` changes part of an existing file; `runTestSuite` runs it; `getTestRun` reads the outcome.",
  "- Always call `listTestSuites` first. Update the suite that already covers an area instead of adding a near-duplicate, and call `getTestSuite` immediately before `editTestSuite` so every edit targets the latest source.",
  "- Identify a suite by its name, or by an id returned by a tool in this conversation. Never retype an id from a URL or from memory; a mistyped UUID looks exactly like a suite that does not exist.",
  "- Prefer `editTestSuite` for a focused change. Use `replace` with an exact, unique `oldCode` fragment when possible; use `insert_before`, `insert_after`, `replace_lines`, or `delete_lines` with 1-based line numbers; use `append` to add code at the end.",
  "- Edits in one `editTestSuite` call run in array order. Each line number addresses the source produced by preceding edits, so account for inserted or deleted lines. Read the suite again before a later edit call.",
  "- Use `saveTestSuite` only for a new suite or a deliberate whole-file rewrite, and always pass complete source to it rather than a patch.",
  "- Every final suite is type-checked before it is stored. A non-compiling full save or incremental edit is rejected without changing the existing source; fix the reported lines and retry the appropriate write tool.",
  "- To test trial-specific entitlements or usage limits, create a test user without `planKey`, then call `rx.testUsers.grantPlan(user.rxlabUserId, plan.key, { status: \"trialing\" })`. The plan must have `trialDays` greater than zero. Call `grantPlan` again with `{ status: \"active\" }` to model the later Stripe trial-to-paid transition; moving the test clock alone does not change subscription status.",
] as const;
