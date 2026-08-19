"use server";

import { updateTestAutomationSettings } from "@/lib/testing/automation";
import {
  checkbox,
  revalidateApp,
  text,
  toActionState,
  withApplication,
  type ActionState,
} from "./shared";

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
