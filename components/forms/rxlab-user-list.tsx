"use client";

import { useMemo, useState } from "react";
import { Field, Input } from "@/components/ui/primitives";

export interface RxLabUserOption {
  id: string;
  name: string | null;
  email: string;
}

function matchesUser(user: RxLabUserOption, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [user.id, user.name, user.email].some((value) =>
    value?.toLocaleLowerCase().includes(needle),
  );
}

export function RxLabUserList({ users }: { users: RxLabUserOption[] }) {
  const [query, setQuery] = useState("");
  const filteredUsers = useMemo(
    () => users.filter((user) => matchesUser(user, query)),
    [query, users],
  );
  const [selectedId, setSelectedId] = useState("");

  function updateQuery(value: string) {
    setQuery(value);
    const matches = users.filter((user) => matchesUser(user, value));
    if (!matches.some((user) => user.id === selectedId)) {
      setSelectedId("");
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Search users">
        <Input
          type="search"
          name="rxlabDirectorySearch"
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="Name, email, or RxLab user ID"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-protonpass-ignore="true"
        />
      </Field>
      <fieldset>
        <div className="mb-2 flex items-center justify-between gap-4">
          <legend className="text-xs font-semibold text-slate-700">
            Choose a user
          </legend>
          <span className="text-xs text-slate-500">
            {filteredUsers.length.toLocaleString("en-US")} matching{" "}
            {filteredUsers.length === 1 ? "user" : "users"}
          </span>
        </div>

        <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2">
          {filteredUsers.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">
                No users match this search
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Try a different name, email, or user ID.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => {
                const selected = user.id === selectedId;
                return (
                  <label
                    key={user.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-white px-4 py-3 transition ${
                      selected
                        ? "border-blue-400 ring-4 ring-blue-100"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="rxlabUserId"
                      value={user.id}
                      checked={selected}
                      onChange={() => setSelectedId(user.id)}
                      required
                      className="mt-1 size-4 shrink-0 accent-blue-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {user.name || "Unnamed user"}
                        </span>
                        {selected ? (
                          <span className="shrink-0 text-xs font-semibold text-blue-600">
                            Selected
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-slate-600">
                        {user.email}
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-slate-400">
                        {user.id}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {selectedId
            ? "The selected user will be added to this application."
            : "Select one user from the list to continue."}
        </p>
      </fieldset>
    </div>
  );
}
