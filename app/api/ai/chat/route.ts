import {
  consumeStream,
  convertToModelMessages,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { createContextCompactor } from "@/lib/ai/compaction";
import {
  getConversationCompaction,
  saveAssistantMessages,
  saveConversationCompaction,
} from "@/lib/ai/conversations";
import { dropIncompleteToolCalls } from "@/lib/ai/messages";
import { buildTools, systemPrompt } from "@/lib/ai/tools";
import { requireApplicationAccess, requireConsoleUser } from "@/lib/console/session";

export const maxDuration = 300;

const DEFAULT_MODEL = process.env.AI_MODEL?.trim() || "anthropic/claude-sonnet-5";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    messages?: UIMessage[];
    applicationId?: string;
  } | null;

  if (!body?.applicationId || !Array.isArray(body.messages)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const validation = await safeValidateUIMessages<UIMessage>({
    messages: body.messages,
  });
  if (!validation.success) {
    return Response.json({ error: "invalid_messages" }, { status: 400 });
  }
  // A stopped response can leave tool calls without a result; they would be
  // replayed to the model as an unanswered tool call.
  const messages = dropIncompleteToolCalls(validation.data);

  const user = await requireConsoleUser();

  // The assistant is scoped to one application, authorized here rather than
  // trusted from the model or the client payload.
  let application;
  try {
    application = await requireApplicationAccess(body.applicationId);
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Store the incoming snapshot first so the user's latest turn or approval is
  // not lost if the model request fails before it can produce a response.
  await saveAssistantMessages(application.id, user.id, messages);

  // Long sessions are compacted before each model call: the transcript above
  // keeps every message, while the model gets a summary of the older turns plus
  // the recent ones verbatim. Reusing the stored summary keeps a settled
  // conversation from paying for a new one every turn.
  const compaction = await getConversationCompaction(application.id, user.id);

  const result = streamText({
    model: DEFAULT_MODEL,
    system: systemPrompt(application),
    messages: await convertToModelMessages(messages),
    tools: buildTools(application.id, { type: "ai", id: user.id }),
    stopWhen: stepCountIs(12),
    prepareStep: createContextCompactor({
      chatModel: DEFAULT_MODEL,
      state: compaction,
      abortSignal: request.signal,
      onCompacted: (state) =>
        saveConversationCompaction(application.id, user.id, state),
    }),
    // Stop the model run when the browser stops the response instead of paying
    // for tokens nobody will read.
    abortSignal: request.signal,
    // Signs each approval request so a hand-crafted "approved" from the browser
    // cannot make a write tool run.
    experimental_toolApprovalSecret: process.env.AUTH_SECRET,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages }) => {
      // Runs for aborted responses too, so a stopped turn keeps what it wrote.
      await saveAssistantMessages(
        application.id,
        user.id,
        dropIncompleteToolCalls(messages),
      );
    },
    // Keeps consuming the stream after the browser disconnects so onFinish
    // still runs on abort.
    consumeSseStream: consumeStream,
  });
}
