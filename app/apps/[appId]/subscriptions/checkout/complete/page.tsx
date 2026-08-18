import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApplicationAccess } from "@/lib/console/session";
import { reconcilePlanCheckoutSession } from "@/lib/stripe/checkout";

export default async function CompleteSubscriptionCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { appId } = await params;
  const { session_id: rawSessionId } = await searchParams;
  await requireApplicationAccess(appId);

  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
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
