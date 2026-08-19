import "server-only";
import { z } from "zod";
import { adjustBalance, getAppUserByRxlabId } from "@/lib/subscription/users";
import { normalizeCouponCode } from "@/lib/subscription/coupon-rules";
import {
  CouponNotApplicableError,
  couponUsage,
  listCoupons,
  reserveRedemption,
  type CouponTarget,
} from "@/lib/subscription/coupons";
import {
  advanceTestUserClock,
  createTestUser,
  creditTestBalance,
  deleteTestUser,
  grantTestSubscription,
  listTestUsers,
  requireTestUser,
  setTestUserClock,
  setTestUserRoles,
  setTestUserUsageLimit,
} from "@/lib/subscription/test-users";
import { cancelSubscription, listSubscriptions } from "@/lib/subscription/subscriptions";
import { listPlans, requirePlan } from "@/lib/subscription/plans";
import { listRoles } from "@/lib/subscription/roles";
import { listBalanceUnits, getBalanceUnitByKey } from "@/lib/subscription/units";
import { getUsageItemByKey, listUsageItems } from "@/lib/subscription/usage-items";
import {
  checkTopupEligibility,
  listTopupProducts,
  requireTopupProduct,
} from "@/lib/subscription/topups";
import { NotFoundError, ValidationError, type Actor } from "@/lib/subscription/shared";
import { simulatedNow } from "@/lib/subscription/test-clock";

/**
 * The operations a running suite may perform that the public API does not
 * expose — creating a disposable user, granting a plan without paying, moving a
 * clock across a reset boundary.
 *
 * The safety property this file exists to hold: **every operation resolves its
 * target through `requireTestUser`**, which throws for anyone who is not flagged
 * `is_test`. A suite is arbitrary code and the control token travels with it, so
 * the boundary cannot be "the suite will address the right user" — it has to be
 * that naming a real subscriber fails here, server-side, the same way it does
 * for the assistant's write tools.
 */

const userRef = z.object({ rxlabUserId: z.string().min(1) });
const couponTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), id: z.string().min(1) }),
  z.object({ kind: z.literal("topup"), id: z.string().min(1) }),
]);

const schemas = {
  "config.plans": z.object({}),
  "config.topups": z.object({}),
  "config.coupons": z.object({}),
  "config.roles": z.object({}),
  "config.units": z.object({}),
  "config.usageItems": z.object({}),

  "testUser.create": z.object({
    displayName: z.string().max(120).optional(),
    email: z.string().max(200).optional(),
    note: z.string().max(200).optional(),
    level: z.number().int().optional(),
    levelKey: z.string().max(64).optional(),
    roleKeys: z.array(z.string()).optional(),
    planKey: z.string().optional(),
    unitKey: z.string().optional(),
    amount: z.number().int().optional(),
  }),
  "testUser.list": z.object({}),
  "testUser.delete": userRef,
  "testUser.grantPlan": userRef.extend({
    planKey: z.string().min(1),
    status: z.enum(["active", "trialing"]).default("active"),
  }),
  "testUser.cancelPlan": userRef.extend({
    planKey: z.string().min(1),
    immediately: z.boolean().default(true),
  }),
  "testUser.setRoles": userRef.extend({ roleKeys: z.array(z.string()) }),
  "testUser.setUsageLimit": userRef.extend({
    itemKey: z.string().min(1),
    limit: z.number().int().min(0).nullable(),
  }),
  "testUser.adjustBalance": userRef.extend({
    unitKey: z.string().min(1),
    delta: z.number().int(),
    reason: z.string().max(200).optional(),
  }),
  "testUser.buyTopup": userRef.extend({ topupKey: z.string().min(1) }),
  "testUser.setClock": userRef.extend({ offsetMs: z.number().int() }),
  "testUser.advanceClock": userRef.extend({ ms: z.number().int() }),
  "coupon.reserve": userRef.extend({
    code: z.string().min(1).max(64),
    target: couponTarget,
  }),
} as const;

export type ControlOp = keyof typeof schemas;

export function isControlOp(value: string): value is ControlOp {
  return Object.hasOwn(schemas, value);
}

