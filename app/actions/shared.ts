import "server-only";
import { revalidatePath } from "next/cache";
import {
  requireApplicationAccess,
  requireConsoleUser,
} from "@/lib/console/session";
import type { Actor } from "@/lib/subscription/shared";
import { scheduleAutomaticTestRuns } from "@/lib/testing/automation";

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

/**
 * A console-wide mutation — one that belongs to no application, such as editing
 * a shared paywall template. Any signed-in console admin may perform it.
 */
export async function withConsoleUser<T>(
  run: (context: { actor: Actor }) => Promise<T>,
): Promise<T> {
  const user = await requireConsoleUser();
  return run({ actor: { type: "user", id: user.id } });
}

/** A configuration mutation followed by the application's optional test suites. */
export async function withConfigurationUpdate<T>(
  applicationId: string,
  run: (context: { applicationId: string; actor: Actor }) => Promise<T>,
): Promise<T> {
  return withApplication(applicationId, async (context) => {
    const result = await run(context);
    await scheduleAutomaticTestRuns({
      applicationId,
      triggeredBy: context.actor.id,
    });
    return result;
  });
}

/** Turn a thrown service error into a message the form can render. */
export function toActionState(error: unknown): ActionState {
  if (error instanceof Error) {
    if (
      error.name === "ValidationError" ||
      error.name === "CouponNotApplicableError" ||
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
    // An expired console session is the single most common way a mutation
    // fails, and "something went wrong" is the least useful thing to say about
    // it: the fix is to sign in again, and nothing on screen hinted at that.
    if (error.name === "RxLabAdminApiError") {
      const status = (error as Error & { status?: number }).status;
      if (status === 401) {
        return {
          error: "Your console session has expired. Reload the page and sign in again.",
        };
      }
      return { error: `RxLab admin API: ${error.message}` };
    }
  }
  console.error("Console action failed:", error);
  // The server log has the stack; the browser had nothing at all, which made
  // every unexpected failure look identical while developing. Production still
  // gets the generic line — an internal message is not the user's business.
  const detail =
    process.env.NODE_ENV === "development" && error instanceof Error
      ? ` (${error.name}: ${error.message})`
      : "";
  return { error: `Something went wrong. Please try again.${detail}` };
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

/** Every value submitted under one name — a checkbox group or a multi-select. */
export function textList(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
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

/** The same, for a field where "unset" and "zero" are different answers. */
export function optionalMoneyToCents(
  formData: FormData,
  key: string,
): number | null {
  const value = text(formData, key);
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/** A percentage in the form, hundredths of a percent in the database. */
export function percentToBasisPoints(
  formData: FormData,
  key: string,
): number | null {
  const value = text(formData, key);
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/** A `datetime-local` input plus the browser's `getTimezoneOffset()` value. */
export function optionalDate(
  formData: FormData,
  key: string,
  timezoneOffsetKey = "timezoneOffsetMinutes",
): Date | null {
  const value = text(formData, key);
  if (value === "") return null;
  const offset = Number(text(formData, timezoneOffsetKey));
  const wallClock = new Date(`${value}Z`);
  const parsed = Number.isFinite(offset)
    ? new Date(wallClock.getTime() + offset * 60_000)
    : wallClock;
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
