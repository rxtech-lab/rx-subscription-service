import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { drainLines } from "../protocol";
import {
  HARNESS_FILENAME,
  NODE_ARGS,
  SUITE_FILENAME,
  type RunDriver,
  type RunDriverInput,
} from "./types";

/**
 * Run a suite in a Vercel Sandbox — a Firecracker microVM with its own
 * filesystem and process table.
 *
 * The suite is arbitrary code, so nothing about it is trusted: it never touches
 * this process, and the only credentials that travel with it are a run-scoped
 * API key and a control token that both die with the run. What the sandbox can
 * reach over the network is this deployment's public API, which is the point —
 * the tests are meant to exercise the same surface a customer's backend uses.
 */
export const sandboxDriver: RunDriver = {
  name: "sandbox",

  async run(input: RunDriverInput) {
    const sandbox = await Sandbox.create({
      runtime: "node24",
      // The sandbox must outlive the suite, or a slow run is killed by its host
      // rather than by its own timeout and reports nothing useful.
      timeout: input.timeoutMs + 30_000,
      resources: { vcpus: 1 },
      signal: input.signal,
    });

    try {
      await sandbox.writeFiles([
        { path: HARNESS_FILENAME, content: Buffer.from(input.harness, "utf8") },
        { path: SUITE_FILENAME, content: Buffer.from(input.suiteCode, "utf8") },
      ]);

      const command = await sandbox.runCommand({
        cmd: "node",
        args: NODE_ARGS,
        env: input.env,
        detached: true,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });

      // Chunks arrive without regard for line boundaries; the protocol is
      // line-delimited, so each stream keeps its own tail until a newline.
      const tails: Record<string, string> = { stdout: "", stderr: "" };

      for await (const log of command.logs({ signal: input.signal })) {
        const stream = log.stream === "stderr" ? "stderr" : "stdout";
        const { lines, rest } = drainLines(tails[stream] + log.data);
        tails[stream] = rest;
        for (const line of lines) await input.onLine(line, stream);
      }

      for (const stream of ["stdout", "stderr"] as const) {
        if (tails[stream].trim()) await input.onLine(tails[stream], stream);
      }

      const finished = await command.wait();
      return { exitCode: finished.exitCode ?? 0 };
    } finally {
      // Sandboxes are billed while alive; a leaked one outlives the run it was
      // created for by up to its whole timeout.
      await sandbox.stop().catch(() => {});
    }
  },
};