/** Resolve an rxlab id to a user that is provably a test user, or fail. */
async function resolveTestUser(applicationId: string, rxlabUserId: string) {
  const user = await getAppUserByRxlabId(applicationId, rxlabUserId, {
    isTest: true,
  });
  if (!user) throw new NotFoundError("test user", rxlabUserId);
  return requireTestUser(applicationId, user.id);
}

async function requirePlanByKey(applicationId: string, key: string) {
  const plans = await listPlans(applicationId, { includeArchived: true });
  const plan = plans.find((entry) => entry.key === key);
  if (!plan) throw new NotFoundError("plan", key);
  return plan;
}

async function requireUnitByKey(applicationId: string, key: string) {
  const unit = await getBalanceUnitByKey(applicationId, key);
  if (!unit) throw new NotFoundError("balance unit", key);
  return unit;
}

async function resolveCouponTarget(
  applicationId: string,
  target: z.infer<typeof couponTarget>,
): Promise<CouponTarget> {
  return target.kind === "plan"
    ? { kind: "plan", plan: await requirePlan(applicationId, target.id) }
    : {
        kind: "topup",
        product: await requireTopupProduct(applicationId, target.id),
      };
}

function publicUser(user: {
  id: string;
  rxlabUserId: string;
  displayName: string | null;
  email: string | null;
  level: number;
}) {
  return {
    appUserId: user.id,
    rxlabUserId: user.rxlabUserId,
    displayName: user.displayName ?? "",
    email: user.email,
    level: user.level,
  };
}

