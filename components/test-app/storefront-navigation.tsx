"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/plans", label: "Plans" },
  { href: "/topups", label: "Topups" },
  { href: "/payments", label: "Payments" },
  { href: "/gated", label: "Members" },
];

/**
 * Storefront tabs. A client component only because the active tab depends on the
 * current path — same reason `ApplicationNavigation` is one.
 */
export function StorefrontNavigation({ appId }: { appId: string }) {
  const pathname = usePathname();
  const baseHref = `/test/${encodeURIComponent(appId)}`;

  return (
    <nav aria-label="Test app" className="mt-3 flex gap-1">
      {TABS.map((tab) => {
        const href = `${baseHref}${tab.href}`;
        // Overview matches exactly; the others also match their subpaths, so
        // returning from Checkout still highlights the tab you left from.
        const isActive = tab.href
          ? pathname === href || pathname.startsWith(`${href}/`)
          : pathname === baseHref;

        return (
          <Link
            key={tab.href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
              isActive
                ? "bg-blue-50 text-blue-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
