import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { permissions, rolePermissions, subscriptionRoles } from "@/lib/db/schema";
import {
  buildPermissionExpression,
  type PermissionScope,
} from "@/lib/permissions/expression";
import {
  assertKey,
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "./shared";

export async function listRoles(applicationId: string) {
  return db
    .select()
    .from(subscriptionRoles)
    .where(eq(subscriptionRoles.applicationId, applicationId))
    .orderBy(asc(subscriptionRoles.sortOrder), asc(subscriptionRoles.key));
}

export async function requireRole(applicationId: string, roleId: string) {
  const [role] = await db
    .select()
    .from(subscriptionRoles)
    .where(
      and(
        eq(subscriptionRoles.id, roleId),
        eq(subscriptionRoles.applicationId, applicationId),
      ),
    )
    .limit(1);
  if (!role) throw new NotFoundError("role", roleId);
  return role;
}

export async function createRole(input: {
  applicationId: string;
  key: string;
  title: string;
  description?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
  actor: Actor;
}) {
  const key = assertKey(input.key);
  if (!input.title.trim()) throw new ValidationError("title is required");

  const [duplicate] = await db
    .select({ id: subscriptionRoles.id })
    .from(subscriptionRoles)
    .where(
      and(
        eq(subscriptionRoles.applicationId, input.applicationId),
        eq(subscriptionRoles.key, key),
      ),
    )
    .limit(1);
  if (duplicate) throw new ValidationError(`a role with key "${key}" already exists`);

  const now = new Date();
  const [role] = await db
    .insert(subscriptionRoles)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      key,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      isDefault: input.isDefault ?? false,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "role.create",
    entityType: "subscription_role",
    entityId: role.id,
    after: role,
  });
  return role;
}

export async function updateRole(input: {
  applicationId: string;
  roleId: string;
  title?: string;
  description?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
  actor: Actor;
}) {
  const before = await requireRole(input.applicationId, input.roleId);
  const [role] = await db
    .update(subscriptionRoles)
    .set({
      title: input.title?.trim() || before.title,
      description:
        input.description === undefined
          ? before.description
          : input.description?.trim() || null,
      isDefault: input.isDefault ?? before.isDefault,
      sortOrder: input.sortOrder ?? before.sortOrder,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionRoles.id, input.roleId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "role.update",
    entityType: "subscription_role",
    entityId: role.id,
    before,
    after: role,
  });
  return role;
}

export async function deleteRole(input: {
  applicationId: string;
  roleId: string;
  actor: Actor;
}) {
  const before = await requireRole(input.applicationId, input.roleId);
  await db.delete(subscriptionRoles).where(eq(subscriptionRoles.id, input.roleId));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "role.delete",
    entityType: "subscription_role",
    entityId: input.roleId,
    before,
  });
}

export async function listPermissions(applicationId: string) {
  return db
    .select()
    .from(permissions)
    .where(eq(permissions.applicationId, applicationId))
    .orderBy(asc(permissions.sortOrder), asc(permissions.key));
}

export async function requirePermission(applicationId: string, permissionId: string) {
  const [permission] = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.id, permissionId),
        eq(permissions.applicationId, applicationId),
      ),
    )
    .limit(1);
  if (!permission) throw new NotFoundError("permission", permissionId);
  return permission;
}

/**
 * Permission keys carry their own colons (`read:a`), so they are validated
 * segment by segment rather than with the flat key rule.
 */
function assertPermissionKey(value: string): string {
  const key = value.trim().toLowerCase();
  const segments = key.split(":");
  if (segments.length < 1 || segments.length > 3) {
    throw new ValidationError("permission key must have 1-3 colon-separated segments");
  }
  for (const segment of segments) assertKey(segment, "permission key segment");
  return key;
}

export async function createPermission(input: {
  applicationId: string;
  key: string;
  title: string;
  description?: string | null;
  supportsAll?: boolean;
  supportsIds?: boolean;
  sortOrder?: number;
  actor: Actor;
}) {
  const key = assertPermissionKey(input.key);
  if (!input.title.trim()) throw new ValidationError("title is required");

  const [duplicate] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.applicationId, input.applicationId),
        eq(permissions.key, key),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new ValidationError(`a permission with key "${key}" already exists`);
  }

  const now = new Date();
  const [permission] = await db
    .insert(permissions)
    .values({
      id: newId(),
      applicationId: input.applicationId,
      key,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      supportsAll: input.supportsAll ?? true,
      supportsIds: input.supportsIds ?? true,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "permission.create",
    entityType: "permission",
    entityId: permission.id,
    after: permission,
  });
  return permission;
}

