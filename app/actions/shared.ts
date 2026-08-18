import "server-only";
import { revalidatePath } from "next/cache";
import {
  requireApplicationAccess,
  requireConsoleUser,
} from "@/lib/console/session";
import type { Actor } from "@/lib/subscription/shared";

export interface ActionState {
  error?: string;
  success?: string;
}

/**
 * Every console mutation runs through here: it re-authorizes the application
 * against rxlab-auth on each call, so a spoofed `applicationId` in a form post
 * is rejected before any service code runs.
 */
export async function withApplication<T>(
  applicationId: string,
  run: (context: { applicationId: string; actor: Actor }) => Promise<T>,
): Promise<T> {
  const user = await requireConsoleUser();
  await requireApplicationAccess(applicationId);
  return run({
    applicationId,
    actor: { type: "user", id: user.id },
  });
}

/** Turn a thrown service error into a message the form can render. */
export function toActionState(error: unknown): ActionState {
  if (error instanceof Error) {
    if (
      error.name === "ValidationError" ||
      error.name === "NotFoundError" ||
      error.name === "ApplicationAccessError" ||
      error.name === "InsufficientBalanceError"
    ) {
      return { error: error.message };
    }
    // `redirect()` and `notFound()` signal through exceptions — never swallow them.
    if (error.message === "NEXT_REDIRECT" || error.message === "NEXT_NOT_FOUND") {
      throw error;
    }
    if ("digest" in error && typeof error.digest === "string") {
      if (error.digest.startsWith("NEXT_REDIRECT")) throw error;
    }
  }
  console.error("Console action failed:", error);
  return { error: "Something went wrong. Please try again." };
}

export function revalidateApp(applicationId: string, section?: string) {
  revalidatePath(`/apps/${applicationId}${section ? `/${section}` : ""}`);
}

export function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value === "" ? null : value;
}

export function integer(formData: FormData, key: string, fallback = 0): number {
  const value = text(formData, key);
  if (value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function optionalInteger(formData: FormData, key: string): number | null {
  const value = text(formData, key);
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

/** Dollars in the form, integer cents in the database. */
export function moneyToCents(formData: FormData, key: string): number {
  const value = text(formData, key);
  if (value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}
