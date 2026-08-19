import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainLines } from "../protocol";
import {
  HARNESS_FILENAME,
  NODE_ARGS,
  SUITE_FILENAME,
  type RunDriver,
  type RunDriverInput,
} from "./types";

/**
 * Run a suite as a child process in a temporary directory.
 *
 * This exists so the feature is usable during development, where there are no
 * sandbox credentials. It is **not** isolation: the suite runs as the developer,
 * with their filesystem and network. `selectDriver` refuses to choose it on
 * Vercel for exactly that reason, and it must stay that way.
 *
 * Deliberately free of `server-only`: this module spawns a process and never
 * touches the database or the session, and its line-ordering guarantees are
 * worth testing directly. Only `runner.ts` may reach it.
 */
export const localDriver: RunDriver = {
  name: "local",

  async run(input: RunDriverInput) {
    const directory = await mkdtemp(join(tmpdir(), "rx-test-"));

    try {
      await Promise.all([
        writeFile(join(directory, HARNESS_FILENAME), input.harness, "utf8"),
        writeFile(join(directory, SUITE_FILENAME), input.suiteCode, "utf8"),
      ]);

      return await execute(directory, input, NODE_ARGS);
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  },
};

async function execute(
  cwd: string,
  input: RunDriverInput,
  args: string[],
): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd,
      // A deliberately bare environment: the suite gets what the runner chose to
      // give it and nothing this process happens to be holding, so a developer's
      // real Stripe key cannot leak into a test run.
      env: {
        PATH: process.env.PATH ?? "",
        HOME: cwd,
        NODE_ENV: "test",
        ...input.env,
      },
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      signal: input.signal,
    });

    const tails: Record<string, string> = { stdout: "", stderr: "" };

    // Lines are handed over one at a time, in order. A chunk of stdout often
    // holds several, and handing them all over at once would let the consumer
    // see a test's result before its start.
    // Each link absorbs its own failure. Letting one propagate would reject
    // every link after it, and each replaced link becomes an unhandled
    // rejection. Recording an event is the runner's job, and so is complaining
    // when it fails.
    let queue: Promise<unknown> = Promise.resolve();
    const handle = (line: string, stream: "stdout" | "stderr") => {
      // The catch sits on the outer link so it covers a handler that throws
      // synchronously as well as one that rejects.
      queue = queue.then(() => input.onLine(line, stream)).catch(() => {});
    };

    const consume = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const { lines, rest } = drainLines(tails[stream] + chunk.toString("utf8"));
      tails[stream] = rest;
      for (const line of lines) handle(line, stream);
    };

    child.stdout.on("data", consume("stdout"));
    child.stderr.on("data", consume("stderr"));

    const timer = setTimeout(() => child.kill("SIGKILL"), input.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      for (const stream of ["stdout", "stderr"] as const) {
        if (tails[stream].trim()) handle(tails[stream], stream);
      }
      // Every line has to be handled before the run is reported as finished, or
      // a viewer sees the process exit with the last few results missing.
      void queue.then(() => resolve({ exitCode: code ?? 0 }));
    });
  });
}
