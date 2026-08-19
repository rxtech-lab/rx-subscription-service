import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { testRuns } from "@/lib/db/schema";
import { createApiKey, revokeApiKey } from "@/lib/api/keys";
import type { Actor } from "@/lib/subscription/shared";
import { localDriver } from "./drivers/local";
import { sandboxDriver } from "./drivers/sandbox";
import type { RunDriver } from "./drivers/types";
import { parseRunLine } from "./protocol";
import { createRun, failRun, recordEvent, RUN_TIMEOUT_MS } from "./runs";
import { requireTestSuite } from "./suites";
import { signControlToken } from "./token";

const TEST_TIMEOUT_MS = 30_000;

let harnessCache: string | null = null;

/**
 * The harness is read from disk rather than bundled as a string so it stays an
 * ordinary, editable JavaScript file. `next.config.ts` traces it into the
 * deployment explicitly — without that include it exists in the repo and not in
 * the function.
 */
function harnessSource(): string {
  if (harnessCache) return harnessCache;
  harnessCache = readFileSync(
    join(process.cwd(), "lib", "testing", "harness", "runner.js"),
    "utf8",
  );
  return harnessCache;
}

export class TestRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestRunnerError";
  }
}

/**
 * Pick where a run executes.
 *
 * The local driver is a development convenience with no isolation, so it is
 * never selectable in a deployment: on Vercel it is the sandbox or nothing.
 */
export function selectDriver(): RunDriver {
  const configured = process.env.TEST_RUNNER?.trim();
  const onVercel = Boolean(process.env.VERCEL);

  if (configured === "local") {
    if (onVercel) {
      throw new TestRunnerError(
        "TEST_RUNNER=local is not allowed in a deployment — suites must run in a sandbox.",
      );
    }
    return localDriver;
  }
  if (configured === "sandbox") return sandboxDriver;
  return onVercel ? sandboxDriver : localDriver;
}

/**
 * The URL the sandbox calls back on.
 *
 * A sandbox is a separate machine, so `localhost` only works for the local
 * driver. Getting this wrong produces a run where every request fails with a
 * connection error, which is worth saying plainly up front.
 */
function baseUrl(driver: RunDriver): string {
  const configured =
    process.env.TEST_RUNNER_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");

  if (!configured) {
    throw new TestRunnerError(
      "Set NEXT_PUBLIC_SITE_URL (or TEST_RUNNER_BASE_URL) so a run can reach this deployment.",
    );
  }
  if (driver.name === "sandbox" && /localhost|127\.0\.0\.1/.test(configured)) {
    throw new TestRunnerError(
      `A sandbox cannot reach ${configured}. Set TEST_RUNNER_BASE_URL to a public URL, or run with TEST_RUNNER=local.`,
    );
  }
  return configured.replace(/\/$/, "");
}

/**
 * Queue a run. The row exists immediately so the caller can start following it;
 * `executeRun` does the work.
 */
export async function queueTestRun(input: {
  applicationId: string;
  suiteId: string;
  trigger: "console" | "ai";
  triggeredBy: string | null;
  conversationId?: string | null;
}) {
  const suite = await requireTestSuite(input.applicationId, input.suiteId);
  const driver = selectDriver();
  // Fail before creating a run when the run could not possibly work.
  baseUrl(driver);

  return createRun({
    applicationId: input.applicationId,
    suiteId: suite.id,
    code: suite.code,
    trigger: input.trigger,
    triggeredBy: input.triggeredBy,
    conversationId: input.conversationId ?? null,
    driver: driver.name,
  });
}

/**
 * Claim a queued run.
 *
 * Both the console tab and the chat card start following a run by asking to
 * execute it, and a reload asks again. The conditional update makes that safe:
 * exactly one caller moves the row out of `queued`, and everyone else just
 * follows along.
 */
async function claimRun(runId: string): Promise<boolean> {
  const claimed = await db
    .update(testRuns)
    .set({ status: "running" })
    .where(and(eq(testRuns.id, runId), eq(testRuns.status, "queued")))
    .returning({ id: testRuns.id });
  return claimed.length > 0;
}

export async function executeRun(runId: string): Promise<void> {
  if (!(await claimRun(runId))) return;

  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId)).limit(1);
  if (!run) return;

  let driver: RunDriver;
  let url: string;
  try {
    driver = selectDriver();
    url = baseUrl(driver);
  } catch (error) {
    await failRun(runId, error instanceof Error ? error.message : "Runner unavailable");
    return;
  }

  const actor: Actor = { type: "system", id: null };
  // A key that exists only for this run. Even if the suite prints it, it is
  // dead by the time anyone reads the log.
  const key = await createApiKey({
    applicationId: run.applicationId,
    name: `Test run ${runId.slice(0, 8)}`,
    actor,
  });

  // Events are numbered here and written one at a time. A driver hands lines
  // over as they arrive, which for a burst of output means several at once;
  // ordering the writes is what keeps the sequence gap-free and replayable.
  let seq = 0;
  let writes: Promise<void> = Promise.resolve();

  const append = (line: string, stream: "stdout" | "stderr") => {
    const event = parseRunLine(line, stream);
    if (!event) return writes;
    const at = seq;
    seq += 1;
    writes = writes.then(() =>
      recordEvent(runId, event, at).catch((error) => {
        // A dropped event costs a line of the transcript. Letting it reject
        // would cost the whole run, which would sit at "running" forever.
        console.error(`Could not record test run event ${at}:`, error);
      }),
    );
    return writes;
  };

  try {
    const controlToken = await signControlToken({
      applicationId: run.applicationId,
      runId,
    });

    const result = await driver.run({
      harness: harnessSource(),
      suiteCode: run.code,
      timeoutMs: RUN_TIMEOUT_MS,
      env: {
        RX_BASE_URL: url,
        RX_API_KEY: key.secret,
        RX_CONTROL_TOKEN: controlToken,
        RX_SUITE_PATH: "./suite.ts",
        RX_TEST_TIMEOUT_MS: String(TEST_TIMEOUT_MS),
      },
      onLine: append,
    });

    // The driver resolves when the process exits; the last few events may still
    // be in flight, and `run:end` is usually among them.
    await writes;

    // A non-zero exit with no `run:end` means the process died before it could
    // report — a syntax error, a killed sandbox, an out-of-memory.
    const [after] = await db
      .select({ status: testRuns.status })
      .from(testRuns)
      .where(eq(testRuns.id, runId))
      .limit(1);
    if (after && after.status === "running") {
      await failRun(
        runId,
        result.exitCode === 0
          ? "The run ended without reporting a result."
          : `The run exited with code ${result.exitCode}.`,
      );
    }
  } catch (error) {
    // Persist whatever the run managed to report before it broke, so the
    // failure is shown against the test that caused it.
    await writes.catch(() => {});
    await failRun(
      runId,
      error instanceof Error ? error.message : "The run could not be executed.",
    );
  } finally {
    await revokeApiKey({
      applicationId: run.applicationId,
      keyId: key.id,
      actor,
    }).catch(() => {});
  }
}
