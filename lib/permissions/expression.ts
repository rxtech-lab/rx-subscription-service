/**
 * Permission expressions, in the same syntax rxlab-auth uses for its admin API
 * (`lib/admin-api/permissions.ts`) but generalized to any permission key.
 *
 *   read:a:all        → the `read:a` permission over every target
 *   read:a:id1,id2    → the `read:a` permission over exactly those targets
 *
 * A key may itself contain colons (`read:a`), so the scope is always the part
 * after the *last* colon. Target ids therefore may not contain a colon, which is
 * the same restriction rxlab-auth enforces.
 */

export type PermissionScope = "all" | "selected";

export interface PermissionExpression {
  key: string;
  scope: PermissionScope;
  targetIds: string[];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeTargetIds(values: readonly string[]): string[] {
  return unique(values.map((value) => value.trim()).filter(Boolean)).sort();
}

/** Parse a single expression. Returns null when the value is malformed. */
export function parsePermissionExpression(
  value: string,
): PermissionExpression | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf(":");
  if (separator <= 0 || separator === trimmed.length - 1) return null;

  const key = trimmed.slice(0, separator);
  const resource = trimmed.slice(separator + 1);
  if (!key || /\s/.test(key)) return null;

  if (resource === "all") return { key, scope: "all", targetIds: [] };

  const targetIds = normalizeTargetIds(resource.split(","));
  if (targetIds.length === 0) return null;
  if (targetIds.some((id) => /\s/.test(id))) return null;

  return { key, scope: "selected", targetIds };
}

/** Serialize an expression. Returns null when there is nothing to grant. */
export function buildPermissionExpression(
  expression: PermissionExpression,
): string | null {
  const key = expression.key.trim();
  if (!key) return null;
  if (expression.scope === "all") return `${key}:all`;

  const targetIds = normalizeTargetIds(expression.targetIds);
  return targetIds.length > 0 ? `${key}:${targetIds.join(",")}` : null;
}

/**
 * Parse a list of expressions, collapsing repeats of the same key. `all` beats
 * a selected list, and selected lists union together — matching how rxlab-auth
 * resolves multiple grants for one permission.
 */
export function parsePermissionList(
  values: readonly string[],
): PermissionExpression[] {
  const merged = new Map<string, PermissionExpression>();

  for (const value of values) {
    const parsed = parsePermissionExpression(value);
    if (!parsed) continue;

    const existing = merged.get(parsed.key);
    if (!existing) {
      merged.set(parsed.key, parsed);
      continue;
    }
    if (existing.scope === "all") continue;
    if (parsed.scope === "all") {
      merged.set(parsed.key, parsed);
      continue;
    }
    merged.set(parsed.key, {
      key: parsed.key,
      scope: "selected",
      targetIds: normalizeTargetIds([...existing.targetIds, ...parsed.targetIds]),
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function serializePermissionList(
  expressions: readonly PermissionExpression[],
): string[] {
  return expressions
    .map(buildPermissionExpression)
    .filter((value): value is string => value !== null)
    .sort();
}

/**
 * Does this permission set allow `key` — and, when `targetId` is given, that
 * specific target? Omitting `targetId` asks only whether the key is granted at
 * all, which is the right question for non-scoped permissions.
 */
export function hasPermission(
  permissions: readonly string[],
  key: string,
  targetId?: string,
): boolean {
  const match = parsePermissionList(permissions).find(
    (expression) => expression.key === key,
  );
  if (!match) return false;
  if (match.scope === "all") return true;
  if (targetId === undefined) return match.targetIds.length > 0;
  return match.targetIds.includes(targetId);
}

/** The targets allowed for `key`, or `"all"`. Null when the key is not granted. */
export function permissionTargets(
  permissions: readonly string[],
  key: string,
): "all" | string[] | null {
  const match = parsePermissionList(permissions).find(
    (expression) => expression.key === key,
  );
  if (!match) return null;
  return match.scope === "all" ? "all" : match.targetIds;
}

/** Is `value` a syntactically valid expression? */
export function isPermissionExpression(value: string): boolean {
  return parsePermissionExpression(value) !== null;
}
