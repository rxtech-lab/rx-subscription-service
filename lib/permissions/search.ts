export interface PermissionSuggestion {
  id: string;
  key: string;
  title: string;
}

export function permissionGroup(permission: { group: string | null; key: string }): string {
  return permission.group || permission.key.split(".").slice(0, -1).join(".") || "Ungrouped";
}

/** Treat LIKE metacharacters as literal characters in a permission key. */
export function permissionSearchPattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
}
