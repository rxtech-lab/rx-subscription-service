/**
 * How a suite gets executed.
 *
 * Two implementations exist because the requirement pulls in two directions: a
 * suite is arbitrary code written by whoever can reach the console (or by the
 * assistant), so in a deployment it must run in a Vercel Sandbox and never in
 * the request process — but a developer running `next dev` has no sandbox
 * credentials, and a test feature that only works in production is a test
 * feature nobody writes tests with. `local` is therefore a development
 * convenience and refuses to be selected on Vercel.
 */
export interface RunDriverInput {
  /** The harness program, written next to the suite. */
  harness: string;
  /** The suite under test, as TypeScript source. */
  suiteCode: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called for every complete line of output, in order. */
  onLine: (line: string, stream: "stdout" | "stderr") => void | Promise<void>;
}

export interface RunDriver {
  readonly name: string;
  run(input: RunDriverInput): Promise<{ exitCode: number }>;
}

export const HARNESS_FILENAME = "harness.mjs";
export const SUITE_FILENAME = "suite.ts";

/**
 * `--experimental-strip-types` lets the suite be written in TypeScript without
 * a build step. Node 22.6+ accepts the flag; the sandbox runtime is pinned to
 * node24, and the local driver falls back when the flag is unknown.
 */
export const NODE_ARGS = [
  "--experimental-strip-types",
  "--no-warnings",
  HARNESS_FILENAME,
];
