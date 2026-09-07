class ScopeValidationError extends Error {
  name = "ValidationError";
}

/** Scope names belong to a permission; :id restricts an action to target IDs. */
export const DEFAULT_PERMISSION_SCOPES = ["read", "write", "all", "read:id", "write:id", "all:id"];

export function isTargetedScope(scope: string): boolean {
  return scope === "selected" || scope.endsWith(":id");
}

export function normalizeScopeOptions(values: readonly string[]): string[] {
  const scopes = [...new Set(values.map((value) => value.trim()))];
  if (!scopes.length || scopes.some((scope) => !/^[a-z][a-z0-9._-]*(?::id)?$/.test(scope))) {
    throw new ScopeValidationError("Provide at least one scope using lowercase letters, numbers, dots, underscores or hyphens, optionally followed by :id.");
  }
  if (scopes.some((scope) => scope.split(":")[0] === "selected")) throw new ScopeValidationError("Use all:id instead of the reserved scope selected.");
  return scopes;
}

export function permissionScopeOptions(permission: {
  scopeOptions?: string[] | null;
  supportsAll: boolean;
  supportsIds: boolean;
}): string[] {
  return permission.scopeOptions ?? [
    ...(permission.supportsAll ? ["all"] : []),
    ...(permission.supportsIds ? ["selected"] : []),
  ];
}
