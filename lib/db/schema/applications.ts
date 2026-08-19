import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const API_ENVIRONMENTS = ["sandbox", "production"] as const;
export type ApiEnvironment = (typeof API_ENVIRONMENTS)[number];

/**
 * A subscription-enabled application. The primary key is the rxlab-auth OAuth
 * client id, so it stays stable across syncs and can be used as the foreign key
 * everywhere else. Rows are upserted from the rxlab admin API on demand.
 */
export const applications = sqliteTable("applications", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  iconUrl: text("icon_url"),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  defaultCurrency: text("default_currency").notNull().default("usd"),
  /** Run every saved test suite after subscription configuration changes. */
  runTestsOnChange: integer("run_tests_on_change", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  syncedAt: integer("synced_at", { mode: "timestamp_ms" }),
});

/**
 * Server-to-server credentials issued to an application so its backend can call
 * the `/api/v1` entitlement and usage endpoints. Only the SHA-256 hash is
 * stored; `keyPrefix` exists so the console can show which key is which.
 */
export const applicationApiKeys = sqliteTable(
  "application_api_keys",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * The data plane this credential may reach. Existing credentials predate
     * environment support and migrate to production.
     */
    environment: text("environment", { enum: API_ENVIRONMENTS })
      .notNull()
      .default("production"),
    keyPrefix: text("key_prefix").notNull(),
    hashedKey: text("hashed_key").notNull().unique(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("application_api_keys_app_idx").on(table.applicationId),
    uniqueIndex("application_api_keys_hash_idx").on(table.hashedKey),
  ],
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type ApplicationApiKey = typeof applicationApiKeys.$inferSelect;
