import "server-only";
import type { Actor } from "@/lib/subscription/shared";
import {
  addPlanEntitlement,
  createPlan,
  removePlanEntitlement,
  setPlanStatus,
  updatePlan,
} from "@/lib/subscription/plans";
import {
  createPermission,
  createRole,
  setRolePermissions,
} from "@/lib/subscription/roles";
import {
  createCoupon,
  deleteCoupon,
  setCouponStatus,
  updateCoupon,
} from "@/lib/subscription/coupons";
import { createBalanceUnit, setPointRate } from "@/lib/subscription/units";
import { createUsageItem, updateUsageItem } from "@/lib/subscription/usage-items";
import {
  addEligibilityRule,
  createTopupProduct,
  updateTopupProduct,
} from "@/lib/subscription/topups";
import { cancelSubscription } from "@/lib/subscription/subscriptions";
import {
  createTestUser,
  creditTestBalance,
  deleteTestUser,
  grantTestSubscription,
  requireTestUser,
  updateTestUser,
} from "@/lib/subscription/test-users";
import { adjustBalance } from "@/lib/subscription/users";
import { queueTestRun } from "@/lib/testing/runner";
import {
  createTestSuite,
  describeMissingSuite,
  editTestSuite,
  resolveTestSuite,
  updateTestSuite,
} from "@/lib/testing/suites";
import { writeToolSchemas, type WriteToolName } from "./tool-schemas";

/**
 * Apply an approved write tool call.
 *
 * The model never reaches this directly: the chat route defines write tools
 * without an executor, the panel asks the human to approve, and only then does a
 * server action call in here. Input is re-validated against the same schema, and
 * `applicationId` comes from the authorized session — never from the model.
 */
