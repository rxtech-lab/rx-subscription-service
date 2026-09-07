"use server";

import { revalidatePath } from "next/cache";
import { manageAppleAccountToken } from "@/lib/iap/apple/admin";
import { text, toActionState, withApplication, type ActionState } from "./shared";

export async function manageAppleAccountTokenAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const applicationId = text(form, "applicationId");
  try {
    const result = await withApplication(applicationId, ({ actor }) => manageAppleAccountToken(applicationId, actor, {
      appUserId: text(form, "appUserId"), environment: text(form, "environment"),
      operation: text(form, "operation"), expectedToken: text(form, "expectedToken"),
      token: text(form, "token") || undefined,
      originalTransactionId: text(form, "originalTransactionId") || undefined,
      acknowledged: form.get("acknowledged") === "on",
    }));
    revalidatePath(`/apps/${applicationId}`, "layout");
    return { success: result.message };
  } catch (error) { return toActionState(error); }
}
