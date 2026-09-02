"use client";

import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  canUseRawClientId,
  matchOAuthClients,
} from "@/components/forms/oauth-client-search";
import type { OAuthClientOption } from "@/lib/console/session";
import { cn } from "@/lib/utils";

/**
 * Picks the OAuth clients a publishable key will accept user tokens from.
 *
 * This list is the whole security boundary of a publishable key — a key that
 * accepts the wrong client is a key anyone can point at this application — so
 * it is chosen from rxlab-auth's own clients rather than typed. A mistyped id
 * used to fail silently: the key minted fine and every request it made came
 * back `403 client_not_allowed`, with nothing on either side saying why.
 *
 * Free text is still allowed for a client this admin cannot see, since their
 * `read:oauth_clients` grant may be narrower than the clients their app uses.
 * That path is explicit — you have to pick "Use this id" — so it cannot be
 * reached by a typo.
 *
 * Submits as a newline-separated hidden input, which `createApiKeyAction`
 * already splits on whitespace and commas.
 */
export function OAuthClientCombobox({
  name,
  clients,
}: {
  name: string;
  clients: OAuthClientOption[];
}) {
  // Nothing is pre-selected. An application's own client is usually the
  // confidential one it was registered as, not the public client its app
  // binary uses, so a default here would be wrong more often than right — and
  // wrong in a way nobody would look twice at.
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const byId = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );

  const matches = useMemo(
    () => matchOAuthClients(clients, query, selected),
    [clients, query, selected],
  );

  const rawId = query.trim();
  const options = canUseRawClientId(clients, query, selected)
    ? [...matches, null]
    : matches;
  // Clamped at render rather than reset in an effect: adding a chip shortens
  // the list under a highlight that has already been placed, and correcting
  // that afterwards would render the out-of-range state first.
  const highlighted = options.length === 0 ? 0 : Math.min(activeIndex, options.length - 1);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  // The list scrolls internally, so arrowing past its edge would otherwise walk
  // the highlight somewhere the user cannot see. `nearest` keeps the list still
  // while the highlight is already visible.
  useEffect(() => {
    if (!isOpen) return;
    listRef.current
      ?.querySelector(`#${CSS.escape(`${listId}-${highlighted}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted, isOpen, listId]);

  function add(id: string) {
    const trimmed = id.trim();
    if (!trimmed || selected.includes(trimmed)) return;
    setSelected((current) => [...current, trimmed]);
    setQuery("");
    setIsOpen(false);
    inputRef.current?.focus();
  }

  function remove(id: string) {
    setSelected((current) => current.filter((value) => value !== id));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((highlighted + step + options.length) % options.length);
      return;
    }
    if (event.key === "Enter") {
      // Never let the combobox submit the dialog: Enter here means "take this
      // suggestion", and a form that saved instead would be a trap.
      event.preventDefault();
      if (!isOpen) return setIsOpen(true);
      const option = options[highlighted];
      if (option === null) add(rawId);
      else if (option) add(option.id);
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      return;
    }
    if (event.key === "Backspace" && query === "" && selected.length > 0) {
      remove(selected[selected.length - 1]);
    }
  }

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <span className="text-xs font-semibold text-slate-700">
        Allowed OAuth clients
      </span>

      <input type="hidden" name={name} value={selected.join("\n")} />

      <div
        className={cn(
          "rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm transition",
          "focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100",
        )}
      >
        {selected.length > 0 ? (
          <ul className="mb-1.5 flex flex-wrap gap-1.5">
            {selected.map((id) => {
              const client = byId.get(id);
              return (
                // A client id is 40-odd monospace characters and the name is
                // arbitrary, so a chip left to size itself pushes straight
                // through the right edge of the control. It shrinks instead,
                // and the id is the part that gives.
                <li key={id} className="max-w-full min-w-0">
                  <span className="flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-xs ring-1 ring-inset ring-slate-200">
                    <span className="shrink-0 font-semibold text-slate-800">
                      {client?.name ?? "Unknown client"}
                    </span>
                    <span className="min-w-0 truncate font-mono text-slate-500" title={id}>
                      {id}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(id)}
                      aria-label={`Remove ${client?.name ?? id}`}
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              isOpen && options.length > 0 ? `${listId}-${highlighted}` : undefined
            }
            autoComplete="off"
            value={query}
            placeholder={
              selected.length === 0 ? "Search by app name or client id" : "Add another…"
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={onKeyDown}
            className="h-8 w-full rounded-md bg-transparent px-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={() => {
              setIsOpen((open) => !open);
              inputRef.current?.focus();
            }}
            aria-label={isOpen ? "Hide clients" : "Show clients"}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <ChevronsUpDown className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/*
        In flow rather than floating. This lives inside a `<dialog showModal()>`
        whose body both scrolls and clips, so an absolutely-positioned list is
        cut off at the dialog's edge — which is exactly where this field sits.
        Escaping that would mean portalling, and a portal to `document.body`
        renders *under* a modal dialog's top layer, so it would disappear
        entirely. Expanding in place costs a layout shift and nothing else: the
        dialog body scrolls, so the list is always reachable.
      */}
      {isOpen ? (
        <div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="OAuth clients"
            className="max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
          >
            {options.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-500">
                {clients.length === 0
                  ? "No OAuth clients are visible to your account."
                  : "Every matching client is already selected."}
              </li>
            ) : (
              options.map((option, index) => {
                const active = index === highlighted;
                if (option === null) {
                  return (
                    <li
                      key="__raw__"
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={active}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => add(rawId)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition",
                          active ? "bg-blue-50 text-blue-900" : "text-slate-700",
                        )}
                      >
                        <Plus className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">
                          Use{" "}
                          <span className="font-mono text-xs">{rawId}</span>
                        </span>
                      </button>
                    </li>
                  );
                }
                return (
                  <li
                    key={option.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={active}
                  >
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => add(option.id)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition",
                        active ? "bg-blue-50" : "",
                      )}
                    >
                      <Check
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          active ? "text-blue-600" : "text-transparent",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {option.name}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                              option.clientType === "public"
                                ? "bg-sky-50 text-sky-700 ring-sky-200"
                                : "bg-slate-50 text-slate-600 ring-slate-200",
                            )}
                          >
                            {option.clientType}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-slate-500">
                          {option.id}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}

      <span className="block text-xs text-slate-500">
        Tokens from these clients — and no others — are accepted alongside this
        key. A native app uses a <span className="font-semibold">public</span>{" "}
        client; that is usually the one you want here.
      </span>
    </div>
  );
}
