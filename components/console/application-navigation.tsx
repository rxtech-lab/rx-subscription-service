"use client";

import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  CircleDollarSign,
  Coins,
  FlaskConical,
  Gauge,
  IdCard,
  LayoutDashboard,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  Smartphone,
  TicketPercent,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const SECTIONS: NavigationItem[] = [
  { href: "", label: "Overview", icon: LayoutDashboard },
  { href: "/plans", label: "Plans", icon: BadgeDollarSign },
  { href: "/topups", label: "Topups", icon: CircleDollarSign },
  { href: "/coupons", label: "Coupons", icon: TicketPercent },
  { href: "/roles", label: "Roles", icon: IdCard },
  { href: "/permissions", label: "Permissions", icon: ShieldCheck },
  { href: "/usage-items", label: "Usage", icon: Gauge },
  { href: "/units", label: "Units", icon: Coins },
  { href: "/users", label: "Users", icon: UsersRound },
  { href: "/test", label: "Test", icon: FlaskConical },
  { href: "/subscriptions", label: "Subscriptions", icon: RefreshCcw },
  { href: "/paywall", label: "Paywall", icon: Smartphone },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function ApplicationNavigation({
  appId,
  orientation = "vertical",
}: {
  appId: string;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const baseHref = `/apps/${appId}`;

  return (
    <nav aria-label="Application navigation">
      <ul
        className={cn(
          orientation === "vertical" ? "space-y-1" : "flex min-w-max gap-1",
        )}
      >
        {SECTIONS.map((section) => {
          const href = `${baseHref}${section.href}`;
          const isActive = section.href
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === baseHref;
          const Icon = section.icon;

          return (
            <li key={section.href}>
              <Link
                href={href}
                prefetch={false}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                  orientation === "vertical"
                    ? "px-3 py-2.5"
                    : "px-3 py-2 whitespace-nowrap",
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-blue-600" : "text-slate-400",
                  )}
                  aria-hidden="true"
                />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
