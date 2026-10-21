# Top-up eligibility conditions

Each top-up stores `eligibilityMode`: `all` (AND, default) or `any` (OR).
In the top-up console, open Actions → Edit and select **Eligibility conditions**.
For Pay as you go OR Plus, keep both plan rules and choose **Any condition (OR)**.
The Requires column shows the selected mode. Create and update admin tools accept
`eligibilityMode`; omitted updates preserve the current mode.

All rule types participate in the selected mode: a particular active plan, any
active plan, or a subscription role. There is no nested grouping. An empty rule
set allows anyone. Purchase limits apply separately in both modes, and cannot be
bypassed by satisfying a condition. The same evaluator runs for the catalogue,
checkout creation, and fulfillment. Successful OR evaluation returns no failed
rules; when no alternative matches, every failed alternative is returned.

`GET /api/v1/catalog` adds `eligibilityMode` to each top-up alongside its existing
`eligible` and `blockedBy` fields. Consumers should continue to honor `eligible`.
For OR failures, `blockedBy` lists alternatives, not cumulative requirements.

Run the committed `0004_topup_eligibility_mode` migration before deploying code
that selects the new column (`bun run db:migrate` with the intended database).
It sets every existing pack to `all` to preserve access rules. After deployment,
explicitly select `any` for packs whose rules are alternatives. This change does
not modify any live product configuration or purchase a top-up.
