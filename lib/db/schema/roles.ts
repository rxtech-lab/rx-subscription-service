import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { applications } from "./applications";
import { appUsers } from "./users";

/**
 * An application-level subscription role. Distinct from rxlab-auth's
 * `oauth_client_roles`: those describe who a user *is*, these describe what a
 * user has *bought*. Granted by plan entitlements, surfaced through
 * `/api/v1/entitlements`.
 */
export const subscriptionRoles = sqliteTable(
  "subscription_roles",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("subscription_roles_app_key_idx").on(table.applicationId, table.key),
  ],
);

/**
 * A customizable permission an application can grant through roles. `key` is the
 * bare verb:resource part of the expression (`read:a`); the `:all` / `:id1,id2`
 * suffix is stored per role in `rolePermissions`.
 */
export const permissions = sqliteTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    supportsAll: integer("supports_all", { mode: "boolean" }).notNull().default(true),
    supportsIds: integer("supports_ids", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("permissions_app_key_idx").on(table.applicationId, table.key),
  ],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id")
      .notNull()
      .references(() => subscriptionRoles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["all", "selected"] }).notNull(),
    targetIds: text("target_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("role_permissions_role_permission_idx").on(
      table.roleId,
      table.permissionId,
    ),
    index("role_permissions_permission_idx").on(table.permissionId),
  ],
);

/**
 * A role held directly by a user, outside any plan.
 *
 * Plans are the normal way in, but a role is not always something you buy: the
 * console Test tab hands one to a test user so the permission-gated parts of an
 * application can be exercised without a payment. These resolve alongside
 * plan-granted and default roles, so nothing downstream has to know the
 * difference.
 */
export const appUserRoles = sqliteTable(
  "app_user_roles",
  {
    id: text("id").primaryKey(),
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => subscriptionRoles.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("app_user_roles_user_role_idx").on(table.appUserId, table.roleId),
    index("app_user_roles_role_idx").on(table.roleId),
  ],
);

export type SubscriptionRole = typeof subscriptionRoles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type AppUserRole = typeof appUserRoles.$inferSelect;
