import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  reconcilePlanCheckoutSession,
  reconcileTopupCheckoutSession,
} from "@/lib/stripe/checkout";
import { readTestSessionFor } from "@/lib/test-session";

/**
 * Return path from sandbox Checkout.
 *
 * Reconciling here means the storefront works without a webhook tunnel running
 * locally. The webhook performs the same fulfillment, and both paths are
 * idempotent, so whichever arrives second is a no-op.
 *
 * This is a Route Handler rather than a page because `revalidatePath` may not
 * be called during a render.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const query = new URL(request.url).searchParams;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  const base = `/test/${encodeURIComponent(appId)}`;
  if (query.get("status") === "cancelled") {
    redirect(`${base}?checkout=cancelled`);
  }

  const sessionId = query.get("session_id");
  const kind = query.get("kind");
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
