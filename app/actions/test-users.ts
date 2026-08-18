"use server";

import { cancelSubscription } from "@/lib/subscription/subscriptions";
import {
  clearTestUserUsageLimit,
  createTestUser,
  creditTestBalance,
  deleteTestUser,
  grantTestSubscription,
  requireTestUser,
  setTestUserRoles,
  setTestUserUsageLimit,
  updateTestUser,
} from "@/lib/subscription/test-users";
import { resetUsageCounter } from "@/lib/subscription/usage";
import { adjustBalance } from "@/lib/subscription/users";
import {
  checkbox,
  integer,
  optionalInteger,
  optionalText,
  revalidateApp,
  text,
  textList,
  toActionState,
  withApplication,
  type ActionState,
} from "./shared";

/**
 * Create a test user and optionally put it straight into the state you want to
 * exercise — on a plan, holding a balance — so the storefront is useful on the
 * first click rather than after three more forms.
 */
export async function createTestUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      const user = await createTestUser({
        applicationId,
        displayName: text(formData, "displayName"),
        email: optionalText(formData, "email"),
        level: integer(formData, "level", 0),
        levelKey: optionalText(formData, "levelKey"),
        note: optionalText(formData, "note"),
        actor,
      });

      const planId = optionalText(formData, "planId");
      if (planId) {
        await grantTestSubscription({
          applicationId,
          appUserId: user.id,
          planId,
          actor,
        });
      }

      const unitId = optionalText(formData, "unitId");
      const amount = integer(formData, "amount", 0);
      if (unitId && amount > 0) {
        await creditTestBalance({
          applicationId,
          appUserId: user.id,
          unitId,
          amount,
          actor,
        });
      }

      await setTestUserRoles({
        applicationId,
        appUserId: user.id,
        roleIds: textList(formData, "roleIds"),
        actor,
      });

      const usageItemId = optionalText(formData, "usageItemId");
      const usageLimit = optionalInteger(formData, "usageLimit");
      if (usageItemId && usageLimit !== null) {
        await setTestUserUsageLimit({
          applicationId,
          appUserId: user.id,
          usageItemId,
          limitValue: usageLimit,
          actor,
        });
      }
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "test");
  revalidateApp(applicationId, "subscriptions");
  return { success: "Test user created." };
}

export async function updateTestUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      const appUserId = text(formData, "appUserId");
      await updateTestUser({
        applicationId,
        appUserId,
        displayName: text(formData, "displayName"),
        email: optionalText(formData, "email"),
        level: integer(formData, "level", 0),
        levelKey: optionalText(formData, "levelKey"),
        note: optionalText(formData, "note"),
        actor,
      });
      // The edit form renders the full role list with the held ones checked, so
      // an empty submission means "no roles", not "leave them alone".
      await setTestUserRoles({
        applicationId,
        appUserId,
        roleIds: textList(formData, "roleIds"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "test");
  return { success: "Test user updated." };
}

export async function grantTestSubscriptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await grantTestSubscription({
        applicationId,
        appUserId: text(formData, "appUserId"),
        planId: text(formData, "planId"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "test");
  revalidateApp(applicationId, "subscriptions");
  return { success: "Subscription granted." };
}

export async function adjustTestBalanceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      const appUserId = text(formData, "appUserId");
      // Guard first, then reuse the ordinary adjustment so the ledger entry and
      // audit row look exactly like a real correction.
      await requireTestUser(applicationId, appUserId);
      await adjustBalance({
        applicationId,
        appUserId,
        unitId: text(formData, "unitId"),
        delta: integer(formData, "delta", 0),
        reason: text(formData, "reason") || "Test adjustment",
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "test");
  return { success: "Balance adjusted." };
}

/**
 * Pin, unlimit, or drop a test user's allowance for one usage item.
 *
 * `limitMode` keeps the three outcomes apart that a lone number field cannot
 * express: a finite limit, unlimited, and "no override — use the plan".
 */
export async function setTestUserUsageLimitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  const mode = text(formData, "limitMode") || "limited";
  try {
    await withApplication(applicationId, async ({ actor }) => {
      const appUserId = text(formData, "appUserId");
      const usageItemId = text(formData, "usageItemId");
      if (mode === "default") {
        await clearTestUserUsageLimit({
          applicationId,
          appUserId,
          usageItemId,
          actor,
        });
        return;
      }
      await setTestUserUsageLimit({
        applicationId,
        appUserId,
        usageItemId,
        limitValue: mode === "unlimited" ? null : integer(formData, "limitValue", 0),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "test");
  return {
    success: mode === "default" ? "Override removed." : "Usage limit set.",
  };
}

export async function clearTestUserUsageLimitAction(
  formData: FormData,
): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await clearTestUserUsageLimit({
      applicationId,
      appUserId: text(formData, "appUserId"),
      usageItemId: text(formData, "usageItemId"),
      actor,
    });
  });
  revalidateApp(applicationId, "test");
}

export async function deleteTestUserAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await deleteTestUser({
      applicationId,
      appUserId: text(formData, "appUserId"),
      actor,
    });
  });
  revalidateApp(applicationId, "test");
  revalidateApp(applicationId, "subscriptions");
}

export async function cancelTestSubscriptionAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await requireTestUser(applicationId, text(formData, "appUserId"));
    await cancelSubscription({
      applicationId,
      subscriptionId: text(formData, "subscriptionId"),
      immediately: checkbox(formData, "immediately"),
      actor,
    });
  });
  revalidateApp(applicationId, "test");
  revalidateApp(applicationId, "subscriptions");
}

export async function resetTestUsageAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await requireTestUser(applicationId, text(formData, "appUserId"));
    await resetUsageCounter({
      applicationId,
      appUserId: text(formData, "appUserId"),
      usageItemId: text(formData, "usageItemId"),
      actor,
    });
  });
  revalidateApp(applicationId, "test");
}
