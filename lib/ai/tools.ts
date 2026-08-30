import "server-only";
import { tool } from "ai";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Actor } from "@/lib/subscription/shared";
import { confirmationInputSchema } from "./confirmation";
import { executeWriteTool } from "./execute";
import type { WriteToolName } from "./tool-schemas";
import { listPlanEntitlements, listPlans } from "@/lib/subscription/plans";
import { getRolePermissions, listPermissions, listRoles } from "@/lib/subscription/roles";
import { listBalanceUnits, listPointRates } from "@/lib/subscription/units";
import { listUsageItems } from "@/lib/subscription/usage-items";
import { listEligibilityRules, listTopupProducts } from "@/lib/subscription/topups";
import { listSubscriptions } from "@/lib/subscription/subscriptions";
import {
  couponTerms,
  couponUsage,
  listCoupons as listApplicationCoupons,
  listCouponTargets,
  listCouponUsers,
} from "@/lib/subscription/coupons";
import { describeCoupon } from "@/lib/subscription/coupon-rules";
import { listTestUsers } from "@/lib/subscription/test-users";
import { listAppUserOptions } from "@/lib/subscription/users";
import {
  DEFAULT_ANALYTICS_DAYS,
  getApplicationAnalytics,
  listRecentPurchases,
} from "@/lib/subscription/analytics";
import { getRun, isTerminal } from "@/lib/testing/runs";
import { SDK_TYPES } from "@/lib/testing/sdk-types";
import {
  describeMissingSuite,
  listTestSuites,
  resolveTestSuite,
} from "@/lib/testing/suites";
import { uiCatalogReference, uiSpecSchema, validateUiSpec } from "./ui-catalog";
import { writeToolSchemas } from "./tool-schemas";
import { USAGE_LIMIT_PROMPT_RULES } from "./subscription-prompt-rules";
import { TEST_SUITE_EDIT_PROMPT_RULES } from "./test-suite-prompt-rules";
import { isConfigurationWriteTool } from "./configuration-write-tools";
import { scheduleAutomaticTestRuns } from "@/lib/testing/automation";

/**
 * Read tools execute immediately — they cannot change anything, and making the
 * model ask permission to look something up would be tedious.
 *
 * Confirmation and write tools carry `needsApproval`, so the SDK pauses before
 * running them and waits for the human in the panel. Execution stays on the
 * server either way: the client only sends a yes or no, never the mutation
 * itself. Pair that with `experimental_toolApprovalSecret` in the chat route and
 * a forged approval from the browser is rejected.
 */
