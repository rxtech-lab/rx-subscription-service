import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, ShieldCheck, Sparkles } from "lucide-react";
import { ApplicationGrid } from "@/components/console/application-grid";
import { BrandMark } from "@/components/console/brand-mark";
import { UserMenu } from "@/components/console/user-menu";
import { Card, EmptyState } from "@/components/ui/primitives";
import { authStatus } from "@/lib/auth";
import { getConsoleUser, getManagedApplications } from "@/lib/console/session";

export default async function HomePage() {
  if (!authStatus.configured) {
    return (
      <main className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden px-6 py-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(20,184,166,0.09),transparent_32%)]" />
        <Card className="relative w-full max-w-lg overflow-hidden p-8 shadow-xl shadow-slate-200/60">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold text-slate-950">RxLab</p>
              <p className="text-xs text-slate-500">Subscriptions</p>
            </div>
          </div>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight text-slate-950">
            Connect your RxLab account
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Authentication needs to be configured before the subscription console
            can load your applications.
          </p>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Set <code>AUTH_ISSUER</code>, <code>AUTH_CLIENT_ID</code>,{" "}
            <code>AUTH_CLIENT_SECRET</code>, and <code>AUTH_SECRET</code>, then restart
            the server.
          </div>
        </Card>
      </main>
    );
  }

  const user = await getConsoleUser();
  if (!user) redirect("/login");

  const applications = await getManagedApplications();
  const displayName = user.name || user.email || "Admin";

  return (
    <div className="min-h-full bg-[#f7f8fc]">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <BrandMark />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-slate-950">
                RxLab
              </p>
              <p className="text-[11px] font-medium text-slate-400">Subscriptions</p>
            </div>
          </Link>

          <UserMenu displayName={displayName} email={user.email} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <section className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-slate-950 px-6 py-9 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.75)] sm:px-10 sm:py-11">
          <div className="absolute -right-20 -top-36 size-80 rounded-full bg-blue-500/25 blur-3xl" />
          <div className="absolute -bottom-40 right-52 size-72 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-sky-200">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Subscription workspace
              </div>
              <h1
                id="applications-heading"
                className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl"
              >
                Manage every product from one place.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                Configure plans, access, usage, and billing for the applications your
                RxLab permissions allow you to manage.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:flex">
              <div className="min-w-32 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Boxes className="size-3.5" aria-hidden="true" />
                  Applications
                </div>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {applications.length}
                </p>
              </div>
              <div className="min-w-32 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  Access
                </div>
                <p className="mt-1 text-sm font-semibold text-emerald-300">Authorized</p>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-10">
          {applications.length === 0 ? (
            <Card className="border-dashed py-8">
              <EmptyState
                title="No applications available"
                description="Your RxLab account needs the read:oauth_clients permission to manage subscription settings."
              />
            </Card>
          ) : (
            <ApplicationGrid applications={applications} />
          )}
        </div>
      </main>
    </div>
  );
}
