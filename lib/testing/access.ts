import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { testRuns } from "@/lib/db/schema";
import {
  ApplicationAccessError,
  requireApplicationAccess,
  requireConsoleUser,
} from "@/lib/console/session";

/**
 * Authorize a console request that names a run rather than an application.
 *
 * The run id is the only thing the caller supplies, so the application is
 * derived from it and then re-checked against rxlab-auth — the same rule every
 * server action follows. A run id from another workspace resolves and is then
 * refused, rather than being trusted because it was known.
 */
export async function authorizeRun(
  runId: string,
): Promise<
  | { ok: true; applicationId: string; userId: string }
  | { ok: false; status: 401 | 403 | 404 }
> {
  const [run] = await db
    .select({ applicationId: testRuns.applicationId })
    .from(testRuns)
    .where(eq(testRuns.id, runId))
    .limit(1);
  if (!run) return { ok: false, status: 404 };

  // `requireConsoleUser` redirects when there is no session, which is right for
  // a page and wrong for fetch — a redirect to /login would arrive at the
  // client as an opaque HTML body.
  const user = await requireConsoleUser().catch(() => null);
  if (!user) return { ok: false, status: 401 };

  try {
    await requireApplicationAccess(run.applicationId);
  } catch (error) {
    if (error instanceof ApplicationAccessError) return { ok: false, status: 403 };
    throw error;
  }

  return { ok: true, applicationId: run.applicationId, userId: user.id };
}
