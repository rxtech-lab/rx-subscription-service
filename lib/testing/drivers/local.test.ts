import { describe, expect, it } from "vitest";
import { localDriver } from "./local";

/**
 * The driver's contract with the runner is narrow but load-bearing: hand over
 * every complete line, in order, one at a time, and always settle.
 *
 * All three matter because the runner numbers events as they arrive. Handing a
 * burst of lines over concurrently gives two events the same sequence number
 * and the insert collides; letting a handler's rejection escape leaves the run
 * stuck at "running" with no way back.
 */

const BURST = `
const total = Number(process.env.LINES || 50);
for (let i = 0; i < total; i += 1) process.stdout.write("line-" + i + "\\n");
`;

describe("the local driver", () => {
  it("delivers every line of a burst, in order", async () => {
    const seen: string[] = [];

    const result = await localDriver.run({
      harness: BURST,
      suiteCode: "",
      timeoutMs: 20_000,
      env: { LINES: "200" },
      onLine: (line) => {
        seen.push(line);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(seen).toHaveLength(200);
    expect(seen[0]).toBe("line-0");
    expect(seen[199]).toBe("line-199");
  }, 30_000);

  it("waits for each handler before starting the next", async () => {
    // Overlap would show up as a second handler entering before the first left.
    let active = 0;
    let maxActive = 0;

    await localDriver.run({
      harness: BURST,
      suiteCode: "",
      timeoutMs: 20_000,
      env: { LINES: "40" },
      onLine: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      },
    });

    expect(maxActive).toBe(1);
  }, 30_000);

  it("still settles when a handler throws", async () => {
    const result = await localDriver.run({
      harness: BURST,
      suiteCode: "",
      timeoutMs: 20_000,
      env: { LINES: "10" },
      onLine: () => {
        throw new Error("could not persist");
      },
    });

    expect(result.exitCode).toBe(0);
  }, 30_000);

  it("reports the exit code of a failing run", async () => {
    const result = await localDriver.run({
      harness: `process.stdout.write("done\\n"); process.exit(3);`,
      suiteCode: "",
      timeoutMs: 20_000,
      env: {},
      onLine: () => {},
    });

    expect(result.exitCode).toBe(3);
  }, 30_000);
});
