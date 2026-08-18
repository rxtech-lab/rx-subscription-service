import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { StorefrontNavigation } from "@/components/test-app/storefront-navigation";
import { readTestSessionFor } from "@/lib/test-session";

/**
 * The simulated storefront: what a subscriber of this application would see.
 *
 * Deliberately plain, and deliberately loud about being a simulation — every
 * page carries the banner so a screenshot from here is never mistaken for
 * production, and every charge runs through the Stripe sandbox account.
 */
export default async function TestAppLayout({
  children,
  params,
}: LayoutProps<"/test/[appId]">) {
  const { appId } = await params;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="border-b border-amber-300 bg-amber-100">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-5 py-2.5 text-sm text-amber-900">
          <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
          <span className="font-semibold">Test mode</span>
          <span className="text-amber-800">
            signed in as {session.user.displayName || "test user"} · Stripe sandbox ·
            no real charges
          </span>
        </div>
      </div>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-4">
          <h1 className="text-base font-semibold text-slate-950">
            {session.applicationName}
          </h1>
          <StorefrontNavigation appId={appId} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-5 py-6">{children}</main>
    </div>
  );
}
