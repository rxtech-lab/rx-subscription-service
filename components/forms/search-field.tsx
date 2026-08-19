"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/primitives";

/**
 * Pushes the typed query into the URL so the page re-renders on the server with
 * the filtered, paginated data. Typing is debounced, and a new query always
 * resets to the first page — page 4 of the old result set means nothing.
 */
export function SearchField({
  paramName = "q",
  placeholder = "Search",
  label,
  className,
}: {
  paramName?: string;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get(paramName) ?? "";
  const [value, setValue] = useState(urlValue);
  const [isPending, startTransition] = useTransition();

  // Keep in step with navigations that change the query from elsewhere (back
  // button, a cleared filter) without fighting the user mid-keystroke.
  const lastPushed = useRef(urlValue);
  useEffect(() => {
    if (urlValue !== lastPushed.current) {
      lastPushed.current = urlValue;
      setValue(urlValue);
    }
  }, [urlValue]);

  useEffect(() => {
    if (value === urlValue) return;
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (value.trim()) {
        next.set(paramName, value.trim());
      } else {
        next.delete(paramName);
      }
      next.delete("page");
      lastPushed.current = value.trim();
      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [pathname, paramName, router, searchParams, urlValue, value]);

  return (
    <div className={className}>
      <label className="relative block">
        <span className="sr-only">{label}</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="pl-9"
          data-pending={isPending ? "" : undefined}
        />
      </label>
    </div>
  );
}
