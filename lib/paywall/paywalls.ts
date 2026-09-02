import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  applications,
  paywalls,
  paywallVersions,
  type Paywall,
  type PaywallVersion,
} from "@/lib/db/schema";
import {
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "@/lib/subscription/shared";
import { validatePaywallSpec, type PaywallSpec } from "./schema";
import { isTemplateKey, TEMPLATES, type TemplateKey } from "./templates";

/**
 * Paywall templates are console-wide, so nothing here takes an applicationId
 * except the assignment calls. Authorization is the caller's job: a signed-in
 * console admin may touch any template, and `withApplication` guards the one
 * application-scoped write.
 */

const MAX_NAME_LENGTH = 120;

function assertName(value: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError("name is required");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  return name;
}

function assertSpec(input: unknown): PaywallSpec {
  const result = validatePaywallSpec(input);
  if (!result.ok) throw new ValidationError(result.error);
  return result.spec;
}

async function assertNameAvailable(name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: paywalls.id })
    .from(paywalls)
    .where(eq(paywalls.name, name))
    .limit(1);
  if (clash && clash.id !== exceptId) {
    throw new ValidationError(`a paywall named "${name}" already exists`);
  }
}

export interface PaywallSummary extends Paywall {
  usedBy: number;
}

/** A complete immutable design snapshot, including the renderable document. */
export type PaywallVersionSnapshot = PaywallVersion;

export interface VersionedPaywallResult {
  paywall: Paywall;
  version: PaywallVersion;
}

export async function listPaywalls(): Promise<PaywallSummary[]> {
  const rows = await db.select().from(paywalls).orderBy(desc(paywalls.updatedAt));
  if (rows.length === 0) return [];

  const assignments = await db
    .select({ paywallId: applications.paywallId })
    .from(applications)
    .where(isNotNull(applications.paywallId));
  const counts = new Map<string, number>();
  for (const row of assignments) {
    if (row.paywallId) counts.set(row.paywallId, (counts.get(row.paywallId) ?? 0) + 1);
  }
  return rows.map((row) => ({ ...row, usedBy: counts.get(row.id) ?? 0 }));
}

export async function getPaywall(paywallId: string): Promise<Paywall | null> {
  const [row] = await db.select().from(paywalls).where(eq(paywalls.id, paywallId)).limit(1);
  return row ?? null;
}

export async function requirePaywall(paywallId: string): Promise<Paywall> {
  const paywall = await getPaywall(paywallId);
  if (!paywall) throw new NotFoundError("paywall", paywallId);
  return paywall;
}

export async function listPaywallVersions(
  paywallId: string,
  limit = 50,
): Promise<PaywallVersionSnapshot[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  return db
    .select({
      id: paywallVersions.id,
      paywallId: paywallVersions.paywallId,
      version: paywallVersions.version,
      spec: paywallVersions.spec,
      source: paywallVersions.source,
      restoredFromVersion: paywallVersions.restoredFromVersion,
      actorType: paywallVersions.actorType,
      actorId: paywallVersions.actorId,
      createdAt: paywallVersions.createdAt,
      publishedAt: paywallVersions.publishedAt,
    })
    .from(paywallVersions)
    .where(eq(paywallVersions.paywallId, paywallId))
    .orderBy(desc(paywallVersions.version))
    .limit(safeLimit);
}

