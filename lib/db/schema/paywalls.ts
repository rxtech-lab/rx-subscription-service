import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { PaywallSpec } from "../../paywall/schema";

/**
 * Paywall templates. These are a shared library, not application data: a
 * template belongs to the console, and any number of applications point at it
 * through `applications.paywallId`.
 *
 * Two copies of the document live here. `draftSpec` is what the editor works
 * on; `publishedSpec` is what applications and `GET /api/v1/paywall` see, and
 * changes only when someone presses Publish.
 */
export const paywalls = sqliteTable(
  "paywalls",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    draftSpec: text("draft_spec", { mode: "json" }).$type<PaywallSpec>().notNull(),
    publishedSpec: text("published_spec", { mode: "json" }).$type<PaywallSpec>(),
    /** Who last changed the draft — a console admin or the paywall agent. */
    updatedBy: text("updated_by", { enum: ["user", "ai"] }).notNull().default("user"),
    createdBy: text("created_by"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("paywalls_name_idx").on(table.name)],
);

export type Paywall = typeof paywalls.$inferSelect;
export type NewPaywall = typeof paywalls.$inferInsert;

/** Immutable snapshots of a paywall design, including drafts and publishes. */
export const paywallVersions = sqliteTable(
  "paywall_versions",
  {
    id: text("id").primaryKey(),
    paywallId: text("paywall_id")
      .notNull()
      .references(() => paywalls.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    spec: text("spec", { mode: "json" }).$type<PaywallSpec>().notNull(),
    source: text("source", {
      enum: ["initial", "draft", "published", "restored", "duplicated"],
    }).notNull(),
    restoredFromVersion: integer("restored_from_version"),
    actorType: text("actor_type", { enum: ["user", "ai", "system"] }).notNull(),
    actorId: text("actor_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("paywall_versions_paywall_version_idx").on(table.paywallId, table.version),
  ],
);

export type PaywallVersion = typeof paywallVersions.$inferSelect;
export type NewPaywallVersion = typeof paywallVersions.$inferInsert;
