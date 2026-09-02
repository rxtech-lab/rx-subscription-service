"use client";

import { Boxes, Smartphone, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/console/brand-mark";
import { UserMenu } from "@/components/console/user-menu";
import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** The two console-wide sections; everything else lives under an application. */
const TABS: Tab[] = [
  { href: "/", label: "Applications", icon: Boxes },
  { href: "/paywalls", label: "Paywalls", icon: Smartphone },
];

export function ConsoleHeader({
  displayName,
  email,
}: {
  displayName: string;
  email?: string;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <BrandMark />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-slate-950">RxLab</p>
              <p className="text-[11px] font-medium text-slate-400">Subscriptions</p>
            </div>
          </Link>

          <nav aria-label="Console sections" className="flex items-center gap-1">
            {TABS.map((tab) => {
              const active =
                tab.href === "/"
                  ? pathname === "/"
                  : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                  )}
                >
                  <Icon
                    className={cn("size-4", active ? "text-blue-600" : "text-slate-400")}
                    aria-hidden="true"
                  />
                  <span className="hidden sm:inline">{tab.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <UserMenu displayName={displayName} email={email} />
      </div>
    </header>
  );
}
