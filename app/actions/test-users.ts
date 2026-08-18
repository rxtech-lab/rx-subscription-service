"use server";

import { cancelSubscription } from "@/lib/subscription/subscriptions";
import {
  createTestUser,
  creditTestBalance,
  deleteTestUser,
  grantTestSubscription,
  requireTestUser,
  updateTestUser,
} from "@/lib/subscription/test-users";
import { resetUsageCounter } from "@/lib/subscription/usage";
import { adjustBalance } from "@/lib/subscription/users";
import {
  checkbox,
  integer,
  optionalText,
  revalidateApp,
  text,
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
      await updateTestUser({
        applicationId,
        appUserId: text(formData, "appUserId"),
        displayName: text(formData, "displayName"),
        email: optionalText(formData, "email"),
        level: integer(formData, "level", 0),
        levelKey: optionalText(formData, "levelKey"),
        note: optionalText(formData, "note"),
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
