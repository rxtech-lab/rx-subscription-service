import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { applications } from "./applications";

export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    rxlabUserId: text("rxlab_user_id").notNull(),
    title: text("title"),
    // Context compaction. The messages themselves are never deleted; this is the
    // summary that stands in for the first `summaryMessageCount` model messages
    // when the conversation is sent to the model.
    summary: text("summary"),
    summaryMessageCount: integer("summary_message_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("ai_conversations_user_updated_idx").on(table.rxlabUserId, table.updatedAt),
  ],
);

export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    parts: text("parts", { mode: "json" }).$type<unknown[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("ai_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

/**
 * Every configuration mutation, whether a human clicked it or the assistant
 * applied it. `actorType: "ai"` plus `conversationId` makes an AI-driven change
 * traceable back to the exact chat that produced it.
 */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    actorType: text("actor_type", { enum: ["user", "ai", "system"] }).notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: text("before", { mode: "json" }).$type<Record<string, unknown> | null>(),
    after: text("after", { mode: "json" }).$type<Record<string, unknown> | null>(),
    conversationId: text("conversation_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("audit_logs_app_created_idx").on(table.applicationId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ],
);

export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
