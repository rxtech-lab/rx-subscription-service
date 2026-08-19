import "server-only";

import { eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/lib/db";
import { applications, testSuites } from "@/lib/db/schema";
import {
  recordAudit,
  type Actor,
} from "@/lib/subscription/shared";
import { executeRun, queueTestRun } from "./runner";

export async function getTestAutomationSettings(applicationId: string) {
  const [application, suiteCount] = await Promise.all([
    db
      .select({ runTestsOnChange: applications.runTestsOnChange })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)` })
      .from(testSuites)
      .where(eq(testSuites.applicationId, applicationId)),
  ]);

  return {
    runTestsOnChange: application[0]?.runTestsOnChange ?? false,
    suiteCount: Number(suiteCount[0]?.count ?? 0),
  };
}

export async function updateTestAutomationSettings(input: {
  applicationId: string;
  runTestsOnChange: boolean;
  actor: Actor;
}): Promise<void> {
  const [before] = await db
    .select({ runTestsOnChange: applications.runTestsOnChange })
    .from(applications)
    .where(eq(applications.id, input.applicationId))
    .limit(1);

  await db
    .update(applications)
    .set({
      runTestsOnChange: input.runTestsOnChange,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, input.applicationId));

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "application.test_automation.update",
    entityType: "application",
    entityId: input.applicationId,
    before: { runTestsOnChange: before?.runTestsOnChange ?? false },
    after: { runTestsOnChange: input.runTestsOnChange },
  });
}

/**
 * Start every suite after the current response has been sent.
 *
 * Configuration writes must not wait several minutes for their regression
 * suites, and a runner problem must never turn a successfully committed edit
 * into a failed form submission. Each suite therefore owns an independent
 * background pipeline and records any runner failure on its own run row.
 */
export async function scheduleAutomaticTestRuns(input: {
  applicationId: string;
  triggeredBy: string | null;
}): Promise<boolean> {
  try {
    const [application] = await db
      .select({ runTestsOnChange: applications.runTestsOnChange })
      .from(applications)
      .where(eq(applications.id, input.applicationId))
      .limit(1);

    if (!application?.runTestsOnChange) return false;

    after(async () => {
      try {
        const suites = await db
          .select({ id: testSuites.id })
          .from(testSuites)
          .where(eq(testSuites.applicationId, input.applicationId));

        const outcomes = await Promise.allSettled(
          suites.map(async (suite) => {
            const run = await queueTestRun({
              applicationId: input.applicationId,
              suiteId: suite.id,
              trigger: "automatic",
              triggeredBy: input.triggeredBy,
            });
            await executeRun(run.id);
          }),
        );

        for (const outcome of outcomes) {
          if (outcome.status === "rejected") {
            console.error("Automatic test suite failed to start:", outcome.reason);
          }
        }
      } catch (error) {
        console.error("Could not schedule automatic test suites:", error);
      }
    });
    return true;
  } catch (error) {
    console.error("Could not read automatic test settings:", error);
    return false;
  }
}
