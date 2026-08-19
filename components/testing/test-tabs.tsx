"use client";

import { FlaskConical, ListChecks } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The two halves of the Test tab: the disposable users you click through by
 * hand, and the suites that click through it for you.
 */
const TABS = [
  { href: "", label: "Test users", icon: FlaskConical },
  { href: "/cases", label: "Test cases", icon: ListChecks },
];

export function TestTabs({ appId }: { appId: string }) {
  const pathname = usePathname();
  const base = `/apps/${appId}/test`;

  // A detail page is a level down from the tabs, not a third tab. Showing them
  // there would offer a sideways move out of a suite you may be mid-edit in;
  // that page carries its own "back to Test cases" link instead.
  const isDetail = TABS.some(
    (tab) => tab.href && pathname.startsWith(`${base}${tab.href}/`),
  );
  if (isDetail) return null;

  return (
    <nav aria-label="Test sections">
      <ul className="inline-flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white p-1">
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          const isActive = tab.href ? pathname.startsWith(href) : pathname === base;
          const Icon = tab.icon;

          return (
            <li key={tab.href}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
