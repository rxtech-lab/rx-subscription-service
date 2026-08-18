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
import { listTestUsers } from "@/lib/subscription/test-users";
import { writeToolSchemas } from "./tool-schemas";

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
        "Create a plan. Use billingInterval one_time for non-recurring purchases. Creating the plan does not grant a role; add a role entitlement separately when the plan represents an access tier.",
      inputSchema: writeToolSchemas.createPlan,
      needsApproval: true,
      execute: runWrite("createPlan"),
    }),
    updatePlan: tool({
      description: "Update a plan's name, description, price, or trial length.",
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
        "Grant something through a plan: a role, a permission, a usage limit, a balance grant, or a feature flag. Use a role grant to connect a plan to role-gated topups.",
      inputSchema: writeToolSchemas.addPlanEntitlement,
      needsApproval: true,
      execute: runWrite("addPlanEntitlement"),
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
        "Put a test user on a plan with no payment. The subscription gets the same entitlement snapshot and balance grants a real purchase would produce.",
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
  };

  return { ...readTools, ...confirmationTools, ...writeTools };
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
    "- Usage items reset by policy: `never`, `rolling_window` (from first use), `calendar_period` (snapped to clock boundaries), or `billing_period` (follows the subscription).",
    "- Before creating a topup, decide from the user's request who may buy it. Do not invent a restriction when the topup is meant for everyone or the user did not specify one.",
    "- Set `createTopup.eligibility` to `standalone` when anyone may buy it, `plan` when one specific subscribed plan is required, or `role` for an access tier shared by plans. The create tool persists that link atomically with the topup.",
    "- Use a role-gated topup only when the role represents a reusable access tier, especially when multiple plans should qualify. List roles and the relevant plan entitlements first. Reuse a matching role; create one only when the requested access model needs a new role.",
    "- A role-gated topup must be reachable: before creating the topup, ensure every qualifying plan grants that role with `addPlanEntitlement` kind `role`. Never create an orphan role or add a role gate without a granting plan unless the role is default.",
    "- Plan entitlements are snapshotted when a subscription starts. Adding a role to an existing plan does not update older subscriptions, so use a direct `requires_active_plan` rule when current subscribers to that plan must qualify immediately.",
    "- Test users are disposable users on the Test tab, for trying out the subscriber experience. They are the only users whose balances, levels, and subscriptions you can change — there is no tool that edits a real subscriber, so if asked, say so and offer a test user instead. Call `listTestUsers` for their ids; `grantTestSubscription` skips payment entirely, and their checkouts run against the Stripe sandbox.",
    "",
    "When you need the user to confirm a proposed setup or plan before proceeding, call the `confirmation` tool with only a short title and plain-language description. Never ask for confirmation in normal chat text or wait for a typed reply.",
    "The `confirmation` tool is only a simple decision prompt. It does not replace or change any write tool's own approval; after confirmation, call write tools normally and let their existing approvals work as before.",
    "If the user cancels the confirmation, acknowledge the decision and do not make any changes unless they ask again.",
    "Be concise. Report what changed, not what you are about to try.",
  ].join("\n");
}
