import "server-only";

import type { UIMessage } from "ai";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConversations, aiMessages } from "@/lib/db/schema";
import { newId } from "@/lib/subscription/shared";

function conversationTitle(messages: UIMessage[]): string | null {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const text = firstUserMessage?.parts.find((part) => part.type === "text");
  if (!text || text.type !== "text") return null;

  const value = text.text.trim().replace(/\s+/g, " ");
  return value ? value.slice(0, 120) : null;
}

/** Load the most recent assistant conversation for one admin in one application. */
export async function getAssistantMessages(
  applicationId: string,
  rxlabUserId: string,
): Promise<UIMessage[]> {
  const [conversation] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.applicationId, applicationId),
        eq(aiConversations.rxlabUserId, rxlabUserId),
      ),
    )
    .orderBy(desc(aiConversations.updatedAt))
    .limit(1);

  if (!conversation) return [];

  const rows = await db
    .select({
      id: aiMessages.id,
      role: aiMessages.role,
      parts: aiMessages.parts,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversation.id))
    .orderBy(asc(aiMessages.createdAt));

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: row.parts as UIMessage["parts"],
  }));
}

/**
 * Replace the stored snapshot with the complete UI message list. Replacing the
 * parts is important because approval parts change state after confirmation.
 */
export async function saveAssistantMessages(
  applicationId: string,
  rxlabUserId: string,
  messages: UIMessage[],
): Promise<void> {
  const persistedMessages = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  if (persistedMessages.length === 0) return;

  const now = new Date();

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.applicationId, applicationId),
          eq(aiConversations.rxlabUserId, rxlabUserId),
        ),
      )
      .orderBy(desc(aiConversations.updatedAt))
      .limit(1);

    const conversationId = existing?.id ?? newId();

    if (!existing) {
      await tx.insert(aiConversations).values({
        id: conversationId,
        applicationId,
        rxlabUserId,
        title: conversationTitle(persistedMessages),
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await tx
        .update(aiConversations)
        .set({
          title: conversationTitle(persistedMessages),
          updatedAt: now,
        })
        .where(eq(aiConversations.id, conversationId));

      await tx
        .delete(aiMessages)
        .where(eq(aiMessages.conversationId, conversationId));
    }

    await tx.insert(aiMessages).values(
      persistedMessages.map((message, index) => ({
        // Generate database-owned ids instead of trusting ids supplied by a client.
        id: newId(),
        conversationId,
        role: message.role,
        parts: message.parts,
        createdAt: new Date(now.getTime() + index),
      })),
    );
  });
}

/** Delete every conversation for this admin/application pair and its messages. */
export async function clearAssistantMessages(
  applicationId: string,
  rxlabUserId: string,
): Promise<void> {
  const conversations = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.applicationId, applicationId),
        eq(aiConversations.rxlabUserId, rxlabUserId),
      ),
    );

  if (conversations.length === 0) return;
  const conversationIds = conversations.map((conversation) => conversation.id);

  await db.transaction(async (tx) => {
    await tx
      .delete(aiMessages)
      .where(inArray(aiMessages.conversationId, conversationIds));
    await tx
      .delete(aiConversations)
      .where(inArray(aiConversations.id, conversationIds));
  });
}
