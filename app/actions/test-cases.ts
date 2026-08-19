"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  createTestSuite,
  deleteTestSuite,
  updateTestSuite,
} from "@/lib/testing/suites";
import { executeRun, queueTestRun } from "@/lib/testing/runner";
import { STARTER_SUITE } from "@/lib/testing/sdk-types";
import { optionalText, text, toActionState, withApplication, type ActionState } from "./shared";

/**
 * The Test cases tab writes through here rather than through an API route:
 * `withApplication` re-authorizes the application against rxlab-auth on every
 * call, so a suite cannot be created in — or run against — a workspace the
 * signed-in admin does not manage.
 *
 * The list uses `FormData` like every other console table; the editor takes
 * objects, because saving a buffer on ⌘S is not a form submission.
 */

function revalidate(applicationId: string, suiteId?: string) {
  revalidatePath(`/apps/${applicationId}/test/cases`);
  if (suiteId) revalidatePath(`/apps/${applicationId}/test/cases/${suiteId}`);
}

export async function createTestSuiteAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  let destination: string | null = null;

  try {
    const state = await withApplication(applicationId, async ({ actor }) => {
      const suite = await createTestSuite({
        applicationId,
        actor,
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
        code: STARTER_SUITE,
      });
      revalidate(applicationId);
      // A new suite is a starter file nobody wants to look at from a table row.
      destination = `/apps/${applicationId}/test/cases/${suite.id}`;
      return { success: `Created ${suite.name}` };
    });
    if (destination) redirect(destination);
    return state;
  } catch (error) {
    return toActionState(error);
  }
}

export async function deleteTestSuiteAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withApplication(applicationId, async ({ actor }) => {
    await deleteTestSuite({
      applicationId,
      actor,
      suiteId: text(formData, "suiteId"),
    });
  });
  revalidate(applicationId);
  redirect(`/apps/${applicationId}/test/cases`);
}

export async function renameTestSuiteAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  const suiteId = text(formData, "suiteId");
  try {
    return await withApplication(applicationId, async ({ actor }) => {
      await updateTestSuite({
        applicationId,
        actor,
        suiteId,
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
      });
      revalidate(applicationId, suiteId);
      return { success: "Saved" };
    });
  } catch (error) {
    return toActionState(error);
  }
}

export async function saveTestSuiteAction(input: {
  applicationId: string;
  suiteId: string;
  code: string;
}): Promise<ActionState & { typeErrors?: number }> {
  try {
    return await withApplication(input.applicationId, async ({ actor }) => {
      // A human's save is never blocked by a type error — Monaco has already
      // shown it, and parking a half-written suite is legitimate. The count
      // comes back so the editor can say the save was not a clean one.
      const saved = await updateTestSuite({
        applicationId: input.applicationId,
        actor,
        suiteId: input.suiteId,
        code: input.code,
      });
      revalidate(input.applicationId, input.suiteId);
      return { success: "Saved", typeErrors: saved.typeErrors.length };
    });
  } catch (error) {
    return toActionState(error);
  }
}

/**
 * Queue a run and hand back its id.
 *
 * Queue the run, then execute it after the action response. Live viewers still
 * make the same idempotent execute request as a fallback, so closing the page
 * after pressing Run cannot leave the row queued forever.
 */
export async function startTestRunAction(input: {
  applicationId: string;
  suiteId: string;
}): Promise<ActionState & { runId?: string }> {
  try {
    return await withApplication(input.applicationId, async ({ actor }) => {
      const run = await queueTestRun({
        applicationId: input.applicationId,
        suiteId: input.suiteId,
        trigger: "console",
        triggeredBy: actor.id,
      });
      revalidate(input.applicationId, input.suiteId);
      after(() => executeRun(run.id));
      return { runId: run.id };
    });
  } catch (error) {
    return toActionState(error);
  }
}
