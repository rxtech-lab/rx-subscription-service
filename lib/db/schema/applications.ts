import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { paywalls } from "./paywalls";

export const API_ENVIRONMENTS = ["xcode", "sandbox", "production"] as const;
export type ApiEnvironment = (typeof API_ENVIRONMENTS)[number];

/** Xcode and sandbox are test data planes; only production may reach live billing. */
export function isTestApiEnvironment(environment: ApiEnvironment): boolean {
  return environment !== "production";
}

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
  /** The paywall template this app shows; deleting the template clears it. */
  paywallId: text("paywall_id").references(() => paywalls.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  syncedAt: integer("synced_at", { mode: "timestamp_ms" }),
});

export const API_KEY_KINDS = ["secret", "publishable"] as const;
export type ApiKeyKind = (typeof API_KEY_KINDS)[number];

/**
 * Credentials issued to an application so it can call the `/api/v1`
 * entitlement and usage endpoints. Only the SHA-256 hash is stored;
 * `keyPrefix` exists so the console can show which key is which.
 *
 * Two kinds, with very different trust:
 *
 * - `secret` is server-to-server. It reaches every endpoint and names the user
 *   it acts for, so it must never leave a backend.
 * - `publishable` is meant to be embedded in a client binary. It is useless on
 *   its own: every request must also carry the end user's rxlab access token,
 *   and the user it acts for is taken from that verified token rather than
 *   from the request. It reaches only the read and purchase endpoints, so a
 *   leaked copy cannot move value or read a stranger's billing.
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
    /** Existing credentials predate publishable keys and migrate to secret. */
    kind: text("kind", { enum: API_KEY_KINDS }).notNull().default("secret"),
    /**
     * JSON array of rxlab-auth OAuth client ids whose access tokens this key
     * accepts. Required for `publishable`, null for `secret`. Scoping this to
     * the key rather than the application means one key per shipped binary, so
     * revoking a leaked iOS credential leaves the web client alone.
     */
    allowedClientIds: text("allowed_client_ids"),
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