export function buildTools(applicationId: string, actor: Actor) {
  /** Run an approved write tool through the same service layer the console uses. */
  const runWrite = (name: WriteToolName) => async (args: unknown) => {
    const outcome = await executeWriteTool({ name, args, applicationId, actor });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    if (isConfigurationWriteTool(name)) {
      await scheduleAutomaticTestRuns({
        applicationId,
        triggeredBy: actor.id,
      });
    }
    revalidatePath(`/apps/${applicationId}`, "layout");
    return { ok: true, result: outcome.result };
  };

  const readTools = {
    listPlans: tool({
      description:
        "List this application's plans, including price, interval, and status.",
      inputSchema: z.object({}),
      execute: async () => {
        const plans = await listPlans(applicationId, { includeArchived: true });
        return plans.map((plan) => ({
          id: plan.id,
          key: plan.key,
          name: plan.name,
          planGroup: plan.planGroup,
          billingInterval: plan.billingInterval,
          intervalCount: plan.intervalCount,
          priceAmountCents: plan.priceAmountCents,
          currency: plan.currency,
          trialDays: plan.trialDays,
          status: plan.status,
        }));
      },
    }),

    getPlanEntitlements: tool({
      description: "List what a specific plan grants.",
      inputSchema: z.object({ planId: z.string() }),
      execute: async ({ planId }) => listPlanEntitlements(planId),
    }),

    listRoles: tool({
      description: "List subscription roles, with their ids and keys.",
      inputSchema: z.object({}),
      execute: async () => listRoles(applicationId),
    }),

    getRolePermissions: tool({
      description:
        "Show a role's permission grants and their serialized expressions (read:a:all).",
      inputSchema: z.object({ roleId: z.string() }),
      execute: async ({ roleId }) => getRolePermissions(applicationId, roleId),
    }),

    listPermissions: tool({
      description: "List the permissions this application defines.",
      inputSchema: z.object({}),
      execute: async () => listPermissions(applicationId),
    }),

    listUsageItems: tool({
      description:
        "List metered usage items with their reset policy, limits, and overage handling.",
      inputSchema: z.object({}),
      execute: async () => listUsageItems(applicationId),
    }),

    listBalanceUnits: tool({
      description:
        "List balance units (points, credits, …) and their currency conversion rates.",
      inputSchema: z.object({}),
      execute: async () => {
        const [units, rates] = await Promise.all([
          listBalanceUnits(applicationId),
          listPointRates(applicationId),
        ]);
        return units.map((unit) => ({
          ...unit,
          rates: rates.filter((rate) => rate.unitId === unit.id),
        }));
      },
    }),

    listTopups: tool({
      description: "List topup products and the eligibility rules gating each one.",
      inputSchema: z.object({}),
      execute: async () => {
        const products = await listTopupProducts(applicationId, {
          includeArchived: true,
        });
        const withRules = [];
        for (const product of products) {
          withRules.push({
            ...product,
            eligibilityRules: await listEligibilityRules(product.id),
          });
        }
        return withRules;
      },
    }),

    listCoupons: tool({
      description:
        "List this application's coupons, including target and user restrictions, usage, validity window, and status. Call this before editing or publishing a coupon.",
      inputSchema: z.object({}),
      execute: async () => {
        const coupons = await listApplicationCoupons(applicationId, {
          includeArchived: true,
        });
        return Promise.all(
          coupons.map(async (coupon) => {
            const [targets, users, usage] = await Promise.all([
              listCouponTargets(coupon.id),
              listCouponUsers(coupon.id),
              couponUsage(coupon.id),
            ]);
            return {
              couponId: coupon.id,
              code: coupon.code,
              name: coupon.name,
              description: coupon.description,
              discountType: coupon.discountType,
              percentBasisPoints: coupon.percentBasisPoints,
              amountOffCents: coupon.amountOffCents,
              currency: coupon.currency,
              maxDiscountCents: coupon.maxDiscountCents,
              terms: describeCoupon(couponTerms(coupon)),
              duration: coupon.duration,
              durationInMonths: coupon.durationInMonths,
              appliesTo: coupon.appliesTo,
              planIds: targets
                .map((target) => target.planId)
                .filter((id): id is string => Boolean(id)),
              topupProductIds: targets
                .map((target) => target.topupProductId)
                .filter((id): id is string => Boolean(id)),
              restrictToUsers: coupon.restrictToUsers,
              allowedUsers: users.map((user) => ({
                appUserId: user.appUserId,
                displayName: user.displayName,
                email: user.email,
              })),
              maxRedemptions: coupon.maxRedemptions,
              maxRedemptionsPerUser: coupon.maxRedemptionsPerUser,
              minimumAmountCents: coupon.minimumAmountCents,
              firstTimeOnly: coupon.firstTimeOnly,
              startsAt: coupon.startsAt?.toISOString() ?? null,
              redeemBy: coupon.redeemBy?.toISOString() ?? null,
              status: coupon.status,
              usage,
            };
          }),
        );
      },
    }),

    listCouponUserOptions: tool({
      description:
        "List users that can be placed on a coupon allow-list. This is read-only; it does not edit a subscriber.",
      inputSchema: z.object({}),
      execute: async () => {
        const users = await listAppUserOptions(applicationId, { includeTest: true });
        return users.map((user) => ({
          appUserId: user.id,
          displayName: user.displayName,
          email: user.email,
          rxlabUserId: user.rxlabUserId,
          isTest: user.isTest,
        }));
      },
    }),

    listSubscriptions: tool({
      description: "List active and past subscriptions for this application.",
      inputSchema: z.object({}),
      execute: async () => listSubscriptions(applicationId),
    }),

    listTestUsers: tool({
      description:
        "List the disposable test users on the Test tab, with their subscriptions and balances. Call this to get an appUserId before editing a test user.",
      inputSchema: z.object({}),
      execute: async () => {
        const summaries = await listTestUsers(applicationId);
        return summaries.map(({ user, subscriptions, balances }) => ({
          appUserId: user.id,
          displayName: user.displayName,
          email: user.email,
          level: user.level,
          levelKey: user.levelKey,
          note: user.testNote,
          subscriptions,
          balances,
        }));
      },
    }),

    getAnalytics: tool({
      description:
        "Subscription, revenue, and user metrics for a recent date range, already bucketed by day. Use this for any 'how many' or 'how much' question, and as the data behind a chart. Amounts are integer cents in the returned currency; test users are excluded.",
      inputSchema: z.object({
        days: z
          .number()
          .int()
          .min(7)
          .max(365)
          .optional()
          .describe(`Length of the window. Defaults to ${DEFAULT_ANALYTICS_DAYS}.`),
      }),
      execute: async ({ days }) => getApplicationAnalytics(applicationId, { days }),
    }),

    listPurchases: tool({
      description:
        "List recent payments — one-time plan purchases and topups — newest first, with amounts in integer cents.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        includeTest: z
          .boolean()
          .optional()
          .describe("Include purchases made by test users. Defaults to false."),
      }),
      execute: async ({ limit, includeTest }) =>
        listRecentPurchases(applicationId, { limit, includeTest }),
    }),

    listTestSuites: tool({
      description:
        "List the automated test suites on the Test cases tab, with each one's latest result. Call this before writing or running a suite so an existing file is updated rather than duplicated.",
      inputSchema: z.object({}),
      execute: async () => {
        const suites = await listTestSuites(applicationId);
        return suites.map((suite) => ({
          suiteId: suite.id,
          name: suite.name,
          description: suite.description,
          updatedBy: suite.updatedBy,
          lastRun: suite.lastRun,
        }));
      },
    }),

    getTestSuite: tool({
      description:
        "Read one test suite's source. Accepts its id or its name; a name is matched ignoring case.",
      inputSchema: z.object({ suiteId: z.string() }),
      execute: async ({ suiteId }) => {
        const suite = await resolveTestSuite(applicationId, suiteId);
        if (!suite) return describeMissingSuite(applicationId, suiteId);
        return {
          ok: true,
          suiteId: suite.id,
          name: suite.name,
          description: suite.description,
          code: suite.code,
          lineCount: suite.code.split("\n").length,
        };
      },
    }),

    getTestRun: tool({
      description:
        "Read the outcome of a run: totals plus every test with its status and failure message. Use it after runTestSuite to report what happened.",
      inputSchema: z.object({ runId: z.string() }),
      execute: async ({ runId }) => {
        const found = await getRun(applicationId, runId);
        if (!found) return { ok: false, error: `No test run "${runId}"` };
        return {
          ok: true,
          status: found.run.status,
          total: found.run.total,
          passed: found.run.passed,
          failed: found.run.failed,
          skipped: found.run.skipped,
          durationMs: found.run.durationMs,
          error: found.run.error,
          finished: isTerminal(found.run.status),
          tests: found.cases.map((entry) => ({
            suite: entry.suiteName,
            name: entry.name,
            status: entry.status,
            durationMs: entry.durationMs,
            error: entry.error,
          })),
        };
      },
    }),
  };

  /**
   * Display tools render into the chat panel. They read nothing and change
   * nothing, so they run without approval — the worst a bad call can do is show
   * an ugly chart.
   */
  const displayTools = {
    renderUI: tool({
      description:
        "Show a chart, table, or metric panel in the chat instead of describing numbers in prose. Pass a complete json-render spec built from the component catalog in the system prompt. Prefer this whenever the answer involves a series, a breakdown, or more than about three numbers.",
      inputSchema: z.object({
        spec: uiSpecSchema.describe(
          "A json-render spec: the root element key and a flat list of elements, each with its own key, a catalog component type, its props, and the keys of its children.",
        ),
      }),
      execute: async ({ spec }) => {
        const validated = validateUiSpec(spec);
        if (!validated.ok) {
          return { ok: false, error: validated.error };
        }
        // The panel renders the spec from the tool input, so the result only
        // needs to tell the model the view is already on screen.
        return {
          ok: true,
          rendered: true,
          note: "The user can see this view. Do not repeat its numbers in text.",
        };
      },
    }),
  };

  const confirmationTools = {
    confirmation: tool({
      description:
        "Ask the user a simple yes-or-no confirmation with a concise title and description. Use this instead of asking for a typed confirmation in chat.",
      inputSchema: confirmationInputSchema,
      needsApproval: true,
      execute: async () => ({ ok: true, confirmed: true }),
    }),
  };

  const writeTools = {
    createPlan: tool({
      description:
        "Create a plan. planGroup defaults to default; users can hold only one plan per group. Use billingInterval one_time for non-recurring purchases. Creating the plan does not grant a role; add a role entitlement separately when the plan represents an access tier.",
      inputSchema: writeToolSchemas.createPlan,
      needsApproval: true,
      execute: runWrite("createPlan"),
    }),
    updatePlan: tool({
      description:
        "Update a plan's name, description, group, price, or trial length.",
      inputSchema: writeToolSchemas.updatePlan,
      needsApproval: true,
      execute: runWrite("updatePlan"),
    }),
    setPlanStatus: tool({
      description: "Publish (active), unpublish (draft), or archive a plan.",
      inputSchema: writeToolSchemas.setPlanStatus,
      needsApproval: true,
      execute: runWrite("setPlanStatus"),
    }),
    addPlanEntitlement: tool({
      description:
        "Grant something through a plan: a role, a permission, a usage limit, a balance grant, or a feature flag. Usage limits can have distinct trial and non-trial allowances. A balance grant can also carry an expiry policy so its units lapse instead of accumulating. Use a role grant to connect a plan to role-gated topups.",
      inputSchema: writeToolSchemas.addPlanEntitlement,
      needsApproval: true,
      execute: runWrite("addPlanEntitlement"),
    }),
    removePlanEntitlement: tool({
      description:
        "Remove one exact entitlement from a plan. Call getPlanEntitlements first and pass its entitlement id; use this to replace or deduplicate a grant.",
      inputSchema: writeToolSchemas.removePlanEntitlement,
      needsApproval: true,
      execute: runWrite("removePlanEntitlement"),
    }),
    createRole: tool({
      description:
        "Create a subscription role for a reusable access tier. After creating a non-default role, grant it from the relevant plan or plans before using it to gate a topup.",
      inputSchema: writeToolSchemas.createRole,
      needsApproval: true,
      execute: runWrite("createRole"),
    }),
    createPermission: tool({
      description:
        'Define a permission. Use the bare key such as "read:a" — scope suffixes are set per role.',
      inputSchema: writeToolSchemas.createPermission,
      needsApproval: true,
      execute: runWrite("createPermission"),
    }),
    setRolePermissions: tool({
      description:
        "Replace a role's permission grants. Pass every grant the role should end up with.",
      inputSchema: writeToolSchemas.setRolePermissions,
      needsApproval: true,
      execute: runWrite("setRolePermissions"),
    }),
    createBalanceUnit: tool({
      description: 'Create a balance unit such as "points" or "credits".',
      inputSchema: writeToolSchemas.createBalanceUnit,
      needsApproval: true,
      execute: runWrite("createBalanceUnit"),
    }),
    setPointRate: tool({
      description:
        "Set what a balance unit is worth: N units cost M cents in a currency.",
      inputSchema: writeToolSchemas.setPointRate,
      needsApproval: true,
      execute: runWrite("setPointRate"),
    }),
    createUsageItem: tool({
      description:
        "Create a metered usage item, including how often it resets and what happens on overage.",
      inputSchema: writeToolSchemas.createUsageItem,
      needsApproval: true,
      execute: runWrite("createUsageItem"),
    }),
    updateUsageItem: tool({
      description: "Update a usage item's limits or reset behaviour.",
      inputSchema: writeToolSchemas.updateUsageItem,
      needsApproval: true,
      execute: runWrite("updateUsageItem"),
    }),
    createTopup: tool({
      description:
        "Create a purchasable topup pack as standalone, restricted to subscribers of one plan, or restricted to users with a subscription role. The selected eligibility link is created with the pack.",
      inputSchema: writeToolSchemas.createTopup,
      needsApproval: true,
      execute: runWrite("createTopup"),
    }),
    updateTopup: tool({
      description: "Update a topup's units, price, or status.",
      inputSchema: writeToolSchemas.updateTopup,
      needsApproval: true,
      execute: runWrite("updateTopup"),
    }),
    addTopupEligibilityRule: tool({
      description:
        "Gate a topup behind subscription state. Use requires_active_plan for one specific plan, requires_any_plan for any subscriber, or requires_role for an access tier shared by plans.",
      inputSchema: writeToolSchemas.addTopupEligibilityRule,
      needsApproval: true,
      execute: runWrite("addTopupEligibilityRule"),
    }),

    createCoupon: tool({
      description:
        "Create an app-scoped coupon as a draft. Supports percentage or fixed discounts, maximum discount, recurring duration, total and per-user limits, minimum order, first-purchase-only, validity dates, selected plans/topups, and an explicit user allow-list.",
      inputSchema: writeToolSchemas.createCoupon,
      needsApproval: true,
      execute: runWrite("createCoupon"),
    }),
    updateCoupon: tool({
      description:
        "Update a coupon's terms or restrictions. Its code, discount type, and currency are immutable; create a new coupon to change those.",
      inputSchema: writeToolSchemas.updateCoupon,
      needsApproval: true,
      execute: runWrite("updateCoupon"),
    }),
    setCouponStatus: tool({
      description: "Publish (active), unpublish (draft), or archive a coupon.",
      inputSchema: writeToolSchemas.setCouponStatus,
      needsApproval: true,
      execute: runWrite("setCouponStatus"),
    }),
    deleteCoupon: tool({
      description:
        "Delete an unused coupon. Coupons with active or completed redemptions must be archived instead.",
      inputSchema: writeToolSchemas.deleteCoupon,
      needsApproval: true,
      execute: runWrite("deleteCoupon"),
    }),

    createTestUser: tool({
      description:
        "Create a disposable test user, optionally already subscribed to a plan and holding a balance. Test users are hidden from the real user list and bill against the Stripe sandbox.",
      inputSchema: writeToolSchemas.createTestUser,
      needsApproval: true,
      execute: runWrite("createTestUser"),
    }),
    updateTestUser: tool({
      description: "Update a test user's name, email, level, or note.",
      inputSchema: writeToolSchemas.updateTestUser,
      needsApproval: true,
      execute: runWrite("updateTestUser"),
    }),
    deleteTestUser: tool({
      description:
        "Delete a test user along with its subscriptions, balances, and ledger history.",
      inputSchema: writeToolSchemas.deleteTestUser,
      needsApproval: true,
      execute: runWrite("deleteTestUser"),
    }),
    grantTestSubscription: tool({
      description:
        "Put a test user on an active or trialing plan with no payment. A trialing grant uses the plan's configured trial period. The subscription gets the same entitlement snapshot and balance grants a real purchase would produce.",
      inputSchema: writeToolSchemas.grantTestSubscription,
      needsApproval: true,
      execute: runWrite("grantTestSubscription"),
    }),
    cancelTestSubscription: tool({
      description: "Cancel a test user's subscription, immediately or at period end.",
      inputSchema: writeToolSchemas.cancelTestSubscription,
      needsApproval: true,
      execute: runWrite("cancelTestSubscription"),
    }),
    adjustTestUserBalance: tool({
      description:
        "Add or remove balance units for a test user. This works on test users only.",
      inputSchema: writeToolSchemas.adjustTestUserBalance,
      needsApproval: true,
      execute: runWrite("adjustTestUserBalance"),
    }),

    saveTestSuite: tool({
      description:
        "Create a test suite or intentionally replace its whole file. Pass complete source. For a focused change to an existing suite, use editTestSuite instead.",
      inputSchema: writeToolSchemas.saveTestSuite,
      needsApproval: true,
      execute: runWrite("saveTestSuite"),
    }),
    editTestSuite: tool({
      description:
        "Incrementally edit an existing test suite with exact replacement, line-range replacement or deletion, insertion before or after a line, or an append. Read the latest source with getTestSuite first. The complete result is type-checked before it is stored.",
      inputSchema: writeToolSchemas.editTestSuite,
      needsApproval: true,
      execute: runWrite("editTestSuite"),
    }),

    runTestSuite: tool({
      description:
        "Run a test suite. The run appears live in the chat; it does not block, so call getTestRun afterwards to read the result.",
      inputSchema: writeToolSchemas.runTestSuite,
      needsApproval: true,
      execute: runWrite("runTestSuite"),
    }),
  };

  return { ...readTools, ...displayTools, ...confirmationTools, ...writeTools };
}

