import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApplicationAccess } from "@/lib/console/session";
import { reconcilePlanCheckoutSession } from "@/lib/stripe/checkout";

/**
 * Return path from admin Checkout.
 *
 * This is a Route Handler rather than a page because `revalidatePath` may not
 * be called during a render.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const sessionId = new URL(request.url).searchParams.get("session_id");
  await requireApplicationAccess(appId);

  let status = "success";

  if (!sessionId) {
    status = "failed";
  } else {
    try {
      await reconcilePlanCheckoutSession({ applicationId: appId, sessionId });
      revalidatePath(`/apps/${appId}/subscriptions`);
    } catch (error) {
      console.error("Admin subscription checkout reconciliation failed:", error);
      status = "failed";
    }
  }

  redirect(`/apps/${encodeURIComponent(appId)}/subscriptions?checkout=${status}`);
}
