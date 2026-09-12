"use server";

import { requireApplicationAccess } from "@/lib/console/session";
import type { PermissionSuggestion } from "@/lib/permissions/search";

import {
  createPermission,
  searchPermissions,
  createRole,
  deletePermission,
  deleteRole,
  setRolePermissions,
  updatePermission,
  updateRole,
  type RolePermissionGrant,
} from "@/lib/subscription/roles";
import {
  checkbox,
  integer,
  optionalText,
  revalidateApp,
  text,
  toActionState,
  withConfigurationUpdate,
  type ActionState,
} from "./shared";

export async function createRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await createRole({
        applicationId,
        key: text(formData, "key"),
        title: text(formData, "title"),
        description: optionalText(formData, "description"),
        isDefault: checkbox(formData, "isDefault"),
        sortOrder: integer(formData, "sortOrder", 0),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "roles");
  return { success: "Role created." };
}

export async function updateRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await updateRole({
        applicationId,
        roleId: text(formData, "roleId"),
        title: text(formData, "title"),
        description: optionalText(formData, "description"),
        isDefault: checkbox(formData, "isDefault"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "roles");
  return { success: "Role updated." };
}

export async function deleteRoleAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withConfigurationUpdate(applicationId, async ({ actor }) => {
    await deleteRole({ applicationId, roleId: text(formData, "roleId"), actor });
  });
  revalidateApp(applicationId, "roles");
}

/**
 * The permission editor posts one checkbox per permission plus a scope and a
 * comma-separated id list, and replaces the role's grants wholesale.
 */
export async function setRolePermissionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  const roleId = text(formData, "roleId");

  const grants: RolePermissionGrant[] = [];
  for (const permissionId of formData.getAll("permissionId")) {
    if (typeof permissionId !== "string") continue;
    if (!checkbox(formData, `enabled:${permissionId}`)) continue;

    const scope = text(formData, `scope:${permissionId}`);
    const targetIds = text(formData, `targets:${permissionId}`)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    grants.push({ permissionId, scope, targetIds });
  }

  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await setRolePermissions({ applicationId, roleId, grants, actor });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "roles");
  return { success: "Permissions saved." };
}

export async function createPermissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await createPermission({
        applicationId,
        key: text(formData, "key"),
        title: text(formData, "title"),
        description: optionalText(formData, "description"),
        group: optionalText(formData, "group"),
        scopeOptions: text(formData, "scopeOptions").split(","),
        supportsAll: checkbox(formData, "supportsAll"),
        supportsIds: checkbox(formData, "supportsIds"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "permissions");
  return { success: "Permission created." };
}

export async function updatePermissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = text(formData, "applicationId");
  try {
    await withConfigurationUpdate(applicationId, async ({ actor }) => {
      await updatePermission({
        applicationId,
        permissionId: text(formData, "permissionId"),
        title: text(formData, "title"),
        description: optionalText(formData, "description"),
        group: optionalText(formData, "group"),
        scopeOptions: text(formData, "scopeOptions").split(","),
        supportsAll: checkbox(formData, "supportsAll"),
        supportsIds: checkbox(formData, "supportsIds"),
        actor,
      });
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidateApp(applicationId, "permissions");
  return { success: "Permission updated." };
}

export async function deletePermissionAction(formData: FormData): Promise<void> {
  const applicationId = text(formData, "applicationId");
  await withConfigurationUpdate(applicationId, async ({ actor }) => {
    await deletePermission({
      applicationId,
      permissionId: text(formData, "permissionId"),
      actor,
    });
  });
  revalidateApp(applicationId, "permissions");
}

export async function searchPermissionKeysAction(
  applicationId: string,
  query: string,
  group: string,
): Promise<PermissionSuggestion[]> {
  await requireApplicationAccess(applicationId);
  if (typeof query !== "string" || typeof group !== "string" || query.length > 200 || group.length > 200) {
    return [];
  }
  const matches = await searchPermissions(applicationId, query, group, 20);
  return matches.map(({ id, key, title }) => ({ id, key, title }));
}
