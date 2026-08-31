import { processStoredAppleNotification } from "@/lib/iap/apple/notifications";

async function processNotification(eventId: string) {
  "use step";
  await processStoredAppleNotification(eventId);
}

export async function appleNotificationWorkflow(eventId: string) {
  "use workflow";
  await processNotification(eventId);
}
