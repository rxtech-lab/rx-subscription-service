"use server";

import { clearAssistantMessages } from "@/lib/ai/conversations";
import {
  requireApplicationAccess,
  requireConsoleUser,
} from "@/lib/console/session";

export async function clearAssistantConversationAction(
  applicationId: string,
): Promise<void> {
  const user = await requireConsoleUser();
  await requireApplicationAccess(applicationId);
  await clearAssistantMessages(applicationId, user.id);
}
