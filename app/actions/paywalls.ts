"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApplicationAccess } from "@/lib/console/session";
import { resolvePaywall, type CatalogProduct } from "@/lib/paywall/export";
import {
  assignPaywallToApplication,
  createPaywall,
  deletePaywall,
  duplicatePaywall,
  listApplicationsUsingPaywall,
  publishPaywall,
  renamePaywall,
  requirePaywall,
  restorePaywallVersion,
  saveDraft,
  type PaywallVersionSnapshot,
} from "@/lib/paywall/paywalls";
import { productsForApplication } from "@/lib/paywall/products";
import { validatePaywallSpec, type PaywallSpec } from "@/lib/paywall/schema";
import {
  optionalText,
  revalidateApp,
  text,
  toActionState,
  withApplication,
  withConsoleUser,
  type ActionState,
} from "./shared";

/**
 * Paywall templates are console-wide, so most of these run under
 * `withConsoleUser` rather than `withApplication`. The one exception is
 * assigning a template to an application, which is that application's setting
 * and is authorized against it.
 *
 * The list uses `FormData` like every other console table; the editor takes
 * objects, because saving a document on ⌘S is not a form submission.
 */

function revalidatePaywall(paywallId?: string) {
  revalidatePath("/paywalls");
  if (paywallId) revalidatePath(`/paywalls/${paywallId}`);
}

export interface PaywallVersionData {
  id: string;
  paywallId: string;
  version: number;
  spec: PaywallSpec;
  source: PaywallVersionSnapshot["source"];
  restoredFromVersion: number | null;
  actorType: PaywallVersionSnapshot["actorType"];
  actorId: string | null;
  createdAt: string;
  publishedAt: string | null;
}

function serializePaywallVersion(version: PaywallVersionSnapshot): PaywallVersionData {
  return {
    id: version.id,
    paywallId: version.paywallId,
    version: version.version,
    spec: version.spec,
    source: version.source,
    restoredFromVersion: version.restoredFromVersion,
    actorType: version.actorType,
    actorId: version.actorId,
    createdAt: version.createdAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
  };
}

/** A publish changes what every assigned application shows. */
async function revalidateAssignedApplications(paywallId: string) {
  const assigned = await listApplicationsUsingPaywall(paywallId);
  for (const application of assigned) {
    revalidateApp(application.id, "paywall");
    revalidateApp(application.id);
  }
}

export async function createPaywallAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let destination: string | null = null;
  try {
    const state = await withConsoleUser(async ({ actor }) => {
      const paywall = await createPaywall({
        actor,
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
        template: text(formData, "template") || "classic",
      });
      revalidatePaywall();
      destination = `/paywalls/${paywall.id}`;
      return { success: `Created ${paywall.name}` };
    });
    if (destination) redirect(destination);
    return state;
  } catch (error) {
    return toActionState(error);
  }
}

export async function renamePaywallAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const paywallId = text(formData, "paywallId");
  try {
    return await withConsoleUser(async ({ actor }) => {
      await renamePaywall({
        actor,
        paywallId,
        name: text(formData, "name"),
        description: optionalText(formData, "description"),
      });
      revalidatePaywall(paywallId);
      return { success: "Saved" };
    });
  } catch (error) {
    return toActionState(error);
  }
}

export async function duplicatePaywallAction(formData: FormData): Promise<void> {
  const paywallId = text(formData, "paywallId");
  const copy = await withConsoleUser(({ actor }) => duplicatePaywall({ actor, paywallId }));
  revalidatePaywall();
  redirect(`/paywalls/${copy.id}`);
}

export async function deletePaywallAction(formData: FormData): Promise<void> {
  const paywallId = text(formData, "paywallId");
  const assigned = await listApplicationsUsingPaywall(paywallId);
  await withConsoleUser(({ actor }) => deletePaywall({ actor, paywallId }));
  revalidatePaywall(paywallId);
  for (const application of assigned) {
    revalidateApp(application.id, "paywall");
    revalidateApp(application.id);
  }
  redirect("/paywalls");
}

