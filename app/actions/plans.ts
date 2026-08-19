"use server";

import type { BillingInterval, EntitlementKind } from "@/lib/db/schema";
import {
  addPlanEntitlement,
  createPlan,
  removePlanEntitlement,
  setPlanStatus,
  updatePlan,
} from "@/lib/subscription/plans";
import {
  checkbox,
  integer,
  moneyToCents,
  optionalInteger,
  optionalText,
  revalidateApp,
  text,
  toActionState,
  withConfigurationUpdate,
  type ActionState,
} from "./shared";

export async function createPlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await createPlan({
        applicationId,
        key: text(formData, "key"),
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
        billingInterval: text(formData, "billingInterval") as BillingInterval,
        intervalCount: integer(formData, "intervalCount", 1),
        priceAmountCents: moneyToCents(formData, "price"),
        currency: text(formData, "currency") || "usd",
        trialDays: integer(formData, "trialDays", 0),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "plans");
  return { success: "Plan created." };
}

export async function updatePlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await updatePlan({
        applicationId,
        planId: text(formData, "planId"),
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
        priceAmountCents: moneyToCents(formData, "price"),
        currency: text(formData, "currency") || undefined,
        trialDays: integer(formData, "trialDays", 0),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "plans");
  return { success: "Plan updated." };
}

export async function setPlanStatusAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withConfigurationUpdate(applicationId, async ({ actor }) => {
    await setPlanStatus({
      applicationId,
      planId: text(formData, "planId"),
      status: text(formData, "status") as "draft" | "active" | "archived",
      actor,
    });
  });
  revalidateApp(applicationId, "plans");
}

export async function addPlanEntitlementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  const kind = text(formData, "kind") as EntitlementKind;
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await addPlanEntitlement({
        applicationId,
        planId: text(formData, "planId"),
        kind,
        roleId: optionalText(formData, "roleId"),
        permissionKey: optionalText(formData, "permissionKey"),
        permissionScope: checkbox(formData, "permissionAll") ? "all" : "selected",
        permissionTargetIds:
          optionalText(formData, "permissionTargetIds")
            ?.split(",")
            .map((id) => id.trim())
            .filter(Boolean) ?? null,
        usageItemId: optionalText(formData, "usageItemId"),
        limitValue: optionalInteger(formData, "limitValue"),
        trialLimitValue: optionalInteger(formData, "trialLimitValue"),
        unitId: optionalText(formData, "unitId"),
        amount: optionalInteger(formData, "amount"),
        featureKey: optionalText(formData, "featureKey"),
        featureValue: optionalText(formData, "featureValue"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "plans");
  return { success: "Entitlement added." };
}

export async function removePlanEntitlementAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withConfigurationUpdate(applicationId, async ({ actor }) => {
    await removePlanEntitlement({
      applicationId,
      planId: text(formData, "planId"),
      entitlementId: text(formData, "entitlementId"),
      actor,
    });
  });
  revalidateApp(applicationId, "plans");
}
