import { z } from "zod";

/**
 * The line protocol a test run speaks.
 *
 * The harness executing inside the sandbox has no way to call back into this
 * process, so it reports by printing one JSON object per line on stdout. Every
 * protocol line carries the `rxtest` marker: anything else the user's code
 * prints is ordinary output and is forwarded as a `log` event instead of being
 * silently dropped. That keeps `console.log` inside a test useful without
 * letting it forge a result — a line claiming `"type":"test:end"` still has to
 * parse against these schemas, and a forged pass would at worst mislabel a run
 * the author already controls.
 */

export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MARKER = "rxtest";

const stepSchema = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed"]),
  durationMs: z.number().nullable().default(null),
});

const outlineTestSchema = z.object({
  name: z.string(),
  steps: z.array(z.string()).default([]),
});

const outlineSuiteSchema = z.object({
  name: z.string(),
  tests: z.array(outlineTestSchema).default([]),
});

export const runEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run:start"),
    /** The suites and tests the file declared, known before any of them run. */
    outline: z.array(outlineSuiteSchema).default([]),
  }),
  z.object({ type: z.literal("suite:start"), suite: z.string() }),
  z.object({
    type: z.literal("test:start"),
    suite: z.string(),
    test: z.string(),
    position: z.number().int(),
  }),
  z.object({
    type: z.literal("step"),
    suite: z.string(),
    test: z.string(),
    step: z.string(),
    status: z.enum(["passed", "failed"]),
    durationMs: z.number().nullable().default(null),
  }),
  z.object({
    type: z.literal("test:end"),
    suite: z.string(),
    test: z.string(),
    position: z.number().int(),
    status: z.enum(["passed", "failed", "skipped"]),
    durationMs: z.number().nullable().default(null),
    error: z.string().nullable().default(null),
    steps: z.array(stepSchema).default([]),
  }),
  z.object({
    type: z.literal("suite:end"),
    suite: z.string(),
    passed: z.number().int(),
    failed: z.number().int(),
  }),
  z.object({
    type: z.literal("run:end"),
    total: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
    durationMs: z.number().nullable().default(null),
  }),
  z.object({
    type: z.literal("log"),
    stream: z.enum(["stdout", "stderr"]).default("stdout"),
    message: z.string(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type RunEvent = z.infer<typeof runEventSchema>;
export type TestOutline = z.infer<typeof outlineSuiteSchema>[];

/**
 * Turn one line of sandbox output into an event.
 *
 * Unmarked or unparseable lines become `log` events rather than errors: the
 * point of the log stream is that a `console.log` in a test still reaches the
 * viewer, and a malformed protocol line is more useful shown than swallowed.
 */
export function parseRunLine(
  line: string,
  stream: "stdout" | "stderr" = "stdout",
): RunEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") && trimmed.includes(`"${PROTOCOL_MARKER}"`)) {
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      if (raw[PROTOCOL_MARKER] === PROTOCOL_VERSION) {
        const parsed = runEventSchema.safeParse(raw);
        if (parsed.success) return parsed.data;
      }
    } catch {
      // Fall through to treating it as plain output.
    }
  }

  return { type: "log", stream, message: trimmed };
}

/** Split a growing stdout buffer into lines, returning the incomplete tail. */
export function drainLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}
