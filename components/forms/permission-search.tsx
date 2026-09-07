"use client";

import { useEffect, useId, useState } from "react";
import { searchPermissionKeysAction } from "@/app/actions/access";
import type { PermissionSuggestion } from "@/lib/permissions/search";
import { Input, Select } from "@/components/ui/primitives";

export function PermissionSearch({ applicationId, initialQuery, initialGroup, groups }: {
  applicationId: string;
  initialQuery: string;
  initialGroup: string;
  groups: string[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [group, setGroup] = useState(initialGroup);
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<PermissionSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState("Loading suggestions…");
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const results = await searchPermissionKeysAction(applicationId, query, group);
        if (!current) return;
        setMatches(results);
        setStatus(results.length ? "" : "No matching keys");
      } catch {
        if (current) setStatus("Could not load suggestions. Try typing again.");
      }
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [applicationId, query, group, open]);

  function resetSuggestions() {
    setMatches([]);
    setActive(-1);
    setStatus("Loading suggestions…");
  }

  function choose(match: PermissionSuggestion) {
    setQuery(match.key);
    setOpen(false);
    setActive(-1);
  }

  return (
    <form className="flex flex-wrap gap-3 border-b border-neutral-200 p-4">
      <div className="relative w-full sm:max-w-xs" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}>
        <Input name="q" role="combobox" aria-label="Search permissions" placeholder="Search by key"
          autoComplete="off" maxLength={200} value={query} aria-autocomplete="list"
          aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          onFocus={() => { resetSuggestions(); setOpen(true); }}
          onChange={(event) => { resetSuggestions(); setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) { resetSuggestions(); setOpen(true); }
              else if (matches.length) setActive((index) => event.key === "ArrowDown"
                ? (index + 1) % matches.length : (index <= 0 ? matches.length - 1 : index - 1));
            }
            if (event.key === "Enter" && open && active >= 0 && matches[active]) {
              event.preventDefault(); choose(matches[active]);
            }
          }} />
        {open ? (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            {status ? <p role="status" className="px-3 py-2 text-sm text-slate-500">{status}</p> : null}
            <ul id={listId} role="listbox" aria-label="Matching permission keys">
              {matches.map((match, index) => (
                <li key={match.id} id={`${listId}-${index}`} role="option" aria-selected={active === index}
                  className={`cursor-pointer rounded px-3 py-2 text-sm ${active === index ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => choose(match)}>
                  <p className="font-medium">{match.key}</p>
                  <p className="text-xs text-slate-500">{match.title}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <Select className="sm:w-56" name="group" aria-label="Permission group" value={group}
        onChange={(event) => { resetSuggestions(); setGroup(event.target.value); }}>
        <option value="">All groups</option>
        {groups.map((value) => <option key={value} value={value}>{value}</option>)}
      </Select>
      <button type="submit" className="rounded-md border border-neutral-200 px-4 py-2 text-sm">Filter</button>
    </form>
  );
}
