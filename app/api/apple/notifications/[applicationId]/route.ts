import { getAppleIntegration } from "@/lib/iap/configuration";
import {
  processStoredAppleNotification,
  markAppleNotificationDispatchFailed,
  verifyAndClaimAppleNotification,
} from "@/lib/iap/apple/notifications";
import { startAppleNotificationProcessing } from "@/lib/workflows/schedule";

const noStore = { "Cache-Control": "no-store" } as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    const integration = await getAppleIntegration(applicationId);
    if (!integration) return new Response(null, { status: 404, headers: noStore });
    const body = (await request.json().catch(() => null)) as
      | { signedPayload?: unknown }
      | null;
    if (typeof body?.signedPayload !== "string") {
      return new Response(null, { status: 400, headers: noStore });
    }
    const claim = await verifyAndClaimAppleNotification({
      applicationId,
      signedPayload: body.signedPayload,
    });
    if (!claim.duplicate) {
      if (process.env.IS_E2E === "true") {
        await processStoredAppleNotification(claim.event.id);
      } else {
        try {
          await startAppleNotificationProcessing(claim.event.id);
        } catch (error) {
          await markAppleNotificationDispatchFailed(claim.event.id);
          throw error;
        }
      }
    }
    return new Response(null, { status: 200, headers: noStore });
  } catch (error) {
    console.error("App Store notification failed:", error);
    return new Response(null, { status: 500, headers: noStore });
  }
}
