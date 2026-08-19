import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, ChevronRight } from "lucide-react";
import { AssistantPanel } from "@/components/ai/assistant-panel";
import { ApplicationNavigation } from "@/components/console/application-navigation";
import { BrandMark } from "@/components/console/brand-mark";
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
    <div className="min-h-full bg-[#f7f8fc]">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              prefetch={false}
              className="flex shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              aria-label="All applications"
            >
              <BrandMark />
              <span className="hidden text-sm font-semibold tracking-tight text-slate-950 sm:block">
                RxLab
              </span>
            </Link>
            <ChevronRight className="hidden size-4 shrink-0 text-slate-300 sm:block" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {application.name}
              </p>
              <p className="hidden truncate font-mono text-[10px] text-slate-400 sm:block">
                {application.id}
              </p>
            </div>
          </div>

          <Link
            href="/"
            prefetch={false}
            className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">All applications</span>
          </Link>
        </div>

        <div className="overflow-x-auto border-t border-slate-100 px-4 py-2 lg:hidden">
          <Suspense fallback={<div className="h-9" />}>
            <ApplicationNavigation appId={appId} orientation="horizontal" />
          </Suspense>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1440px] items-start">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 flex-col border-r border-slate-200/70 px-5 py-7 lg:flex">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Workspace
          </p>
          <div className="mt-3">
            <Suspense fallback={<div className="h-96" />}>
              <ApplicationNavigation appId={appId} />
            </Suspense>
          </div>

          <div className="mt-auto rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
            <span className="flex size-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            <p className="mt-3 text-xs font-semibold text-slate-900">
              Need a hand?
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Use the assistant to configure this workspace in plain language.
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>

      <AssistantPanel
        applicationId={appId}
        applicationName={application.name}
        initialMessages={initialAssistantMessages}
        runSnapshots={assistantRunSnapshots}
      />
    </div>
  );
}