export async function executeWriteTool(input: {
  name: WriteToolName;
  args: unknown;
  applicationId: string;
  actor: Actor;
}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const schema = writeToolSchemas[input.name];
  const parsed = schema.safeParse(input.args);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const applicationId = input.applicationId;
  const actor = input.actor;

  try {
    switch (input.name) {
      case "createPlan": {
        const args = parsed.data as typeof writeToolSchemas.createPlan._output;
        return { ok: true, result: await createPlan({ applicationId, actor, ...args }) };
      }
      case "updatePlan": {
        const args = parsed.data as typeof writeToolSchemas.updatePlan._output;
        return { ok: true, result: await updatePlan({ applicationId, actor, ...args }) };
      }
      case "setPlanStatus": {
        const args = parsed.data as typeof writeToolSchemas.setPlanStatus._output;
        return {
          ok: true,
          result: await setPlanStatus({ applicationId, actor, ...args }),
        };
      }
      case "createCoupon": {
        const args = parsed.data as typeof writeToolSchemas.createCoupon._output;
        return {
          ok: true,
          result: await createCoupon({
            applicationId,
            actor,
            ...args,
            startsAt: args.startsAt ? new Date(args.startsAt) : null,
            redeemBy: args.redeemBy ? new Date(args.redeemBy) : null,
          }),
        };
      }
      case "updateCoupon": {
        const args = parsed.data as typeof writeToolSchemas.updateCoupon._output;
        return {
          ok: true,
          result: await updateCoupon({
            applicationId,
            actor,
            ...args,
            startsAt:
              args.startsAt === undefined
                ? undefined
                : args.startsAt === null
                  ? null
                  : new Date(args.startsAt),
            redeemBy:
              args.redeemBy === undefined
                ? undefined
                : args.redeemBy === null
                  ? null
                  : new Date(args.redeemBy),
          }),
        };
      }
      case "setCouponStatus": {
        const args = parsed.data as typeof writeToolSchemas.setCouponStatus._output;
        return {
          ok: true,
          result: await setCouponStatus({ applicationId, actor, ...args }),
        };
      }
      case "deleteCoupon": {
        const args = parsed.data as typeof writeToolSchemas.deleteCoupon._output;
        await deleteCoupon({ applicationId, actor, ...args });
        return { ok: true, result: { deleted: true, couponId: args.couponId } };
      }
      case "addPlanEntitlement": {
        const args = parsed.data as typeof writeToolSchemas.addPlanEntitlement._output;
        return {
          ok: true,
          result: await addPlanEntitlement({ applicationId, actor, ...args }),
        };
      }
      case "removePlanEntitlement": {
        const args =
          parsed.data as typeof writeToolSchemas.removePlanEntitlement._output;
        await removePlanEntitlement({ applicationId, actor, ...args });
        return {
          ok: true,
          result: { removed: true, entitlementId: args.entitlementId },
        };
      }
      case "createRole": {
        const args = parsed.data as typeof writeToolSchemas.createRole._output;
        return { ok: true, result: await createRole({ applicationId, actor, ...args }) };
      }
      case "createPermission": {
        const args = parsed.data as typeof writeToolSchemas.createPermission._output;
        return {
          ok: true,
          result: await createPermission({ applicationId, actor, ...args }),
        };
      }
      case "setRolePermissions": {
        const args = parsed.data as typeof writeToolSchemas.setRolePermissions._output;
        return {
          ok: true,
          result: await setRolePermissions({ applicationId, actor, ...args }),
        };
      }
      case "createBalanceUnit": {
        const args = parsed.data as typeof writeToolSchemas.createBalanceUnit._output;
        return {
          ok: true,
          result: await createBalanceUnit({ applicationId, actor, ...args }),
        };
      }
      case "setPointRate": {
        const args = parsed.data as typeof writeToolSchemas.setPointRate._output;
        return {
          ok: true,
          result: await setPointRate({ applicationId, actor, ...args }),
        };
      }
      case "createUsageItem": {
        const args = parsed.data as typeof writeToolSchemas.createUsageItem._output;
        return {
          ok: true,
          result: await createUsageItem({ applicationId, actor, ...args }),
        };
      }
      case "updateUsageItem": {
        const args = parsed.data as typeof writeToolSchemas.updateUsageItem._output;
        return {
          ok: true,
          result: await updateUsageItem({ applicationId, actor, ...args }),
        };
      }
      case "createTopup": {
        const args = parsed.data as typeof writeToolSchemas.createTopup._output;
        return {
          ok: true,
          result: await createTopupProduct({ applicationId, actor, ...args }),
        };
      }
      case "updateTopup": {
        const args = parsed.data as typeof writeToolSchemas.updateTopup._output;
        return {
          ok: true,
          result: await updateTopupProduct({ applicationId, actor, ...args }),
        };
      }
      case "addTopupEligibilityRule": {
        const args =
          parsed.data as typeof writeToolSchemas.addTopupEligibilityRule._output;
        return {
          ok: true,
          result: await addEligibilityRule({ applicationId, actor, ...args }),
        };
      }

      // Test-user tools. Every one resolves its `appUserId` through
      // `requireTestUser`, so an approved call naming a real subscriber is
      // rejected here rather than mutating a live account.
      case "createTestUser": {
        const { planId, unitId, amount, ...rest } =
          parsed.data as typeof writeToolSchemas.createTestUser._output;
        const user = await createTestUser({ applicationId, actor, ...rest });
        const subscription = planId
          ? await grantTestSubscription({
              applicationId,
              actor,
              appUserId: user.id,
              planId,
            })
          : null;
        if (unitId && amount) {
          await creditTestBalance({
            applicationId,
            actor,
            appUserId: user.id,
            unitId,
            amount,
          });
        }
        return { ok: true, result: { user, subscription } };
      }
      case "updateTestUser": {
        const args = parsed.data as typeof writeToolSchemas.updateTestUser._output;
        return {
          ok: true,
          result: await updateTestUser({ applicationId, actor, ...args }),
        };
      }
      case "deleteTestUser": {
        const args = parsed.data as typeof writeToolSchemas.deleteTestUser._output;
        return {
          ok: true,
          result: await deleteTestUser({ applicationId, actor, ...args }),
        };
      }
      case "grantTestSubscription": {
        const args =
          parsed.data as typeof writeToolSchemas.grantTestSubscription._output;
        return {
          ok: true,
          result: await grantTestSubscription({ applicationId, actor, ...args }),
        };
      }
      case "cancelTestSubscription": {
        const args =
          parsed.data as typeof writeToolSchemas.cancelTestSubscription._output;
        await requireTestUser(applicationId, args.appUserId);
        return {
          ok: true,
          result: await cancelSubscription({
            applicationId,
            actor,
            subscriptionId: args.subscriptionId,
            immediately: args.immediately,
          }),
        };
      }
      case "adjustTestUserBalance": {
        const args =
          parsed.data as typeof writeToolSchemas.adjustTestUserBalance._output;
        await requireTestUser(applicationId, args.appUserId);
        return {
          ok: true,
          result: await adjustBalance({ applicationId, actor, ...args }),
        };
      }

      case "saveTestSuite": {
        const args = parsed.data as typeof writeToolSchemas.saveTestSuite._output;
        if (args.suiteId) {
          const updated = await updateTestSuite({
            applicationId,
            actor,
            suiteId: args.suiteId,
            name: args.name,
            description: args.description ?? null,
            code: args.code,
          });
          return { ok: true, result: { suiteId: updated.id, name: updated.name } };
        }
        const created = await createTestSuite({
          applicationId,
          actor,
          name: args.name,
          description: args.description ?? null,
          code: args.code,
        });
        return { ok: true, result: { suiteId: created.id, name: created.name } };
      }

      case "editTestSuite": {
        const args = parsed.data as typeof writeToolSchemas.editTestSuite._output;
        const suite = await resolveTestSuite(applicationId, args.suiteId);
        if (!suite) {
          const missing = await describeMissingSuite(applicationId, args.suiteId);
          return {
            ok: false,
            error: `${missing.error}${
              missing.available.length > 0
                ? ` Available: ${missing.available
                    .map((entry) => `${entry.name} (${entry.suiteId})`)
                    .join(", ")}`
                : ""
            }`,
          };
        }
        const updated = await editTestSuite({
          applicationId,
          actor,
          suiteId: suite.id,
          edits: args.edits,
        });
        return {
          ok: true,
          result: {
            suiteId: updated.id,
            name: updated.name,
            appliedEdits: args.edits.length,
            lineCount: updated.code.split("\n").length,
          },
        };
      }

      case "runTestSuite": {
        const args = parsed.data as typeof writeToolSchemas.runTestSuite._output;
        // The model works in names as readily as ids, and refusing a name it
        // just read back from `listTestSuites` would be pointless friction.
        const suite = await resolveTestSuite(applicationId, args.suiteId);
        if (!suite) {
          const missing = await describeMissingSuite(applicationId, args.suiteId);
          return {
            ok: false,
            error: `${missing.error}${
              missing.available.length > 0
                ? ` Available: ${missing.available
                    .map((entry) => `${entry.name} (${entry.suiteId})`)
                    .join(", ")}`
                : ""
            }`,
          };
        }

        const run = await queueTestRun({
          applicationId,
          suiteId: suite.id,
          trigger: "ai",
          triggeredBy: actor.id,
          conversationId: actor.conversationId ?? null,
        });
        // Only queued: the card rendered in the chat starts it and follows it,
        // so the model is not holding a turn open for the length of a run.
        return {
          ok: true,
          result: {
            runId: run.id,
            suiteId: suite.id,
            suiteName: suite.name,
            status: "queued",
            note: "The run is shown live in the chat. Call getTestRun for the outcome once it finishes.",
          },
        };
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "ValidationError" || error.name === "NotFoundError") {
        return { ok: false, error: error.message };
      }
    }
    console.error(`AI tool ${input.name} failed:`, error);
    return { ok: false, error: "The change could not be applied." };
  }
}