async function requirePaywallVersion(
  paywallId: string,
  version: number,
): Promise<PaywallVersion> {
  const [row] = await db
    .select()
    .from(paywallVersions)
    .where(
      and(
        eq(paywallVersions.paywallId, paywallId),
        eq(paywallVersions.version, version),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("paywall version", `${paywallId}:${version}`);
  return row;
}

export async function createPaywall(input: {
  name: string;
  description?: string | null;
  template: string;
  actor: Actor;
}): Promise<Paywall> {
  const name = assertName(input.name);
  if (!isTemplateKey(input.template)) {
    throw new ValidationError(`unknown template "${input.template}"`);
  }
  await assertNameAvailable(name);

  const now = new Date();
  const spec = TEMPLATES[input.template as TemplateKey].build();
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(paywalls)
      .values({
        id: newId(),
        name,
        description: input.description?.trim() || null,
        draftSpec: spec,
        publishedSpec: null,
        updatedBy: input.actor.type === "ai" ? "ai" : "user",
        createdBy: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(paywallVersions).values({
      id: newId(),
      paywallId: created.id,
      version: 1,
      spec,
      source: "initial",
      actorType: input.actor.type,
      actorId: input.actor.id,
      createdAt: now,
    });
    return created;
  });

  await recordAudit({
    applicationId: null,
    actor: input.actor,
    action: "paywall.create",
    entityType: "paywall",
    entityId: row.id,
    after: { name: row.name, template: input.template },
  });
  return row;
}

export async function renamePaywall(input: {
  paywallId: string;
  name: string;
  description?: string | null;
  actor: Actor;
}): Promise<Paywall> {
  const before = await requirePaywall(input.paywallId);
  const name = assertName(input.name);
  if (name !== before.name) await assertNameAvailable(name, before.id);

  const [row] = await db
    .update(paywalls)
    .set({
      name,
      description: input.description?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(paywalls.id, input.paywallId))
    .returning();

  await recordAudit({
    applicationId: null,
    actor: input.actor,
    action: "paywall.update",
    entityType: "paywall",
    entityId: row.id,
    before: { name: before.name, description: before.description },
    after: { name: row.name, description: row.description },
  });
  return row;
}

export async function duplicatePaywall(input: {
  paywallId: string;
  actor: Actor;
}): Promise<Paywall> {
  const source = await requirePaywall(input.paywallId);
  const existing = new Set(
    (await db.select({ name: paywalls.name }).from(paywalls)).map((row) => row.name),
  );
  let name = `Copy of ${source.name}`.slice(0, MAX_NAME_LENGTH);
  for (let n = 2; existing.has(name); n += 1) {
    name = `Copy of ${source.name} (${n})`.slice(0, MAX_NAME_LENGTH);
  }

  const now = new Date();
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(paywalls)
      .values({
        id: newId(),
        name,
        description: source.description,
        // A copy starts as a draft only; publishing it is a deliberate step.
        draftSpec: source.draftSpec,
        publishedSpec: null,
        updatedBy: input.actor.type === "ai" ? "ai" : "user",
        createdBy: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(paywallVersions).values({
      id: newId(),
      paywallId: created.id,
      version: 1,
      spec: source.draftSpec,
      source: "duplicated",
      actorType: input.actor.type,
      actorId: input.actor.id,
      createdAt: now,
    });
    return created;
  });

  await recordAudit({
    applicationId: null,
    actor: input.actor,
    action: "paywall.duplicate",
    entityType: "paywall",
    entityId: row.id,
    before: { sourceId: source.id },
    after: { name: row.name },
  });
  return row;
}

export async function saveDraft(input: {
  paywallId: string;
  spec: unknown;
  actor: Actor;
}): Promise<VersionedPaywallResult> {
  const spec = assertSpec(input.spec);
  const result = await db.transaction(async (tx): Promise<VersionedPaywallResult> => {
    const [current] = await tx
      .select()
      .from(paywalls)
      .where(eq(paywalls.id, input.paywallId))
      .limit(1);
    if (!current) throw new NotFoundError("paywall", input.paywallId);

    const [latestVersion] = await tx
      .select()
      .from(paywallVersions)
      .where(eq(paywallVersions.paywallId, current.id))
      .orderBy(desc(paywallVersions.version))
      .limit(1);
    if (!latestVersion) {
      throw new NotFoundError("paywall version", `${current.id}:latest`);
    }

    if (JSON.stringify(current.draftSpec) === JSON.stringify(spec)) {
      return { paywall: current, version: latestVersion };
    }

    const now = new Date();
    const nextVersion = latestVersion.version + 1;
    const [version] = await tx
      .insert(paywallVersions)
      .values({
        id: newId(),
        paywallId: current.id,
        version: nextVersion,
        spec,
        source: "draft",
        actorType: input.actor.type,
        actorId: input.actor.id,
        createdAt: now,
      })
      .returning();
    const [paywall] = await tx
      .update(paywalls)
      .set({
        draftSpec: spec,
        updatedBy: input.actor.type === "ai" ? "ai" : "user",
        updatedAt: now,
      })
      .where(eq(paywalls.id, input.paywallId))
      .returning();
    return { paywall, version };
  });

  await recordAudit({
    applicationId: null,
    actor: input.actor,
    action: "paywall.save_draft",
    entityType: "paywall",
    entityId: result.paywall.id,
    after: { version: result.version.version },
  });
  return result;
}

/** Copy the draft — or a freshly supplied spec — into the published slot. */
export async function publishPaywall(input: {
  paywallId: string;
  spec?: unknown;
  actor: Actor;
}): Promise<VersionedPaywallResult> {
  const suppliedSpec = input.spec === undefined ? undefined : assertSpec(input.spec);
  const now = new Date();
  const result = await db.transaction(async (tx): Promise<VersionedPaywallResult> => {
    const [current] = await tx
      .select()
      .from(paywalls)
      .where(eq(paywalls.id, input.paywallId))
      .limit(1);
    if (!current) throw new NotFoundError("paywall", input.paywallId);

    const [latestVersion] = await tx
      .select()
      .from(paywallVersions)
      .where(eq(paywallVersions.paywallId, current.id))
      .orderBy(desc(paywallVersions.version))
      .limit(1);
    if (!latestVersion) {
      throw new NotFoundError("paywall version", `${current.id}:latest`);
    }

    const spec = suppliedSpec ?? assertSpec(current.draftSpec);
    const sameAsDraft = JSON.stringify(current.draftSpec) === JSON.stringify(spec);

    let version: PaywallVersion;
    let versionNumber = latestVersion.version;
    if (sameAsDraft) {
      const [publishedVersion] = await tx
        .update(paywallVersions)
        .set({ publishedAt: now })
        .where(eq(paywallVersions.id, latestVersion.id))
        .returning();
      if (!publishedVersion) {
        throw new NotFoundError("paywall version", latestVersion.id);
      }
      version = publishedVersion;
    } else {
      versionNumber += 1;
      [version] = await tx
        .insert(paywallVersions)
        .values({
          id: newId(),
          paywallId: current.id,
          version: versionNumber,
          spec,
          source: "published",
          actorType: input.actor.type,
          actorId: input.actor.id,
          createdAt: now,
          publishedAt: now,
        })
        .returning();
    }

    const [paywall] = await tx
      .update(paywalls)
      .set({
        draftSpec: spec,
        publishedSpec: spec,
        publishedAt: now,
        updatedBy: input.actor.type === "ai" ? "ai" : "user",
        updatedAt: now,
      })
      .where(eq(paywalls.id, input.paywallId))
      .returning();
    return { paywall, version };
  });

  await recordAudit({
    applicationId: null,
    actor: input.actor,
    action: "paywall.publish",
    entityType: "paywall",
    entityId: result.paywall.id,
    after: { publishedAt: now.toISOString(), version: result.version.version },
  });
  return result;
}

/** Restore an immutable snapshot by copying it into a new draft revision. */
export async function restorePaywallVersion(input: {
  paywallId: string;
  version: number;
  actor: Actor;
}): Promise<VersionedPaywallResult> {
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new ValidationError("version must be a positive integer");
  }

  const source = await requirePaywallVersion(input.paywallId, input.version);
  const now = new Date();
  const result = await db.transaction(async (tx): Promise<VersionedPaywallResult> => {
    const [current] = await tx
      .select()
      .from(paywalls)
      .where(eq(paywalls.id, input.paywallId))
      .limit(1);
    if (!current) throw new NotFoundError("paywall", input.paywallId);

    const [latestVersion] = await tx
      .select({ version: paywallVersions.version })
      .from(paywallVersions)
      .where(eq(paywallVersions.paywallId, current.id))
      .orderBy(desc(paywallVersions.version))
      .limit(1);
    if (!latestVersion) {
      throw new NotFoundError("paywall version", `${current.id}:latest`);
    }

    const nextVersion = latestVersion.version + 1;
    const [version] = await tx
      .insert(paywallVersions)
      .values({
        id: newId(),
        paywallId: current.id,
        version: nextVersion,
        spec: source.spec,
        source: "restored",
        restoredFromVersion: source.version,
        actorType: input.actor.type,
        actorId: input.actor.id,
        createdAt: now,
      })
      .returning();
    const [paywall] = await tx
      .update(paywalls)
      .set({
        draftSpec: source.spec,
        updatedBy: input.actor.type === "ai" ? "ai" : "user",
        updatedAt: now,
      })
      .where(eq(paywalls.id, input.paywallId))
      .returning();
    return { paywall, version };
  });

  await recordAudit({
    applicationId: null,
    actor: input.actor,
    action: "paywall.restore_version",
    entityType: "paywall",
    entityId: result.paywall.id,
    before: { version: input.version },
    after: { version: result.version.version },
  });
  return result;
}

export async function deletePaywall(input: { paywallId: string; actor: Actor }): Promise<void> {
  const before = await requirePaywall(input.paywallId);
  // The column is declared `on delete set null`, but SQLite only enforces that
  // with foreign keys switched on; clearing explicitly keeps it true regardless.
  await db
    .update(applications)
    .set({ paywallId: null })
    .where(eq(applications.paywallId, input.paywallId));
  await db.delete(paywalls).where(eq(paywalls.id, input.paywallId));

  await recordAudit({
    applicationId: null,
    actor: input.actor,
    action: "paywall.delete",
    entityType: "paywall",
    entityId: input.paywallId,
    before: { name: before.name },
  });
}

export async function listApplicationsUsingPaywall(paywallId: string) {
  return db
    .select({ id: applications.id, name: applications.name })
    .from(applications)
    .where(eq(applications.paywallId, paywallId));
}

export async function assignPaywallToApplication(input: {
  applicationId: string;
  paywallId: string | null;
  actor: Actor;
}): Promise<void> {
  if (input.paywallId) await requirePaywall(input.paywallId);
  const [before] = await db
    .select({ paywallId: applications.paywallId })
    .from(applications)
    .where(eq(applications.id, input.applicationId))
    .limit(1);
  if (!before) throw new NotFoundError("application", input.applicationId);

  await db
    .update(applications)
    .set({ paywallId: input.paywallId, updatedAt: new Date() })
    .where(eq(applications.id, input.applicationId));

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "paywall.assign",
    entityType: "application",
    entityId: input.applicationId,
    before: { paywallId: before.paywallId },
    after: { paywallId: input.paywallId },
  });
}

