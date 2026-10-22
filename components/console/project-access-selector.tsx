"use client";

import { useId, useState } from "react";

export function ProjectAccessSelector({
  apps,
  defaultSelectedIds = [],
  disabled = false,
}: {
  apps: { id: string; name: string }[];
  defaultSelectedIds?: string[];
  disabled?: boolean;
}) {
  const id = useId();
  const [mode, setMode] = useState<"all" | "specific">(
    apps.length > 0 && apps.every((app) => defaultSelectedIds.includes(app.id))
      ? "all"
      : "specific",
  );
  const [selectedIds, setSelectedIds] = useState(defaultSelectedIds);

  return (
    <fieldset disabled={disabled} className="space-y-3" aria-describedby={`${id}-help`}>
      <legend className="mb-3 font-semibold">Projects</legend>
      {apps.length === 0 ? (
        <p className="text-sm text-slate-500">No projects available.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["all", "specific"] as const).map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-4 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name={`${id}-project-mode`}
                  value={option}
                  checked={mode === option}
                  onChange={() => setMode(option)}
                />
                {option === "all" ? "All projects" : "Specific projects"}
              </label>
            ))}
          </div>
          {mode === "all" ? (
            apps.map((app) => (
              <input key={app.id} type="hidden" name="applicationIds" value={app.id} />
            ))
          ) : (
            <div className="grid max-h-64 gap-3 overflow-y-auto rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
              {apps.map((app) => (
                <label key={app.id} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="applicationIds"
                    value={app.id}
                    checked={selectedIds.includes(app.id)}
                    onChange={(event) => setSelectedIds((ids) =>
                      event.target.checked ? [...ids, app.id] : ids.filter((value) => value !== app.id),
                    )}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 break-words">{app.name}</span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
      <p id={`${id}-help`} className="text-xs text-slate-500">
        {mode === "all" && apps.length > 0
          ? `All ${apps.length} current projects will be included. Update access in Settings to include future projects.`
          : "Select the projects this client can access. No selection grants no project access."}
      </p>
    </fieldset>
  );
}