export function systemPrompt(application: { id: string; name: string }): string {
  return [
    `You manage subscription settings for the application "${application.name}".`,
    "",
    "How to work:",
    "- Look things up before changing them. Ids are required for most edits, so list the relevant resources first rather than guessing an id.",
    "- Prices are integer cents. $9.99 is 999. Never send a decimal.",
    "- Keys are lowercase, alphanumeric with - or _.",
    "- Permission keys are bare, like `read:a`. The `:all` or `:id1,id2` suffix is a per-role scope, not part of the key.",
    "- A quarterly plan is billingInterval `quarter`, not three months.",
    "- Every plan belongs to a `planGroup`, defaulting to `default`. A user can hold only one plan in a group, but may hold plans from different groups. Use distinct groups for plans that can be combined.",
    "- Usage items reset by policy: `never`, `rolling_window` (from first use), `calendar_period` (snapped to clock boundaries), or `billing_period` (follows the subscription).",
    "- Before creating a topup, decide from the user's request who may buy it. Do not invent a restriction when the topup is meant for everyone or the user did not specify one.",
    "- Set `createTopup.eligibility` to `standalone` when anyone may buy it, `plan` when one specific subscribed plan is required, or `role` for an access tier shared by plans. The create tool persists that link atomically with the topup.",
    "- Use a role-gated topup only when the role represents a reusable access tier, especially when multiple plans should qualify. List roles and the relevant plan entitlements first. Reuse a matching role; create one only when the requested access model needs a new role.",
    "- A role-gated topup must be reachable: before creating the topup, ensure every qualifying plan grants that role with `addPlanEntitlement` kind `role`. Never create an orphan role or add a role gate without a granting plan unless the role is default.",
    "- A balance grant accumulates for good unless it is given a `balanceExpiryPolicy`. Choose `period_end` when the user says an allowance does not roll over, `duration` with `balanceExpiryMonths` for \"points expire after N months\", and `after_plan_end` with `balanceExpiryMonths` for \"points last N months after the plan ends\". Leave it at `never` when the user did not ask for expiry.",
    "- Do not confuse a `usage_limit` with an expiring `balance_grant`. A usage limit is an allowance that refills every period and is never spendable as a stored balance; a balance grant is stored units the user draws down, which expire only if a policy says so.",
    ...USAGE_LIMIT_PROMPT_RULES,
    "- Coupons belong to this application even though Stripe coupons belong to the shared Stripe account. Checkout may expose Stripe's promotion-code box only for eligible customer-specific Promotion Codes; use these app coupon tools so each code is still validated in the current app and pinned to its products.",
    "- Always call `listCoupons` before editing, publishing, archiving, or deleting a coupon. A new coupon starts as draft; publish it with `setCouponStatus` only when the user asked for it to become redeemable.",
    "- Coupon percentages are hundredths of a percent: 2550 is 25.5%. Coupon amounts, caps, and minimums are integer cents. For a repeating coupon, set `duration` to `repeating` and provide `durationInMonths`.",
    "- For `appliesTo: selected`, list plans and topups first and pass at least one id. For `restrictToUsers: true`, call `listCouponUserOptions` and pass at least one appUserId; an empty allow-list is invalid rather than meaning everyone.",
    "- Coupon `startsAt` and `redeemBy` values are ISO 8601 instants with a timezone. `redeemBy` must be later than `startsAt` and no more than five years away.",
    "- Test users are disposable users on the Test tab, for trying out the subscriber experience. They are the only users whose balances, levels, and subscriptions you can change — there is no tool that edits a real subscriber, so if asked, say so and offer a test user instead. Call `listTestUsers` for their ids; `grantTestSubscription` skips payment entirely, and their checkouts run against the Stripe sandbox.",
    "",
    "",
    "Showing data:",
    "- `getAnalytics` returns day-bucketed series and totals; `listPurchases` returns individual payments. Money is always integer cents — divide by 100 only when writing a label.",
    "- Call `renderUI` to put a chart, table, or metric panel in the chat. Use it for anything with a time series, a breakdown, or more than about three numbers, and keep your own text to the one-sentence takeaway.",
    "- A `renderUI` spec is a root key plus a flat list of elements: `{\"root\":\"root\",\"elements\":[{\"key\":\"root\",\"type\":\"Stack\",\"props\":{},\"children\":[\"chart\"]},{\"key\":\"chart\",\"type\":\"LineChart\",\"props\":{\"title\":\"Active subscriptions\",\"series\":[{\"label\":\"Active\",\"points\":[{\"x\":\"2026-08-01\",\"y\":12}]}]},\"children\":[]}]}`.",
    "- Every element needs `key`, `type`, `props`, and `children`. Only components with [holds children] may list child keys, every child key must belong to another element, and every element must be reachable from the root.",
    "- Pass real values from a read tool. Never invent a data point, and never send an empty series.",
    "- One number is a Metric, not a chart. A date axis is a LineChart. A comparison across categories is a BarChart, horizontal when the names are long. Past about seven rows, use a Table.",
    "- Charts take at most four series; fold the rest into an Other row.",
    "",
    "Component catalog for `renderUI` (props are shown as TypeScript-style signatures; `?` marks an optional prop):",
    uiCatalogReference(),
    "",
    "Writing tests:",
    ...TEST_SUITE_EDIT_PROMPT_RULES,
    "- A suite has no imports. `suite`, `test`, `step`, `expect`, `sleep`, and `rx` are globals, declared exactly as in the reference below. Using anything not declared there fails at run time.",
    "- Wrap each meaningful phase in `step(\"...\")`. Steps are what the workflow diagram draws and what a watcher follows, so a test of three steps reads far better than one long body.",
    "- Tests must create their own users with `rx.testUsers.create()` and assert only against those. There is no way to touch a real subscriber, and a suite that depends on data someone else made will break.",
    "- Every user a run creates is deleted when it ends. Do not write cleanup code.",
    "- Read the configuration rather than assuming it: `rx.config.plans()` and friends return what this application actually has. Skip a test gracefully when the thing it needs does not exist yet.",
    "- After `runTestSuite`, the run is queued and streams into the chat on its own. Do not describe results you have not read — call `getTestRun` and report what it says, or say the run is still going.",
    "",
    "The testing API, in full (these declarations are exactly what the editor and the runtime provide):",
    SDK_TYPES.trim(),
    "",
    "When you need the user to confirm a proposed setup or plan before proceeding, call the `confirmation` tool with only a short title and plain-language description. Never ask for confirmation in normal chat text or wait for a typed reply.",
    "The `confirmation` tool is only a simple decision prompt. It does not replace or change any write tool's own approval; after confirmation, call write tools normally and let their existing approvals work as before.",
    "If the user cancels the confirmation, acknowledge the decision and do not make any changes unless they ask again.",
    "Be concise. Report what changed, not what you are about to try.",
  ].join("\n");
}
