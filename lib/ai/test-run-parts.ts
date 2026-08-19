import type { UIMessage } from "ai";

/**
 * The runs a stored conversation shows a card for.
 *
 * The transcript is replayed from the database on every reload, and each
 * `runTestSuite` call in it renders a live-looking card. Knowing which runs
 * those are up front is what lets the page hand them over already finished,
 * instead of every card in the history opening its own connection to rediscover
 * a result that settled days ago.
 *
 * Kept separate from the panel because the panel is a client component and this
 * is read on the server, and separate from the run code because it is only ever
 * about the shape of a message part.
 */
export function testRunIdsInMessages(messages: UIMessage[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool-runTestSuite") continue;
      // Mirrors what the panel itself renders a card for.
      if ((part as { state?: string }).state !== "output-available") continue;

      const output = (part as { output?: unknown }).output as {
        ok?: boolean;
        result?: { runId?: unknown };
      } | null;
      if (!output?.ok) continue;

      const runId = output.result?.runId;
      if (typeof runId !== "string" || !runId || seen.has(runId)) continue;
      seen.add(runId);
      ids.push(runId);
    }
  }

  return ids;
}
