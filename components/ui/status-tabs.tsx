import Link from "next/link";
import { cn } from "@/lib/utils";

export interface StatusTab {
  id: string;
  label: string;
  count: number;
  href: string;
}

/**
 * The status filter above a catalog table. The active tab lives in the URL, so
 * a filtered view survives a reload and can be linked to or shared.
 */
export function StatusTabs({
  label,
  tabs,
  activeTab,
}: {
  label: string;
  tabs: readonly StatusTab[];
  activeTab: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="inline-flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white p-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;

          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                    isActive
                      ? "bg-white/15 text-white"
                      : "bg-slate-100 text-slate-500",
                  )}
                >
                  {tab.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
