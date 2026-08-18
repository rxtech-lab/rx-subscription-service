"use client";

import { ArrowUpRight, Boxes, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

interface ApplicationSummary {
  id: string;
  name: string;
  description: string | null;
}

const ACCENTS = [
  {
    icon: "bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white",
    dot: "bg-blue-500",
  },
  {
    icon: "bg-cyan-50 text-cyan-600 group-hover:bg-cyan-600 group-hover:text-white",
    dot: "bg-cyan-500",
  },
  {
    icon: "bg-amber-50 text-amber-600 group-hover:bg-amber-500 group-hover:text-white",
    dot: "bg-amber-500",
  },
  {
    icon: "bg-rose-50 text-rose-600 group-hover:bg-rose-500 group-hover:text-white",
    dot: "bg-rose-500",
  },
] as const;

function initials(name: string): string {
  return name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function ApplicationGrid({
  applications,
}: {
  applications: ApplicationSummary[];
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredApplications = useMemo(
    () =>
      normalizedQuery
        ? applications.filter(
            (application) =>
              application.name.toLowerCase().includes(normalizedQuery) ||
              application.id.toLowerCase().includes(normalizedQuery) ||
              application.description?.toLowerCase().includes(normalizedQuery),
          )
        : applications,
    [applications, normalizedQuery],
  );

  return (
    <section aria-labelledby="applications-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {filteredApplications.length === applications.length
              ? `${applications.length} application${applications.length === 1 ? "" : "s"}`
              : `${filteredApplications.length} of ${applications.length} applications`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Select an application to open its subscription workspace.
          </p>
        </div>

        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search applications</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search applications..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </label>
      </div>

      {filteredApplications.length === 0 ? (
        <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <Search className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-sm font-semibold text-slate-900">
            No matching applications
          </h2>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Try a different name, description, or client identifier.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredApplications.map((application, index) => {
            const accent = ACCENTS[index % ACCENTS.length];

            return (
              <Link
                key={application.id}
                href={`/apps/${application.id}`}
                className="group relative flex min-h-56 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_45px_-24px_rgba(15,23,42,0.35)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
              >
                <div className="flex items-start justify-between gap-4">
                  <span
                    className={`flex size-11 items-center justify-center rounded-2xl text-sm font-bold tracking-tight transition duration-200 ${accent.icon}`}
                    aria-hidden="true"
                  >
                    {initials(application.name) || <Boxes className="size-5" />}
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-blue-600">
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </span>
                </div>

                <div className="mt-7 flex-1">
                  <h2 className="text-base font-semibold tracking-[-0.01em] text-slate-950">
                    {application.name}
                  </h2>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                    {application.description ||
                      "Manage plans, permissions, usage, and billing settings."}
                  </p>
                </div>

                <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${accent.dot}`}
                    aria-hidden="true"
                  />
                  <span className="truncate font-mono text-[11px] text-slate-400">
                    {application.id}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
