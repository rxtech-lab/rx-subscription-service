"use server";

import {
  removeStoreProductMapping,
  saveAppleProductMapping,
} from "@/lib/iap/configuration";
import {
  revalidateApp,
  text,
  toActionState,
  withConfigurationUpdate,
  type ActionState,
} from "./shared";

async function saveMapping(formData: FormData, target: "plan" | "topup") {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await saveAppleProductMapping({
        applicationId,
        productId: text(formData, "productId"),
        planId: target === "plan" ? text(formData, "targetId") : null,
        topupProductId: target === "topup" ? text(formData, "targetId") : null,
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, target === "plan" ? "plans" : "topups");
  return { success: "App Store product saved." };
}

export async function saveApplePlanProductAction(
  _state: ActionState,
  formData: FormData,
) {
  return saveMapping(formData, "plan");
}

export async function saveAppleTopupProductAction(
  _state: ActionState,
  formData: FormData,
) {
  return saveMapping(formData, "topup");
}

export async function removeAppleProductMappingAction(formData: FormData) {
  const applicationId = text(formData, "applicationId");
  const section = text(formData, "section");
  await withConfigurationUpdate(applicationId, async ({ actor }) => {
    await removeStoreProductMapping({
      applicationId,
      mappingId: text(formData, "mappingId"),
      actor,
    });
  });
  revalidateApp(applicationId, section);
}
