"use server";

import { revalidatePath } from "next/cache";
import { updateTestAutomationSettings } from "@/lib/testing/automation";
import { saveAppleIntegration } from "@/lib/iap/configuration";
import { updateApplicationLink } from "@/lib/applications/links";
import { getManagedApplications } from "@/lib/console/session";
import {
  checkbox,
  integer,
  revalidateApp,
  text,
  toActionState,
  withApplication,
  type ActionState,
} from "./shared";

export async function updateApplicationLinkAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  const linkedApplicationId = text(formData, "linkedApplicationId") || null;
  try {
    await withApplication(applicationId, async ({ actor }) => {
      const managed = await getManagedApplications();
      await updateApplicationLink({
        applicationId,
        linkedApplicationId,
        managedApplicationIds: managed.map((application) => application.id),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "settings");
  revalidatePath("/");
  return {
    success: linkedApplicationId
      ? "Application linked. API requests now use the shared subscription data."
      : "Application unlinked. API requests now use this application's own data.",
  };
}

export async function updateTestAutomationSettingsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await updateTestAutomationSettings({
        applicationId,
        runTestsOnChange: checkbox(formData, "runTestsOnChange"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }

  revalidateApp(applicationId, "settings");
  return { success: "Test automation settings saved." };
}

export async function updateAppleIntegrationAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await saveAppleIntegration({
        applicationId,
        bundleId: text(formData, "bundleId"),
        appAppleId: integer(formData, "appAppleId"),
        enabled: checkbox(formData, "enabled"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "settings");
  return { success: "App Store settings saved." };
}
