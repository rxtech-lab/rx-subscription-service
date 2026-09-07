import { recordAppleLog } from "@/lib/iap/apple/logs";
import { z } from "zod";
import { appleDiagnosticFingerprint, appleUserDiagnostic } from "@/lib/iap/apple/diagnostics";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
  resolveRequestUser,
} from "@/lib/api/context";
import {
  getOrCreateStoreAccountLink,
  requireAppleIntegration,
} from "@/lib/iap/configuration";

const schema = z.object({ rxlabUserId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "apple.account-token");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request");
    }
    await requireAppleIntegration(context.application.id);
    const user = await resolveRequestUser(context, parsed.data);
    const link = await getOrCreateStoreAccountLink(user);
    console.info("apple_iap.account_token_resolved", {
      user: appleUserDiagnostic(user),
      accountLinkId: link.id,
      accountTokenFingerprint: appleDiagnosticFingerprint(link.providerAccountToken.toLowerCase()),
    });
    await recordAppleLog(context.application.id, user.id, "account_token_resolved", {
      level: "info", environment: context.environment, accountToken: link.providerAccountToken,
      info: { accountLinkId: link.id },
    });
    return Response.json(
      { appAccountToken: link.providerAccountToken, environment: context.environment },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