export async function setApplicationPaywallAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  const paywallId = optionalText(formData, "paywallId");
  try {
    await withApplication(applicationId, async ({ actor }) => {
      await assignPaywallToApplication({ applicationId, paywallId, actor });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "paywall");
  revalidateApp(applicationId);
  revalidatePath("/paywalls");
  return { success: paywallId ? "Paywall assigned." : "Paywall cleared." };
}

export async function savePaywallDraftAction(input: {
  paywallId: string;
  spec: unknown;
}): Promise<ActionState & { updatedAt?: string; version?: PaywallVersionData }> {
  try {
    return await withConsoleUser(async ({ actor }) => {
      const saved = await saveDraft({ actor, paywallId: input.paywallId, spec: input.spec });
      revalidatePaywall(input.paywallId);
      return {
        success: "Draft saved",
        updatedAt: saved.paywall.updatedAt.toISOString(),
        version: serializePaywallVersion(saved.version),
      };
    });
  } catch (error) {
    return toActionState(error);
  }
}

export async function publishPaywallAction(input: {
  paywallId: string;
  spec?: unknown;
}): Promise<ActionState & { publishedAt?: string; version?: PaywallVersionData }> {
  try {
    return await withConsoleUser(async ({ actor }) => {
      const published = await publishPaywall({
        actor,
        paywallId: input.paywallId,
        spec: input.spec,
      });
      revalidatePaywall(input.paywallId);
      await revalidateAssignedApplications(input.paywallId);
      return {
        success: "Published",
        publishedAt: published.paywall.publishedAt?.toISOString(),
        version: serializePaywallVersion(published.version),
      };
    });
  } catch (error) {
    return toActionState(error);
  }
}

export async function restorePaywallVersionAction(input: {
  paywallId: string;
  version: number;
}): Promise<
  ActionState & {
    spec?: PaywallSpec;
    version?: PaywallVersionData;
    updatedAt?: string;
  }
> {
  try {
    return await withConsoleUser(async ({ actor }) => {
      const restored = await restorePaywallVersion({
        actor,
        paywallId: input.paywallId,
        version: input.version,
      });
      revalidatePaywall(input.paywallId);
      return {
        success: `Version ${input.version} restored`,
        spec: restored.paywall.draftSpec,
        version: serializePaywallVersion(restored.version),
        updatedAt: restored.paywall.updatedAt.toISOString(),
      };
    });
  } catch (error) {
    return toActionState(error);
  }
}

/**
 * The export JSON, optionally with one application's real plans filled in.
 * `spec` lets the editor export its unsaved buffer; otherwise the stored draft
 * or published copy is used.
 */
export async function exportPaywallAction(input: {
  paywallId: string;
  applicationId?: string | null;
  which: "draft" | "published";
  spec?: unknown;
}): Promise<{ json?: string; error?: string }> {
  try {
    return await withConsoleUser(async () => {
      const paywall = await requirePaywall(input.paywallId);
      let source: unknown = input.spec;
      if (source === undefined) {
        source = input.which === "published" ? paywall.publishedSpec : paywall.draftSpec;
      }
      if (!source) return { error: "This paywall has not been published yet." };
      const validated = validatePaywallSpec(source);
      if (!validated.ok) return { error: validated.error };

      let products: CatalogProduct[] = [];
      if (input.applicationId) {
        await requireApplicationAccess(input.applicationId);
        products = await productsForApplication(input.applicationId);
      }
      const resolved = resolvePaywall(validated.spec, products);
      return { json: JSON.stringify(resolved, null, 2) };
    });
  } catch (error) {
    return toActionState(error);
  }
}

/** Real plans to preview a template with, from an application the admin manages. */
export async function previewProductsAction(input: {
  applicationId: string;
}): Promise<{ products?: CatalogProduct[]; error?: string }> {
  try {
    return await withConsoleUser(async () => {
      await requireApplicationAccess(input.applicationId);
      return { products: await productsForApplication(input.applicationId) };
    });
  } catch (error) {
    return toActionState(error);
  }
}
