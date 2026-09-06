import { index, pgTable, text, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";
import { applications } from "./applications";

export const aiConversations = pgTable(
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
    summaryMessageCount: bigint("summary_message_count", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    index("ai_conversations_user_updated_idx").on(table.rxlabUserId, table.updatedAt),
  ],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    parts: jsonb("parts").$type<unknown[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
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
export const auditLogs = pgTable(
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
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    conversationId: text("conversation_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    index("audit_logs_app_created_idx").on(table.applicationId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ],
);

export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
