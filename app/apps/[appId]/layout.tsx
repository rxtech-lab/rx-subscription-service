import { notFound } from "next/navigation";
import { AssistantPanel } from "@/components/ai/assistant-panel";
import { ConsoleHeader } from "@/components/console/console-header";
import { getAssistantMessages } from "@/lib/ai/conversations";
import { testRunIdsInMessages } from "@/lib/ai/test-run-parts";
import {
  ApplicationAccessError,
  requireApplicationAccess,
  requireConsoleUser,
} from "@/lib/console/session";
import { readRunSnapshots } from "@/lib/testing/runs";

// Automatic suites run in `after()`, and the harness allows a four-minute run.
export const maxDuration = 300;

export default async function ApplicationLayout({
  children,
  params,
}: LayoutProps<"/apps/[appId]">) {
  const { appId } = await params;
  const user = await requireConsoleUser();

  let application;
  try {
    application = await requireApplicationAccess(appId);
  } catch (error) {
    if (error instanceof ApplicationAccessError) notFound();
    throw error;
  }

  const initialAssistantMessages = await getAssistantMessages(appId, user.id);
  // The transcript replays every run it ever triggered. Reading them here means
  // a finished one is drawn from what is already on the page rather than from a
  // request each card makes for itself every time the panel is opened.
  const assistantRunSnapshots = await readRunSnapshots(
    appId,
    testRunIdsInMessages(initialAssistantMessages),
  );

  return (
    <div className="h-dvh overflow-hidden bg-[var(--md-surface-container)]">
      <div className="flex h-full min-h-0 w-full items-start">
        <div className="console-shell min-w-0 flex-1 lg:pl-64">
          <ConsoleHeader application={{ id: appId, name: application.name }} displayName={user.name || user.email || "Admin"} email={user.email} />
          <main className="console-content-surface min-w-0">
            <div id="console-content" tabIndex={-1} className="console-content-scroll px-5 py-6 sm:px-8 sm:py-8 xl:px-8 xl:py-10 2xl:px-10">
              {children}
            </div>
          </main>
        </div>

        <AssistantPanel
          applicationId={appId}
          applicationName={application.name}
          initialMessages={initialAssistantMessages}
          runSnapshots={assistantRunSnapshots}
        />
      </div>
    </div>
  );
}
