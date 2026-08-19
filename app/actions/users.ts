"use server";

import {
  createApiKey,
  deleteApiKey,
  isApiEnvironment,
} from "@/lib/api/keys";
import { requireConsoleUser } from "@/lib/console/session";
import {
  isPermissionError,
  RxLabAdminApiError,
} from "@/lib/rxlab/oauth-clients";
import { findRxLabUser } from "@/lib/rxlab/users";
import { ValidationError } from "@/lib/subscription/shared";
import {
  adjustBalance,
  createAppUser,
  setUserLevel,
} from "@/lib/subscription/users";
import { cancelSubscription } from "@/lib/subscription/subscriptions";
import { resetUsageCounter } from "@/lib/subscription/usage";
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

export async function createAppUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      const consoleUser = await requireConsoleUser();
      const rxlabUser = await findRxLabUser(
        consoleUser.accessToken,
        text(formData, "rxlabUserId"),
      );
      if (!rxlabUser) throw new ValidationError("RxLab user not found");

      await createAppUser({
        applicationId,
        rxlabUserId: rxlabUser.sub,
        email: rxlabUser.email,
        displayName: rxlabUser.name,
        actor,
      });
    });
  } catch (error) {
    if (isPermissionError(error)) {
      return { error: "Your RxLab account needs the read:user:all permission." };
    }
    if (error instanceof RxLabAdminApiError) {
      return { error: "The RxLab user directory is unavailable. Try again." };
    }
    return toActionState(error);
  }
  revalidateApp(applicationId, "users");
  revalidateApp(applicationId, "subscriptions");
  return { success: "User added." };
}

export async function setUserLevelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await setUserLevel({
        applicationId,
        appUserId: text(formData, "appUserId"),
        level: integer(formData, "level", 0),
        levelKey: optionalText(formData, "levelKey"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "users");
  return { success: "Level updated." };
}

export async function adjustBalanceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await adjustBalance({
        applicationId,
        appUserId: text(formData, "appUserId"),
        unitId: text(formData, "unitId"),
        delta: integer(formData, "delta", 0),
        reason: text(formData, "reason"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "users");
  return { success: "Balance adjusted." };
}

export async function cancelSubscriptionAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await cancelSubscription({
      applicationId,
      subscriptionId: text(formData, "subscriptionId"),
      immediately: checkbox(formData, "immediately"),
      actor,
    });
  });
  revalidateApp(applicationId, "subscriptions");
}

export async function resetUsageAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await resetUsageCounter({
      applicationId,
      appUserId: text(formData, "appUserId"),
      usageItemId: text(formData, "usageItemId"),
      actor,
    });
  });
  revalidateApp(applicationId, "users");
}

export interface ApiKeyState extends ActionState {
  /** Shown once, immediately after creation — never retrievable again. */
  secret?: string;
}

export async function createApiKeyAction(
  _prev: ApiKeyState,
  formData: FormData,
): Promise<ApiKeyState> {
  const applicationId = text(formData, "applicationId");
  try {
    const environment = text(formData, "environment");
    if (!isApiEnvironment(environment)) {
      throw new ValidationError("Choose sandbox or production");
    }
    const created = await withApplication(applicationId, ({ actor }) =>
      createApiKey({
        applicationId,
        name: text(formData, "name"),
        environment,
        actor,
      }),
    );
    revalidateApp(applicationId, "settings");
    return {
      success: "API key created. Copy it now — it will not be shown again.",
      secret: created.secret,
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function deleteApiKeyAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await deleteApiKey({ applicationId, keyId: text(formData, "keyId"), actor });
  });
  revalidateApp(applicationId, "settings");
}
