import { redirect } from "next/navigation";
import { requireApplicationAccess, requireConsoleUser } from "@/lib/console/session";
import { requireTestUser } from "@/lib/subscription/test-users";
import { mintTestSession, setTestSessionCookie } from "@/lib/test-session";

/**
 * Open the simulated storefront as a test user.
 *
 * Living under `/apps` means the console session already gates this, so the
 * "Test user" action is a plain link — no token is ever placed in a URL where it
 * could leak through history, referrers, or a shared screenshot.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ appId: string; userId: string }> },
) {
  const { appId, userId } = await params;
  await requireConsoleUser();
  await requireApplicationAccess(appId);
  const user = await requireTestUser(appId, userId);

  await setTestSessionCookie(
    await mintTestSession({ applicationId: appId, appUserId: user.id }),
  );
  redirect(`/test/${appId}`);
}