/** The template an application points at, published or not. */
export async function getApplicationPaywall(applicationId: string): Promise<Paywall | null> {
  const [row] = await db
    .select({ paywall: paywalls })
    .from(applications)
    .innerJoin(paywalls, eq(applications.paywallId, paywalls.id))
    .where(eq(applications.id, applicationId))
    .limit(1);
  return row?.paywall ?? null;
}

/** What the app should render: null until a template is assigned and published. */
export async function getPublishedPaywallForApplication(applicationId: string): Promise<{
  id: string;
  name: string;
  designVersion: number;
  publishedAt: Date;
  spec: PaywallSpec;
} | null> {
  const paywall = await getApplicationPaywall(applicationId);
  if (!paywall?.publishedSpec || !paywall.publishedAt) return null;

  const [publishedVersion] = await db
    .select({ version: paywallVersions.version })
    .from(paywallVersions)
    .where(
      and(
        eq(paywallVersions.paywallId, paywall.id),
        isNotNull(paywallVersions.publishedAt),
      ),
    )
    .orderBy(desc(paywallVersions.version))
    .limit(1);
  if (!publishedVersion) return null;

  return {
    id: paywall.id,
    name: paywall.name,
    designVersion: publishedVersion.version,
    publishedAt: paywall.publishedAt,
    spec: paywall.publishedSpec,
  };
}
