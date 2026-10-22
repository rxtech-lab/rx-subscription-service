"use client";

import { ArrowLeft, Boxes, Menu, Smartphone, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { BrandMark } from "@/components/console/brand-mark";
import { ApplicationNavigation } from "@/components/console/application-navigation";
import { UserMenu } from "@/components/console/user-menu";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Applications", icon: Boxes },
  { href: "/paywalls", label: "Paywalls", icon: Smartphone },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function ConsoleHeader({ displayName, email, application }: { displayName: string; email?: string; application?: { id: string; name: string } }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeTab = TABS.find((tab) => tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href));

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) dialogRef.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function navigation() {
    if (application) return (
      <div onClick={(event) => { if ((event.target as HTMLElement).closest("a")) dialogRef.current?.close(); }}>
        <p className="mb-2 px-3 text-base font-semibold text-slate-900 break-words">{application.name}</p>
        <ApplicationNavigation appId={application.id} />
      </div>
    );
    return (
      <nav aria-label="Console sections" className="space-y-2">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={() => dialogRef.current?.close()}
            aria-current={activeTab?.href === href ? "page" : undefined}
            className={cn("console-nav-link", activeTab?.href === href && "console-nav-link-active")}>
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    );
  }

  function brand() {
    return (
      <Link href="/" onClick={() => dialogRef.current?.close()} className="flex items-center gap-3 rounded-2xl p-2">
        <BrandMark />
        <div><p className="text-lg font-semibold tracking-tight">RxLab</p><p className="text-xs text-slate-500">Subscriptions</p></div>
      </Link>
    );
  }

  return (
    <>
      <a href="#console-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:p-4">Skip to content</a>
      <aside className="console-sidebar hidden lg:flex">
        {brand()}
        {application && <Link href="/" className="console-nav-link console-back-link mt-4 shrink-0"><ArrowLeft className="size-4" aria-hidden="true" />All applications</Link>}
        {!application && <p className="mb-4 mt-12 px-5 text-xs font-medium tracking-widest text-slate-500 uppercase">Workspace</p>}
        <div className={cn("min-h-0 flex-1 overflow-y-auto pb-4", application && "mt-4")}>{navigation()}</div>
        <div className="shrink-0 border-t border-blue-100 pt-4"><UserMenu displayName={displayName} email={email} sidebar /></div>
      </aside>
      <div className="shrink-0 px-4 py-3 lg:hidden">
        <button type="button" aria-label="Open navigation" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()} className="console-icon-button"><Menu className="size-5" /></button>
      </div>
      <dialog ref={dialogRef} aria-label="Navigation" className="console-navigation-dialog" onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
        <div className="flex h-full flex-col p-5">
          <div className="flex items-center justify-between gap-3">{brand()}<button type="button" aria-label="Close navigation" onClick={() => dialogRef.current?.close()} className="console-icon-button"><X className="size-5" /></button></div>
          {application && <Link href="/" onClick={() => dialogRef.current?.close()} className="console-nav-link console-back-link mt-4 shrink-0"><ArrowLeft className="size-4" aria-hidden="true" />All applications</Link>}
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-4">{navigation()}</div>
          <div className="shrink-0 border-t border-blue-100 pt-4"><UserMenu displayName={displayName} email={email} sidebar /></div>
        </div>
      </dialog>
    </>
  );
}
