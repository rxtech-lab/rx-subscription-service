"use server";

import type { ResetPolicy, ResetUnit, TopupRuleType } from "@/lib/db/schema";
import {
  createBalanceUnit,
  deleteBalanceUnit,
  setPointRate,
  updateBalanceUnit,
} from "@/lib/subscription/units";
import {
  createUsageItem,
  deleteUsageItem,
  updateUsageItem,
} from "@/lib/subscription/usage-items";
import {
  addEligibilityRule,
  createTopupProduct,
  deleteTopupProduct,
  removeEligibilityRule,
  type TopupEligibility,
  updateTopupProduct,
} from "@/lib/subscription/topups";
import { ValidationError } from "@/lib/subscription/shared";
import {
  integer,
  moneyToCents,
  optionalInteger,
  optionalText,
  revalidateApp,
  text,
  toActionState,
  withApplication,
  type ActionState,
} from "./shared";

export async function createBalanceUnitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await createBalanceUnit({
        applicationId,
        key: text(formData, "key"),
        name: text(formData, "name"),
        symbol: optionalText(formData, "symbol"),
        precision: integer(formData, "precision", 0),
        kind: (text(formData, "kind") || "points") as "points" | "currency" | "custom",
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "units");
  return { success: "Unit created." };
}

export async function updateBalanceUnitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await updateBalanceUnit({
        applicationId,
        unitId: text(formData, "unitId"),
        name: text(formData, "name"),
        symbol: optionalText(formData, "symbol"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "units");
  return { success: "Unit updated." };
}

export async function deleteBalanceUnitAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await deleteBalanceUnit({ applicationId, unitId: text(formData, "unitId"), actor });
  });
  revalidateApp(applicationId, "units");
}

/** "N units cost $X" — stored as an exact integer rate. */
export async function setPointRateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await setPointRate({
        applicationId,
        unitId: text(formData, "unitId"),
        currency: text(formData, "currency") || "usd",
        units: integer(formData, "units", 1),
        amountMinor: moneyToCents(formData, "price"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "units");
  return { success: "Rate saved." };
}

export async function createUsageItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await createUsageItem({
        applicationId,
        key: text(formData, "key"),
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
        resetPolicy: (text(formData, "resetPolicy") || "never") as ResetPolicy,
        resetIntervalCount: optionalInteger(formData, "resetIntervalCount"),
        resetIntervalUnit: (optionalText(formData, "resetIntervalUnit") ??
          null) as ResetUnit | null,
        defaultLimit: optionalInteger(formData, "defaultLimit"),
        overagePolicy: (text(formData, "overagePolicy") || "block") as
          | "block"
          | "allow"
          | "charge_balance",
        overageUnitId: optionalText(formData, "overageUnitId"),
        overageCostPerUnit: optionalInteger(formData, "overageCostPerUnit"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "usage-items");
  return { success: "Usage item created." };
}

export async function updateUsageItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await updateUsageItem({
        applicationId,
        usageItemId: text(formData, "usageItemId"),
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
        resetPolicy: (text(formData, "resetPolicy") || "never") as ResetPolicy,
        resetIntervalCount: optionalInteger(formData, "resetIntervalCount"),
        resetIntervalUnit: (optionalText(formData, "resetIntervalUnit") ??
          null) as ResetUnit | null,
        defaultLimit: optionalInteger(formData, "defaultLimit"),
        overagePolicy: (text(formData, "overagePolicy") || "block") as
          | "block"
          | "allow"
          | "charge_balance",
        overageUnitId: optionalText(formData, "overageUnitId"),
        overageCostPerUnit: optionalInteger(formData, "overageCostPerUnit"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "usage-items");
  return { success: "Usage item updated." };
}

export async function deleteUsageItemAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await deleteUsageItem({
      applicationId,
      usageItemId: text(formData, "usageItemId"),
      actor,
    });
  });
  revalidateApp(applicationId, "usage-items");
}

export async function createTopupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await createTopupProduct({
        applicationId,
        key: text(formData, "key"),
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
        unitId: text(formData, "unitId"),
        amount: integer(formData, "amount", 0),
        priceAmountCents: moneyToCents(formData, "price"),
        currency: text(formData, "currency") || "usd",
        maxPurchasesPerUser: optionalInteger(formData, "maxPurchasesPerUser"),
        eligibility: topupEligibility(formData),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "topups");
  return { success: "Topup created." };
}

function topupEligibility(formData: FormData): TopupEligibility {
  const type = text(formData, "eligibilityType") || "standalone";
  if (type === "standalone") return { type };
  if (type === "plan") return { type, planId: text(formData, "planId") };
  if (type === "role") return { type, roleId: text(formData, "roleId") };
  throw new ValidationError("invalid topup eligibility type");
}

export async function updateTopupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await updateTopupProduct({
        applicationId,
        topupId: text(formData, "topupId"),
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
        amount: integer(formData, "amount", 0),
        priceAmountCents: moneyToCents(formData, "price"),
        currency: text(formData, "currency") || undefined,
        maxPurchasesPerUser: optionalInteger(formData, "maxPurchasesPerUser"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "topups");
  return { success: "Topup updated." };
}

export async function setTopupStatusAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await updateTopupProduct({
      applicationId,
      topupId: text(formData, "topupId"),
      status: text(formData, "status") as "draft" | "active" | "archived",
      actor,
    });
  });
  revalidateApp(applicationId, "topups");
}

export async function deleteTopupAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await deleteTopupProduct({
      applicationId,
      topupId: text(formData, "topupId"),
      actor,
    });
  });
  revalidateApp(applicationId, "topups");
}

export async function addEligibilityRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await addEligibilityRule({
        applicationId,
        topupId: text(formData, "topupId"),
        ruleType: text(formData, "ruleType") as TopupRuleType,
        planId: optionalText(formData, "planId"),
        roleId: optionalText(formData, "roleId"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "topups");
  return { success: "Rule added." };
}

export async function removeEligibilityRuleAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await removeEligibilityRule({
      applicationId,
      topupId: text(formData, "topupId"),
      ruleId: text(formData, "ruleId"),
      actor,
    });
  });
  revalidateApp(applicationId, "topups");
}
