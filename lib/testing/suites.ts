import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { testRuns, testSuites } from "@/lib/db/schema";
import {
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "@/lib/subscription/shared";
import { enforceSuiteTypes, type SuiteDiagnostic } from "./typecheck";
import {
  applySuiteSourceEdits,
  SuiteSourceEditError,
  type SuiteSourceEdit,
} from "./source-edits";

/** A suite file is source text, so the only real limit is a sane one. */
const MAX_CODE_LENGTH = 100_000;
const MAX_NAME_LENGTH = 120;

function assertName(value: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError("name is required");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  return name;
}

function assertCode(value: string): string {
  if (!value.trim()) throw new ValidationError("the suite is empty");
  if (value.length > MAX_CODE_LENGTH) {
    throw new ValidationError("the suite is too large to run");
  }
  return value;
}

export async function listTestSuites(applicationId: string) {
  const suites = await db
    .select()
    .from(testSuites)
    .where(eq(testSuites.applicationId, applicationId))
    .orderBy(testSuites.name);

  if (suites.length === 0) return [];

  // The list shows each suite's latest outcome, so the tab answers "is anything
  // broken" without opening every file.
  const latest = await db
    .select({
      id: testRuns.id,
      suiteId: testRuns.suiteId,
      status: testRuns.status,
      total: testRuns.total,
      passed: testRuns.passed,
      failed: testRuns.failed,
      startedAt: testRuns.startedAt,
      finishedAt: testRuns.finishedAt,
    })
    .from(testRuns)
    .where(eq(testRuns.applicationId, applicationId))
    .orderBy(desc(testRuns.startedAt))
    .limit(200);

  const lastRunBySuite = new Map<string, (typeof latest)[number]>();
  for (const run of latest) {
    if (!lastRunBySuite.has(run.suiteId)) lastRunBySuite.set(run.suiteId, run);
  }

  return suites.map((suite) => ({
    ...suite,
    lastRun: lastRunBySuite.get(suite.id) ?? null,
  }));
}

export async function getTestSuite(applicationId: string, suiteId: string) {
  const [suite] = await db
    .select()
    .from(testSuites)
    .where(and(eq(testSuites.id, suiteId), eq(testSuites.applicationId, applicationId)))
    .limit(1);
  return suite ?? null;
}

export async function requireTestSuite(applicationId: string, suiteId: string) {
  const suite = await getTestSuite(applicationId, suiteId);
  if (!suite) throw new NotFoundError("test suite", suiteId);
  return suite;
}

export async function createTestSuite(input: {
  applicationId: string;
  actor: Actor;
  name: string;
  description?: string | null;
  code: string;
}) {
  const name = assertName(input.name);
  const code = assertCode(input.code);
  const typeErrors = enforceSuiteTypes(code, input.actor);

  const [existing] = await db
    .select({ id: testSuites.id })
    .from(testSuites)
    .where(
      and(eq(testSuites.applicationId, input.applicationId), eq(testSuites.name, name)),
    )
    .limit(1);
  if (existing) throw new ValidationError(`a suite named "${name}" already exists`);

  const now = new Date();
  const [row] = await db
    .insert(testSuites)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      name,
      description: input.description?.trim() || null,
      code,
      updatedBy: input.actor.type === "ai" ? "ai" : "user",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_suite.create",
    entityType: "test_suite",
    entityId: row.id,
    after: { name: row.name },
  });

  return { ...row, typeErrors };
}

export async function updateTestSuite(input: {
  applicationId: string;
  actor: Actor;
  suiteId: string;
  name?: string;
  description?: string | null;
  code?: string;
}) {
  const before = await requireTestSuite(input.applicationId, input.suiteId);

  const patch: Partial<typeof testSuites.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: input.actor.type === "ai" ? "ai" : "user",
  };
  let typeErrors: SuiteDiagnostic[] = [];
  if (input.name !== undefined) patch.name = assertName(input.name);
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.code !== undefined) {
    patch.code = assertCode(input.code);
    typeErrors = enforceSuiteTypes(patch.code, input.actor);
  }

  if (patch.name && patch.name !== before.name) {
    const [clash] = await db
      .select({ id: testSuites.id })
      .from(testSuites)
      .where(
        and(
          eq(testSuites.applicationId, input.applicationId),
          eq(testSuites.name, patch.name),
        ),
      )
      .limit(1);
    if (clash) throw new ValidationError(`a suite named "${patch.name}" already exists`);
  }

  const [row] = await db
    .update(testSuites)
    .set(patch)
    .where(eq(testSuites.id, input.suiteId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_suite.update",
    entityType: "test_suite",
    entityId: row.id,
    before: { name: before.name, codeLength: before.code.length },
    after: { name: row.name, codeLength: row.code.length },
  });

  return { ...row, typeErrors };
}

/** Apply a compact source edit, then validate and persist the complete result. */
export async function editTestSuite(input: {
  applicationId: string;
  actor: Actor;
  suiteId: string;
  edits: readonly SuiteSourceEdit[];
}) {
  const suite = await requireTestSuite(input.applicationId, input.suiteId);
  let code: string;
  try {
    code = applySuiteSourceEdits(suite.code, input.edits);
  } catch (error) {
    if (error instanceof SuiteSourceEditError) {
      throw new ValidationError(error.message);
    }
    throw error;
  }

  return updateTestSuite({
    applicationId: input.applicationId,
    actor: input.actor,
    suiteId: suite.id,
    code,
  });
}

export async function deleteTestSuite(input: {
  applicationId: string;
  actor: Actor;
  suiteId: string;
}) {
  const before = await requireTestSuite(input.applicationId, input.suiteId);
  await db.delete(testSuites).where(eq(testSuites.id, input.suiteId));

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "test_suite.delete",
    entityType: "test_suite",
    entityId: input.suiteId,
    before: { name: before.name },
  });
}

/**
 * Resolve a suite by id or by name.
 *
 * Names are matched case-insensitively after trimming because the assistant
 * reads a name back as prose and re-types it, and "Subscription Lifecycle" not
 * matching "Subscription lifecycle" is a distinction nobody meant to draw.
 * A 36-character id, by contrast, either matches exactly or was mistyped — see
 * `describeMissingSuite` for what happens then.
 */
export async function resolveTestSuite(applicationId: string, idOrName: string) {
  const needle = idOrName.trim();
  if (!needle) return null;

  const byId = await getTestSuite(applicationId, needle);
  if (byId) return byId;

  const candidates = await db
    .select()
    .from(testSuites)
    .where(eq(testSuites.applicationId, applicationId));

  const folded = needle.toLowerCase();
  return candidates.find((suite) => suite.name.toLowerCase() === folded) ?? null;
}

/**
 * Explain a failed lookup in terms the caller can act on.
 *
 * A bare "no such suite" is a dead end for the assistant: it cannot tell a
 * suite that does not exist from an id it mistyped, and a hand-copied UUID is
 * wrong often enough to matter. Listing what does exist turns the failure into
 * a retry it can make on its own, without another round trip through the user.
 */
export async function describeMissingSuite(applicationId: string, idOrName: string) {
  const suites = await db
    .select({ id: testSuites.id, name: testSuites.name })
    .from(testSuites)
    .where(eq(testSuites.applicationId, applicationId))
    .orderBy(testSuites.name);

  return {
    ok: false as const,
    error:
      suites.length === 0
        ? `No test suite "${idOrName}". This application has no suites yet — create one with saveTestSuite.`
        : `No test suite "${idOrName}". Retry with one of the ids or names below, copied exactly.`,
    available: suites.map((suite) => ({ suiteId: suite.id, name: suite.name })),
  };
}