export async function updatePermission(input: {
  applicationId: string;
  permissionId: string;
  title?: string;
  description?: string | null;
  supportsAll?: boolean;
  supportsIds?: boolean;
  actor: Actor;
}) {
  const before = await requirePermission(input.applicationId, input.permissionId);
  const [permission] = await db
    .update(permissions)
    .set({
      title: input.title?.trim() || before.title,
      description:
        input.description === undefined
          ? before.description
          : input.description?.trim() || null,
      supportsAll: input.supportsAll ?? before.supportsAll,
      supportsIds: input.supportsIds ?? before.supportsIds,
      updatedAt: new Date(),
    })
    .where(eq(permissions.id, input.permissionId))
    .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "permission.update",
    entityType: "permission",
    entityId: permission.id,
    before,
    after: permission,
  });
  return permission;
}

export async function deletePermission(input: {
  applicationId: string;
  permissionId: string;
  actor: Actor;
}) {
  const before = await requirePermission(input.applicationId, input.permissionId);
  await db.delete(permissions).where(eq(permissions.id, input.permissionId));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "permission.delete",
    entityType: "permission",
    entityId: input.permissionId,
    before,
  });
}

export interface RolePermissionGrant {
  permissionId: string;
  scope: PermissionScope;
  targetIds: string[];
}

/** Replace a role's grants wholesale — the shape the console editor submits. */
export async function setRolePermissions(input: {
  applicationId: string;
  roleId: string;
  grants: RolePermissionGrant[];
  actor: Actor;
}) {
  await requireRole(input.applicationId, input.roleId);

  const permissionIds = input.grants.map((grant) => grant.permissionId);
  if (permissionIds.length > 0) {
    const owned = await db
      .select({ id: permissions.id, supportsAll: permissions.supportsAll, supportsIds: permissions.supportsIds })
      .from(permissions)
      .where(
        and(
          eq(permissions.applicationId, input.applicationId),
          inArray(permissions.id, permissionIds),
        ),
      );
    const byId = new Map(owned.map((permission) => [permission.id, permission]));

    for (const grant of input.grants) {
      const permission = byId.get(grant.permissionId);
      if (!permission) {
        throw new ValidationError(
          `permission ${grant.permissionId} does not belong to this application`,
        );
      }
      if (grant.scope === "all" && !permission.supportsAll) {
        throw new ValidationError("this permission does not support an all scope");
      }
      if (grant.scope === "selected") {
        if (!permission.supportsIds) {
          throw new ValidationError("this permission does not support target ids");
        }
        if (grant.targetIds.length === 0) {
          throw new ValidationError("a selected grant needs at least one target id");
        }
        if (grant.targetIds.some((id) => id.includes(":") || /\s/.test(id))) {
          throw new ValidationError("target ids may not contain colons or whitespace");
        }
      }
    }
  }

  const before = await getRolePermissions(input.applicationId, input.roleId);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, input.roleId));
    if (input.grants.length === 0) return;
    await tx.insert(rolePermissions).values(
      input.grants.map((grant) => ({
        id: newId(),
        roleId: input.roleId,
        permissionId: grant.permissionId,
        scope: grant.scope,
        targetIds: grant.scope === "all" ? [] : grant.targetIds,
        createdAt: now,
        updatedAt: now,
      })),
    );
  });

  const after = await getRolePermissions(input.applicationId, input.roleId);
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "role.set_permissions",
    entityType: "subscription_role",
    entityId: input.roleId,
    before: { expressions: before.expressions },
    after: { expressions: after.expressions },
  });
  return after;
}

/** A role's grants, plus the serialized `read:a:all` form apps consume. */
export async function getRolePermissions(applicationId: string, roleId: string) {
  const rows = await db
    .select({
      grantId: rolePermissions.id,
      permissionId: permissions.id,
      key: permissions.key,
      title: permissions.title,
      description: permissions.description,
      scope: rolePermissions.scope,
      targetIds: rolePermissions.targetIds,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(
      and(
        eq(rolePermissions.roleId, roleId),
        eq(permissions.applicationId, applicationId),
      ),
    )
    .orderBy(asc(permissions.key));

  const expressions = rows
    .map((row) =>
      buildPermissionExpression({
        key: row.key,
        scope: row.scope,
        targetIds: row.targetIds ?? [],
      }),
    )
    .filter((value): value is string => value !== null);

  return { grants: rows, expressions };
}
