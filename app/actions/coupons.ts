"use server";

import type { CouponDuration } from "@/lib/db/schema";
import {
  createCoupon,
  deleteCoupon,
  setCouponStatus,
  updateCoupon,
} from "@/lib/subscription/coupons";
import {
  checkbox,
  optionalDate,
  optionalInteger,
  optionalMoneyToCents,
  optionalText,
  percentToBasisPoints,
  revalidateApp,
  text,
  textList,
  toActionState,
  withConfigurationUpdate,
  type ActionState,
} from "./shared";

/** The fields shared by create and edit, read once. */
function couponFields(formData: FormData) {
  const appliesTo = (text(formData, "appliesTo") || "all") as "all" | "selected";
  const duration = (text(formData, "duration") || "once") as CouponDuration;
  return {
    name: text(formData, "name"),
    description: optionalText(formData, "description"),
    percentBasisPoints: percentToBasisPoints(formData, "percentOff"),
    amountOffCents: optionalMoneyToCents(formData, "amountOff"),
    maxDiscountCents: optionalMoneyToCents(formData, "maxDiscount"),
    duration,
    durationInMonths:
      duration === "repeating" ? optionalInteger(formData, "durationInMonths") : null,
    appliesTo,
    planIds: appliesTo === "selected" ? textList(formData, "planIds") : [],
    topupProductIds:
      appliesTo === "selected" ? textList(formData, "topupProductIds") : [],
    restrictToUsers: checkbox(formData, "restrictToUsers"),
    maxRedemptions: optionalInteger(formData, "maxRedemptions"),
    maxRedemptionsPerUser: optionalInteger(formData, "maxRedemptionsPerUser"),
    minimumAmountCents: optionalMoneyToCents(formData, "minimumAmount"),
    firstTimeOnly: checkbox(formData, "firstTimeOnly"),
    startsAt: optionalDate(formData, "startsAt"),
    redeemBy: optionalDate(formData, "redeemBy"),
  };
}

export async function createCouponAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await createCoupon({
        applicationId,
        code: text(formData, "code"),
        discountType: (text(formData, "discountType") || "percent") as
          | "percent"
          | "amount",
        currency: text(formData, "currency") || "usd",
        appUserIds: textList(formData, "appUserIds"),
        ...couponFields(formData),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "coupons");
  return { success: "Coupon created. Publish it when you are ready." };
}

export async function updateCouponAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await updateCoupon({
        applicationId,
        couponId: text(formData, "couponId"),
        appUserIds: textList(formData, "appUserIds"),
        ...couponFields(formData),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "coupons");
  return { success: "Coupon updated." };
}

export async function setCouponStatusAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withConfigurationUpdate(applicationId, async ({ actor }) => {
    await setCouponStatus({
      applicationId,
      couponId: text(formData, "couponId"),
      status: text(formData, "status") as "draft" | "active" | "archived",
      actor,
    });
  });
  revalidateApp(applicationId, "coupons");
}

export async function deleteCouponAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withConfigurationUpdate(applicationId, async ({ actor }) => {
    await deleteCoupon({
      applicationId,
      couponId: text(formData, "couponId"),
      actor,
    });
  });
  revalidateApp(applicationId, "coupons");
}
