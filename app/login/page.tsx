import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/console/brand-mark";
import { Button, Card } from "@/components/ui/primitives";
import { ToastForm } from "@/components/ui/toast";
import { authStatus, signIn } from "@/lib/auth";
import { getConsoleUser } from "@/lib/console/session";

export default async function LoginPage() {
  const user = await getConsoleUser();
  if (user) redirect("/");

  async function startSignIn() {
    "use server";
    await signIn("rxlab", { redirectTo: "/" });
  }

  return (
    <main className="relative flex min-h-full w-full flex-1 items-center justify-center overflow-hidden px-6 py-16">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(59,130,246,0.13),transparent_30%),radial-gradient(circle_at_80%_85%,rgba(6,182,212,0.1),transparent_28%)]" />
      <Card className="relative w-full max-w-md overflow-hidden p-7 shadow-[0_30px_80px_-42px_rgba(15,23,42,0.55)] sm:p-8">
        <div className="flex items-center gap-3">
          <BrandMark className="size-10" />
          <div>
            <p className="text-sm font-semibold text-slate-950">RxLab</p>
            <p className="text-xs text-slate-500">Subscriptions</p>
          </div>
        </div>

        <div className="mt-9">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <ShieldCheck className="size-3" aria-hidden="true" />
            Secure console
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">
            Welcome back
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Sign in to manage subscription and billing settings for your RxLab
            applications.
          </p>
        </div>

        {authStatus.configured ? (
          <ToastForm
            action={startSignIn}
            pendingMessage="Signing in…"
            className="mt-8"
          >
            <Button type="submit" className="w-full justify-between px-4">
              <span />
              Sign in with RxLab
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </ToastForm>
        ) : (
          <p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            RxLab auth is not configured on this deployment.
          </p>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          Access is limited to applications permitted by your RxLab account.
        </p>
      </Card>
    </main>
  );
}
