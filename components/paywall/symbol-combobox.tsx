"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/primitives";
import { SUGGESTED_SYMBOLS } from "@/lib/paywall/sf-symbols";
import { cn } from "@/lib/utils";
import { SfSymbol } from "./sf-symbol";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * A searchable SF Symbol combobox. The selected value and every option use the
 * same npm-backed vector renderer as the paywall canvas.
 */
export function SymbolCombobox({
  value,
  onChange,
  onBlur,
  placeholder = "Symbol name, e.g. star.fill",
}: {
  value: string;
  onChange: (value: string | undefined, coalesce?: boolean) => void;
  onBlur: () => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<{
    query: string;
    results: string[];
    loading: boolean;
    error: boolean;
  }>({ query: "", results: [], loading: false, error: false });
  const [input, setInput] = useState({ selectedValue: value, query: value });
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const query = input.selectedValue === value ? input.query : value;
  const searchQuery = query.trim();
  const hasCurrentSearch = search.query === searchQuery;
  const results = !searchQuery
    ? [...SUGGESTED_SYMBOLS]
    : hasCurrentSearch
      ? search.results
      : [];
  const loading = Boolean(searchQuery) && (!hasCurrentSearch || search.loading);
  const searchError = Boolean(searchQuery) && hasCurrentSearch && search.error;
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const activeOption = results[activeIndex];

  useEffect(() => {
    if (!searchQuery) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearch({ query: searchQuery, results: [], loading: true, error: false });
      try {
        const response = await fetch(
          `/api/sf-symbols?q=${encodeURIComponent(searchQuery)}&limit=40`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Symbol search failed");
        const payload = (await response.json()) as { results?: unknown };
        if (!controller.signal.aborted) {
          setSearch({
            query: searchQuery,
            results: Array.isArray(payload.results)
              ? payload.results.filter((name): name is string => typeof name === "string")
              : [],
            loading: false,
            error: false,
          });
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSearch({ query: searchQuery, results: [], loading: false, error: true });
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    if (!list || !option) return;

    const listBounds = list.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < listBounds.top) {
      list.scrollTop -= listBounds.top - optionBounds.top;
    } else if (optionBounds.bottom > listBounds.bottom) {
      list.scrollTop += optionBounds.bottom - listBounds.bottom;
    }
  }, [activeIndex, activeOption, open]);

  const pick = (name: string) => {
    setInput({ selectedValue: name, query: name });
    onChange(name);
    setOpen(false);
    onBlur();
  };

  const finishEditing = () => {
    if (!query.trim()) {
      setInput({ selectedValue: "", query: "" });
      onChange(undefined);
    } else {
      setInput({ selectedValue: value, query: value });
    }
    setOpen(false);
    onBlur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive(Math.max(0, Math.min(results.length - 1, activeIndex + 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, activeIndex - 1));
    } else if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      pick(activeOption);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setInput({ selectedValue: value, query: value });
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
          <SfSymbol name={value} size={18} color="#0f172a" />
        </span>
        <div className="relative flex-1">
          <Input
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && activeOption ? `${listId}-${activeIndex}` : undefined}
            className="h-9 pr-8 font-mono text-xs"
            value={query}
            placeholder={placeholder}
            spellCheck={false}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setActive(0);
              setOpen(true);
              setInput({ selectedValue: value, query: event.target.value });
            }}
            onBlur={() => {
              // A click in the list keeps focus in the widget; only leaving it ends the edit.
              window.setTimeout(() => {
                if (!rootRef.current?.contains(document.activeElement)) finishEditing();
              }, 0);
            }}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? "Close symbol list" : "Browse symbols"}
            onClick={() => setOpen((current) => !current)}
            className="absolute inset-y-0 right-1 flex w-6 items-center justify-center text-slate-400 hover:text-slate-700"
          >
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="SF Symbols"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10"
        >
          {loading ? (
            <li className="px-2 py-2 text-xs text-slate-500">Searching symbols…</li>
          ) : searchError ? (
            <li className="px-2 py-2 text-xs text-amber-700">Symbol search is unavailable.</li>
          ) : results.length === 0 ? (
            <li className="px-2 py-2 text-xs text-slate-500">
              No SF Symbols match this search.
            </li>
          ) : (
            results.map((name, index) => (
              <li
                key={name}
                id={`${listId}-${index}`}
                data-option-index={index}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(name)}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                  index === activeIndex ? "bg-blue-50 text-blue-800" : "text-slate-700",
                )}
              >
                <SfSymbol name={name} size={16} color="currentColor" />
                <span className="truncate font-mono">{name}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