export async function runControlOp(input: {
  applicationId: string;
  op: ControlOp;
  args: unknown;
  actor: Actor;
}): Promise<unknown> {
  const parsed = schemas[input.op].safeParse(input.args ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? `Invalid arguments for ${input.op}`,
    );
  }

  const applicationId = input.applicationId;
  const actor = input.actor;
  const args = parsed.data as Record<string, never>;

  switch (input.op) {
    case "config.plans": {
      const plans = await listPlans(applicationId);
      return plans.map((plan) => ({
        id: plan.id,
        key: plan.key,
        name: plan.name,
        description: plan.description,
        billingInterval: plan.billingInterval,
        intervalCount: plan.intervalCount,
        priceAmountCents: plan.priceAmountCents,
        currency: plan.currency,
        trialDays: plan.trialDays,
        status: plan.status,
      }));
    }

    case "config.topups": {
      const topups = await listTopupProducts(applicationId);
      const units = await listBalanceUnits(applicationId);
      const byId = new Map(units.map((unit) => [unit.id, unit.key]));
      return topups.map((topup) => ({
        id: topup.id,
        key: topup.key,
        name: topup.name,
        description: topup.description,
        unit: byId.get(topup.unitId) ?? null,
        amount: topup.amount,
        priceAmountCents: topup.priceAmountCents,
        currency: topup.currency,
        status: topup.status,
      }));
    }

    case "config.coupons": {
      const entries = await listCoupons(applicationId);
      return Promise.all(
        entries.map(async (coupon) => {
          const usage = await couponUsage(coupon.id);
          return {
            id: coupon.id,
            code: coupon.code,
            name: coupon.name,
            description: coupon.description,
            discountType: coupon.discountType,
            percentBasisPoints: coupon.percentBasisPoints,
            amountOffCents: coupon.amountOffCents,
            currency: coupon.currency,
            maxDiscountCents: coupon.maxDiscountCents,
            duration: coupon.duration,
            durationInMonths: coupon.durationInMonths,
            appliesTo: coupon.appliesTo,
            restrictToUsers: coupon.restrictToUsers,
            maxRedemptions: coupon.maxRedemptions,
            maxRedemptionsPerUser: coupon.maxRedemptionsPerUser,
            minimumAmountCents: coupon.minimumAmountCents,
            firstTimeOnly: coupon.firstTimeOnly,
            startsAt: coupon.startsAt?.toISOString() ?? null,
            redeemBy: coupon.redeemBy?.toISOString() ?? null,
            status: coupon.status,
            redemptionsUsed: usage.used,
            redemptionsRedeemed: usage.redeemed,
          };
        }),
      );
    }

    case "config.roles": {
      const roles = await listRoles(applicationId);
      return roles.map((role) => ({ id: role.id, key: role.key, title: role.title }));
    }

    case "config.units": {
      const units = await listBalanceUnits(applicationId);
      return units.map((unit) => ({ id: unit.id, key: unit.key, name: unit.name }));
    }

    case "config.usageItems": {
      const items = await listUsageItems(applicationId);
      return items.map((item) => ({
        id: item.id,
        key: item.key,
        name: item.name,
        defaultLimit: item.defaultLimit,
        resetPolicy: item.resetPolicy,
        resetIntervalCount: item.resetIntervalCount,
        resetIntervalUnit: item.resetIntervalUnit,
      }));
    }

    case "testUser.list": {
      const summaries = await listTestUsers(applicationId);
      return summaries.map((summary) => publicUser(summary.user));
    }

    case "testUser.create": {
      const input_ = args as unknown as z.infer<(typeof schemas)["testUser.create"]>;
      const user = await createTestUser({
        applicationId,
        actor,
        displayName: input_.displayName?.trim() || "Test user",
        email: input_.email ?? null,
        level: input_.level ?? 0,
        levelKey: input_.levelKey ?? null,
        note: input_.note ?? null,
      });

      if (input_.roleKeys?.length) {
        const roles = await listRoles(applicationId);
        const roleIds = input_.roleKeys.map((key) => {
          const role = roles.find((entry) => entry.key === key);
          if (!role) throw new NotFoundError("role", key);
          return role.id;
        });
        await setTestUserRoles({ applicationId, actor, appUserId: user.id, roleIds });
      }

      if (input_.planKey) {
        const plan = await requirePlanByKey(applicationId, input_.planKey);
        await grantTestSubscription({
          applicationId,
          actor,
          appUserId: user.id,
          planId: plan.id,
        });
      }

      if (input_.unitKey && input_.amount && input_.amount > 0) {
        const unit = await requireUnitByKey(applicationId, input_.unitKey);
        await creditTestBalance({
          applicationId,
          actor,
          appUserId: user.id,
          unitId: unit.id,
          amount: input_.amount,
        });
      }

      return publicUser(user);
    }

    case "testUser.delete": {
      const { rxlabUserId } = args as unknown as z.infer<typeof userRef>;
      const user = await resolveTestUser(applicationId, rxlabUserId);
      await deleteTestUser({ applicationId, actor, appUserId: user.id });
      return { deleted: true };
    }

    case "testUser.grantPlan": {
      const input_ = args as unknown as z.infer<(typeof schemas)["testUser.grantPlan"]>;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const plan = await requirePlanByKey(applicationId, input_.planKey);
      const subscription = await grantTestSubscription({
        applicationId,
        actor,
        appUserId: user.id,
        planId: plan.id,
        status: input_.status,
      });
      return {
        subscriptionId: subscription.id,
        planKey: plan.key,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      };
    }

    case "testUser.cancelPlan": {
      const input_ = args as unknown as z.infer<(typeof schemas)["testUser.cancelPlan"]>;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const subscriptions = await listSubscriptions(applicationId, {
        appUserId: user.id,
      });
      const match = subscriptions.find(
        (entry) =>
          entry.planKey === input_.planKey &&
          ["active", "trialing", "past_due"].includes(entry.status),
      );
      if (!match) {
        throw new NotFoundError("active subscription", input_.planKey);
      }
      await cancelSubscription({
        applicationId,
        actor,
        subscriptionId: match.id,
        immediately: input_.immediately,
      });
      return { canceled: true };
    }

    case "testUser.setRoles": {
      const input_ = args as unknown as z.infer<(typeof schemas)["testUser.setRoles"]>;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const roles = await listRoles(applicationId);
      const roleIds = input_.roleKeys.map((key) => {
        const role = roles.find((entry) => entry.key === key);
        if (!role) throw new NotFoundError("role", key);
        return role.id;
      });
      await setTestUserRoles({ applicationId, actor, appUserId: user.id, roleIds });
      return { roles: input_.roleKeys };
    }

    case "testUser.setUsageLimit": {
      const input_ = args as unknown as z.infer<
        (typeof schemas)["testUser.setUsageLimit"]
      >;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const item = await getUsageItemByKey(applicationId, input_.itemKey);
      if (!item) throw new NotFoundError("usage item", input_.itemKey);

      // `null` here means unlimited, which is a real override — clearing the
      // override entirely is what `clearTestUserUsageLimit` is for, and the SDK
      // spells that as passing `undefined`, which the schema rejects.
      await setTestUserUsageLimit({
        applicationId,
        actor,
        appUserId: user.id,
        usageItemId: item.id,
        limitValue: input_.limit,
      });
      return { limit: input_.limit };
    }

    case "testUser.adjustBalance": {
      const input_ = args as unknown as z.infer<
        (typeof schemas)["testUser.adjustBalance"]
      >;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const unit = await requireUnitByKey(applicationId, input_.unitKey);
      if (input_.delta === 0) throw new ValidationError("delta must be non-zero");

      const entry = await adjustBalance({
        applicationId,
        actor,
        appUserId: user.id,
        unitId: unit.id,
        delta: input_.delta,
        reason: input_.reason ?? "Test run adjustment",
      });
      return { balanceAfter: entry.balanceAfter };
    }

    case "testUser.buyTopup": {
      const input_ = args as unknown as z.infer<(typeof schemas)["testUser.buyTopup"]>;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const topups = await listTopupProducts(applicationId);
      const topup = topups.find((entry) => entry.key === input_.topupKey);
      if (!topup) throw new NotFoundError("topup", input_.topupKey);

      // The gate is evaluated exactly as checkout evaluates it. Skipping Stripe
      // does not mean skipping eligibility — a suite asserting that a gate holds
      // has to be asserting against the real check.
      const eligibility = await checkTopupEligibility({
        applicationId,
        topupId: topup.id,
        appUserId: user.id,
      });
      const units = await listBalanceUnits(applicationId);
      const unitKey = units.find((entry) => entry.id === topup.unitId)?.key ?? null;

      if (!eligibility.eligible) {
        return {
          eligible: false,
          credited: 0,
          unit: unitKey,
          balanceAfter: null,
          blockedBy: eligibility.failed.map((rule) => ({
            kind: rule.ruleType,
            reason: `blocked by ${rule.ruleType}`,
          })),
        };
      }

      const entry = await creditTestBalance({
        applicationId,
        actor,
        appUserId: user.id,
        unitId: topup.unitId,
        amount: topup.amount,
      });

      return {
        eligible: true,
        credited: topup.amount,
        unit: unitKey,
        balanceAfter: entry.balanceAfter,
        blockedBy: null,
      };
    }

    case "testUser.setClock": {
      const input_ = args as unknown as z.infer<(typeof schemas)["testUser.setClock"]>;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const updated = await setTestUserClock({
        applicationId,
        actor,
        appUserId: user.id,
        offsetMs: input_.offsetMs,
      });
      return {
        offsetMs: updated.testClockOffsetMs,
        now: simulatedNow(updated.testClockOffsetMs).toISOString(),
      };
    }

    case "testUser.advanceClock": {
      const input_ = args as unknown as z.infer<
        (typeof schemas)["testUser.advanceClock"]
      >;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const updated = await advanceTestUserClock({
        applicationId,
        actor,
        appUserId: user.id,
        byMs: input_.ms,
      });
      return {
        offsetMs: updated.testClockOffsetMs,
        now: simulatedNow(updated.testClockOffsetMs).toISOString(),
      };
    }

    case "coupon.reserve": {
      const input_ = args as unknown as z.infer<(typeof schemas)["coupon.reserve"]>;
      const user = await resolveTestUser(applicationId, input_.rxlabUserId);
      const target = await resolveCouponTarget(applicationId, input_.target);
      const code = normalizeCouponCode(input_.code);

      try {
        const reservation = await reserveRedemption({
          applicationId,
          appUserId: user.id,
          code,
          target,
        });
        return {
          reserved: true,
          reservationId: reservation.redemption.id,
          code: reservation.coupon.code,
          reason: null,
          blockers: [],
          discountCents: reservation.evaluation.discountCents,
          totalCents: reservation.evaluation.totalCents,
          currency: reservation.evaluation.currency,
          capped: reservation.evaluation.capped,
        };
      } catch (error) {
        if (!(error instanceof CouponNotApplicableError)) throw error;
        return {
          reserved: false,
          reservationId: null,
          code,
          reason: error.message,
          blockers: error.blockers,
          discountCents: 0,
          totalCents: null,
          currency: null,
          capped: false,
        };
      }
    }
  }
}
