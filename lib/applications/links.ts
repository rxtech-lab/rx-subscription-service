import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { applications, type Application } from "@/lib/db/schema";
import { NotFoundError, recordAudit, ValidationError, type Actor } from "@/lib/subscription/shared";

export class ApplicationLinkError extends ValidationError {
  constructor(readonly code: "application_disabled" | "invalid_application_link", message: string) {
    super(message);
  }
}

async function findApplication(id: string, executor: DbExecutor = db) {
  const [application] = await executor.select().from(applications)
    .where(eq(applications.id, id)).limit(1);
  return application;
}

/** Resolve the shared data owner. Never fall back to an alias's dormant data. */
export async function resolveLinkedApplication(
  source: Application,
  lookup: (id: string) => Promise<Application | undefined> = findApplication,
): Promise<Application> {
  const visited = new Set<string>();
  let application = source;
  while (true) {
    if (visited.has(application.id)) {
      throw new ApplicationLinkError("invalid_application_link", "Application links cannot form a circle.");
    }
    visited.add(application.id);
    if (application.status !== "active") {
      throw new ApplicationLinkError("application_disabled", "Application or linked application is disabled.");
    }
    const targetId = application.linkedApplicationId;
    if (!targetId) return application;
    // Check before fetching so corrupt self-links and cycles terminate immediately.
    if (visited.has(targetId)) {
      throw new ApplicationLinkError("invalid_application_link", "Application links cannot form a circle.");
    }
    const target = await lookup(targetId);
    if (!target) {
      throw new ApplicationLinkError("invalid_application_link", "Linked application is unavailable.");
    }
    application = target;
  }
}

export async function getApplicationLinkSettings(applicationId: string, managedApplicationIds: string[]) {
  const rows = managedApplicationIds.length
    ? await db.select().from(applications).where(inArray(applications.id, managedApplicationIds))
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const source = byId.get(applicationId);
  if (!source) throw new NotFoundError("application", applicationId);
  const lookup = async (id: string) => byId.get(id);
  const options: { id: string; name: string; effectiveName: string }[] = [];
  for (const candidate of rows) {
    if (candidate.id === applicationId) continue;
    try {
      const effective = await resolveLinkedApplication({ ...source, linkedApplicationId: candidate.id }, lookup);
      options.push({ id: candidate.id, name: candidate.name, effectiveName: effective.name });
    } catch (error) {
      if (!(error instanceof ApplicationLinkError)) throw error;
    }
  }
  let effectiveApplication: Application | null = null;
  let error: string | null = null;
  if (source.linkedApplicationId) {
    try {
      effectiveApplication = await resolveLinkedApplication(source, lookup);
    } catch (cause) {
      if (!(cause instanceof ApplicationLinkError)) throw cause;
      error = cause.message;
    }
  }
  return {
    linkedApplicationId: source.linkedApplicationId,
    effectiveApplication,
    error,
    options: options.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

type ApplicationReference = Pick<Application, "id" | "name">;

export interface ApplicationLinkSummary {
  linkedTo: ApplicationReference | null;
  effectiveApplication: ApplicationReference | null;
  sharedWith: ApplicationReference[];
  unavailable: boolean;
}

/** One scoped query for the application list; never reveal inaccessible targets. */
export async function getApplicationLinkSummaries(
  managedApplicationIds: string[],
): Promise<Record<string, ApplicationLinkSummary>> {
  if (managedApplicationIds.length === 0) return {};
  const rows = await db.select().from(applications)
    .where(inArray(applications.id, managedApplicationIds));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const reference = ({ id, name }: Application): ApplicationReference => ({ id, name });
  const summaries = new Map<string, ApplicationLinkSummary>(rows.map((row) => [row.id, {
    linkedTo: null,
    effectiveApplication: null,
    sharedWith: [],
    unavailable: false,
  }]));

  for (const source of rows) {
    if (!source.linkedApplicationId) continue;
    const summary = summaries.get(source.id)!;
    const directTarget = byId.get(source.linkedApplicationId);
    summary.linkedTo = directTarget ? reference(directTarget) : null;
    try {
      const effective = await resolveLinkedApplication(source, async (id) => byId.get(id));
      summary.effectiveApplication = reference(effective);
      summaries.get(effective.id)!.sharedWith.push(reference(source));
    } catch (error) {
      if (!(error instanceof ApplicationLinkError)) throw error;
      summary.unavailable = true;
    }
  }
  for (const summary of summaries.values()) {
    summary.sharedWith.sort((a, b) => a.name.localeCompare(b.name));
  }
  return Object.fromEntries(summaries);
}

/** The caller must supply the admin's freshly authorized application list. */
export async function updateApplicationLink(input: {
  applicationId: string;
  linkedApplicationId: string | null;
  managedApplicationIds: string[];
  actor: Actor;
}) {
  const allowed = new Set(input.managedApplicationIds);
  if (!allowed.has(input.applicationId)) throw new ValidationError("You cannot manage this application.");

  return db.transaction(async (tx) => {
    // Serialize graph edits: simultaneous A -> B and B -> A must not both pass
    // validation against the previous graph. This lock lives only for the transaction.
    await tx.execute(sql`select pg_advisory_xact_lock(72691, 1)`);
    const source = await findApplication(input.applicationId, tx);
    if (!source) throw new NotFoundError("application", input.applicationId);
    if (input.linkedApplicationId) {
      await resolveLinkedApplication({ ...source, linkedApplicationId: input.linkedApplicationId }, async (id) => {
        if (!allowed.has(id)) {
          throw new ValidationError("You must be able to manage every application in the link.");
        }
        return findApplication(id, tx);
      });
    }
    await tx.update(applications).set({
      linkedApplicationId: input.linkedApplicationId,
      updatedAt: new Date(),
    }).where(eq(applications.id, input.applicationId));
    await recordAudit({
      applicationId: input.applicationId,
      actor: input.actor,
      action: "application.link.update",
      entityType: "application",
      entityId: input.applicationId,
      before: { linkedApplicationId: source.linkedApplicationId },
      after: { linkedApplicationId: input.linkedApplicationId },
    }, tx);
  });
}
