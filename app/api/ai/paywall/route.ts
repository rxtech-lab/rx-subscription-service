import {
  convertToModelMessages,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { dropIncompleteToolCalls } from "@/lib/ai/messages";
import {
  buildPaywallTools,
  paywallSystemPrompt,
  type PaywallAgentContext,
} from "@/lib/ai/paywall-agent";
import { requireConsoleUser } from "@/lib/console/session";
import { getPaywall } from "@/lib/paywall/paywalls";
import { validatePaywallSpec } from "@/lib/paywall/schema";

export const maxDuration = 300;

const DEFAULT_MODEL = process.env.AI_MODEL?.trim() || "anthropic/claude-sonnet-5";

/**
 * The paywall editor's agent. It is stateless on purpose: the browser sends the
 * draft it is editing with every turn, the tools edit a working copy, and the
 * results flow back to the editor as unsaved changes. Nothing is persisted here
 * — not the transcript, not the document — so there is no approval step either.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    messages?: UIMessage[];
    paywallId?: string;
    spec?: unknown;
    products?: PaywallAgentContext["products"];
  } | null;

  if (!body?.paywallId || !Array.isArray(body.messages)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const validation = await safeValidateUIMessages<UIMessage>({ messages: body.messages });
  if (!validation.success) {
    return Response.json({ error: "invalid_messages" }, { status: 400 });
  }
  const messages = dropIncompleteToolCalls(validation.data);

  await requireConsoleUser();

  const paywall = await getPaywall(body.paywallId);
  if (!paywall) return Response.json({ error: "not_found" }, { status: 404 });

  const spec = validatePaywallSpec(body.spec);
  if (!spec.ok) {
    return Response.json({ error: "invalid_spec", detail: spec.error }, { status: 400 });
  }

  const { tools } = buildPaywallTools(spec.spec);

  const result = streamText({
    model: DEFAULT_MODEL,
    system: paywallSystemPrompt({
      paywallName: paywall.name,
      spec: spec.spec,
      products: Array.isArray(body.products) ? body.products.slice(0, 20) : undefined,
    }),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(10),
    abortSignal: request.signal,
  });

  return result.toUIMessageStreamResponse();
}
