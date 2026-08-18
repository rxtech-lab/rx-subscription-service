import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  reconcilePlanCheckoutSession,
  reconcileTopupCheckoutSession,
} from "@/lib/stripe/checkout";
import { readTestSessionFor } from "@/lib/test-session";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Return path from sandbox Checkout.
 *
 * Reconciling here means the storefront works without a webhook tunnel running
 * locally. The webhook performs the same fulfillment, and both paths are
 * idempotent, so whichever arrives second is a no-op.
 */
export default async function TestCheckoutCompletePage({
  params,
  searchParams,
}: PageProps<"/test/[appId]/checkout/complete">) {
  const { appId } = await params;
  const query = await searchParams;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  const base = `/test/${encodeURIComponent(appId)}`;
  if (first(query.status) === "cancelled") {
    redirect(`${base}?checkout=cancelled`);
  }

  const sessionId = first(query.session_id);
  const kind = first(query.kind);
  if (!sessionId || (kind !== "plan" && kind !== "topup")) {
    redirect(`${base}?checkout=failed`);
  }

  let status = "success";
  try {
    if (kind === "plan") {
      await reconcilePlanCheckoutSession({
        applicationId: appId,
        sessionId,
        mode: "sandbox",
      });
    } else {
      const result = await reconcileTopupCheckoutSession({
        applicationId: appId,
        sessionId,
        mode: "sandbox",
      });
      if (result.status === "pending") status = "pending";
    }
    revalidatePath(base);
    revalidatePath(`/apps/${appId}/test`);
  } catch (error) {
    console.error("Test checkout reconciliation failed:", error);
    status = "failed";
  }

  redirect(`${base}?checkout=${status}`);
}
