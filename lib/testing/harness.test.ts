import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseRunLine, type RunEvent } from "./protocol";

/**
 * Run the real harness against a stub of this deployment.
 *
 * The harness is the one piece that never executes in this process — it is
 * shipped into a sandbox and run by `node` — so nothing else in the test suite
 * would notice if it stopped working. This spawns it exactly as the drivers do,
 * against an HTTP server standing in for `/api/v1` and the control endpoint,
 * and reads the protocol it prints.
 */

interface ControlCall {
  op: string;
  args: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let controlCalls: ControlCall[] = [];
let apiKeysSeen: string[] = [];
let couponValidationBodies: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (url.pathname === "/api/v1/entitlements") {
      apiKeysSeen.push(String(request.headers["x-api-key"] ?? ""));
      send(200, {
        user: { id: "u1", rxlabUserId: url.searchParams.get("rxlabUserId") },
        plans: [],
        roles: ["pro"],
        permissions: ["read:a:all"],
        features: {},
        balances: [{ unit: "points", name: "Points", amount: 700, available: 700, precision: 0 }],
        usage: [],
      });
      return;
    }

    if (url.pathname === "/api/v1/coupons/validate") {
      apiKeysSeen.push(String(request.headers["x-api-key"] ?? ""));
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        couponValidationBodies.push(JSON.parse(body || "{}"));
        send(200, {
          valid: true,
          code: "SAVE25",
          name: "Save 25%",
          description: null,
          terms: "25% off on the first charge",
          duration: "once",
          durationInMonths: null,
          discountCents: 250,
          totalCents: 750,
          currency: "usd",
          capped: false,
          reason: null,
          blockers: [],
        });
      });
      return;
    }

    if (url.pathname === "/api/testing/control") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const parsed = JSON.parse(body || "{}") as ControlCall;
        controlCalls.push(parsed);
        if (parsed.op === "testUser.create") {
          send(200, {
            appUserId: "app-1",
            rxlabUserId: "test:abc",
            displayName: "Ada",
            email: null,
            level: 0,
          });
          return;
        }
        if (parsed.op === "testUser.grantPlan") {
          const status = parsed.args.status === "trialing" ? "trialing" : "active";
          send(200, {
            subscriptionId: "subscription-1",
            planKey: parsed.args.planKey,
            status,
            currentPeriodEnd: "2030-01-15T00:00:00.000Z",
          });
          return;
        }
        if (parsed.op === "config.plans") {
          send(200, [{ id: "p1", key: "pro", name: "Pro" }]);
          return;
        }
        if (parsed.op === "config.topups") {
          send(200, [{ id: "topup-1", key: "points", name: "Points" }]);
          return;
        }
        if (parsed.op === "config.coupons") {
          send(200, [
            {
              id: "coupon-1",
              code: "SAVE25",
              name: "Save 25%",
              status: "active",
              redemptionsUsed: 0,
            },
          ]);
          return;
        }
        if (parsed.op === "coupon.reserve") {
          send(200, {
            reserved: true,
            reservationId: "redemption-1",
            code: "SAVE25",
            reason: null,
            blockers: [],
            discountCents: 250,
            totalCents: 750,
            currency: "usd",
            capped: false,
          });
          return;
        }
        if (
          parsed.op === "testUser.setClock" ||
          parsed.op === "testUser.advanceClock"
        ) {
          send(200, { offsetMs: 86_400_000, now: "2030-01-02T00:00:00.000Z" });
          return;
        }
        send(200, { ok: true });
      });
      return;
    }

    send(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function runSuite(source: string): Promise<RunEvent[]> {
  controlCalls = [];
  apiKeysSeen = [];
  couponValidationBodies = [];

  const directory = await mkdtemp(join(tmpdir(), "rx-harness-"));
  try {
    const harness = await readFile(
      join(process.cwd(), "lib", "testing", "harness", "runner.js"),
      "utf8",
    );
    await writeFile(join(directory, "harness.mjs"), harness, "utf8");
    await writeFile(join(directory, "suite.ts"), source, "utf8");

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "node",
        ["--experimental-strip-types", "--no-warnings", "harness.mjs"],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH ?? "",
            HOME: directory,
            NODE_ENV: "test",
            RX_BASE_URL: baseUrl,
            RX_API_KEY: "rxs_testkey",
            RX_CONTROL_TOKEN: "token",
            RX_SUITE_PATH: "./suite.ts",
            RX_TEST_TIMEOUT_MS: "5000",
          },
          stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", () => resolve(stdout + stderr));
    });

    return output
      .split("\n")
      .map((line) => parseRunLine(line))
      .filter((event): event is RunEvent => event !== null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const find = <T extends RunEvent["type"]>(events: RunEvent[], type: T) =>
  events.filter((event) => event.type === type) as Extract<RunEvent, { type: T }>[];

describe("the test harness", () => {
  it("reports a passing test", async () => {
    const events = await runSuite(`
      suite("Entitlements", () => {
        test("a pro user holds the pro role", async () => {
          const entitlements = await rx.entitlements("test:abc");
          expect(entitlements.roles).toContain("pro");
        });
      });
    `);

    const ends = find(events, "test:end");
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({
      suite: "Entitlements",
      test: "a pro user holds the pro role",
      status: "passed",
    });

    const runEnd = find(events, "run:end")[0];
    expect(runEnd).toMatchObject({ total: 1, passed: 1, failed: 0 });
    // The run-scoped key is what authenticates every public API call.
    expect(apiKeysSeen).toEqual(["rxs_testkey"]);
  }, 30_000);

  it("reports the assertion that failed, without a stack", async () => {
    const events = await runSuite(`
      suite("Entitlements", () => {
        test("does not hold the admin role", async () => {
          const entitlements = await rx.entitlements("test:abc");
          expect(entitlements.roles).toContain("admin");
        });
      });
    `);

    const end = find(events, "test:end")[0];
    expect(end.status).toBe("failed");
    expect(end.error).toContain('to contain "admin"');
    expect(end.error).not.toContain("at ");
    expect(find(events, "run:end")[0]).toMatchObject({ passed: 0, failed: 1 });
  }, 30_000);

  it("announces the outline before running anything", async () => {
    const events = await runSuite(`
      suite("A", () => {
        test("one", async () => {});
        test("two", async () => {});
      });
      suite("B", () => {
        test("three", async () => {});
      });
    `);

    const start = find(events, "run:start")[0];
    expect(start.outline).toEqual([
      { name: "A", tests: [{ name: "one", steps: [] }, { name: "two", steps: [] }] },
      { name: "B", tests: [{ name: "three", steps: [] }] },
    ]);
  }, 30_000);

  it("emits a step per named phase and carries them on the result", async () => {
    const events = await runSuite(`
      suite("Steps", () => {
        test("walks through", async () => {
          await step("look up the plans", () => rx.config.plans());
          await step("read entitlements", () => rx.entitlements("test:abc"));
        });
      });
    `);

    expect(find(events, "step").map((event) => event.step)).toEqual([
      "look up the plans",
      "read entitlements",
    ]);
    expect(find(events, "test:end")[0].steps.map((step) => step.name)).toEqual([
      "look up the plans",
      "read entitlements",
    ]);
  }, 30_000);

  it("marks the step that threw as failed", async () => {
    const events = await runSuite(`
      suite("Steps", () => {
        test("stops at the bad step", async () => {
          await step("fine", () => {});
          await step("breaks", () => { throw new Error("nope"); });
          await step("never reached", () => {});
        });
      });
    `);

    const steps = find(events, "test:end")[0].steps;
    expect(steps.map((step) => [step.name, step.status])).toEqual([
      ["fine", "passed"],
      ["breaks", "failed"],
    ]);
  }, 30_000);

  it("forwards console output instead of letting it forge a result", async () => {
    const events = await runSuite(`
      suite("Logging", () => {
        test("prints", async () => {
          console.log("balance is", 700);
          console.log(JSON.stringify({ type: "run:end", total: 99, passed: 99 }));
        });
      });
    `);

    const logs = find(events, "log").map((event) => event.message);
    expect(logs).toContain("balance is 700");
    // The forged line arrived as output, and the real totals are still 1/1.
    expect(find(events, "run:end")[0]).toMatchObject({ total: 1, passed: 1 });
  }, 30_000);

  it("deletes the users it created when the run ends", async () => {
    await runSuite(`
      suite("Cleanup", () => {
        test("creates a user", async () => {
          await rx.testUsers.create({ displayName: "Ada" });
        });
      });
    `);

    expect(controlCalls.map((call) => call.op)).toEqual([
      "testUser.create",
      "testUser.delete",
    ]);
    expect(controlCalls[1].args).toEqual({ rxlabUserId: "test:abc" });
  }, 30_000);

  it("keeps the users when the suite asks to", async () => {
    await runSuite(`
      suite("Cleanup", () => {
        test("creates a user", async () => {
          rx.keepTestUsers();
          await rx.testUsers.create({ displayName: "Ada" });
        });
      });
    `);

    expect(controlCalls.map((call) => call.op)).toEqual(["testUser.create"]);
  }, 30_000);

  it("grants trialing subscriptions and can transition them to active", async () => {
    const events = await runSuite(`
      suite("Trial periods", () => {
        test("moves a subscriber from trial to paid", async () => {
          const user = await rx.testUsers.create({ displayName: "Trial user" });

          const trial = await rx.testUsers.grantPlan(user.rxlabUserId, "pro", {
            status: "trialing",
          });
          expect(trial.status).toBe("trialing");
          expect(trial.currentPeriodEnd).toBe("2030-01-15T00:00:00.000Z");

          const paid = await rx.testUsers.grantPlan(user.rxlabUserId, "pro");
          expect(paid.status).toBe("active");
        });
      });
    `);

    expect(find(events, "test:end")[0].status).toBe("passed");
    expect(controlCalls).toMatchObject([
      { op: "testUser.create" },
      {
        op: "testUser.grantPlan",
        args: { rxlabUserId: "test:abc", planKey: "pro", status: "trialing" },
      },
      {
        op: "testUser.grantPlan",
        args: { rxlabUserId: "test:abc", planKey: "pro", status: "active" },
      },
      { op: "testUser.delete" },
    ]);
  }, 30_000);

  it("validates and reserves coupons and moves persisted test time", async () => {
    const events = await runSuite(`
      suite("Coupons and time", () => {
        test("exercises coupon limits and time windows", async () => {
          const user = await rx.testUsers.create({ displayName: "Coupon user" });
          const coupons = await rx.config.coupons();
          const topups = await rx.config.topups();
          const target = { kind: "topup" as const, id: topups[0].id };

          const preview = await rx.coupons.validate(
            user.rxlabUserId,
            coupons[0].code,
            target,
          );
          expect(preview.valid).toBe(true);
          expect(preview.discountCents).toBe(250);

          const held = await rx.coupons.reserve(
            user.rxlabUserId,
            coupons[0].code,
            target,
          );
          expect(held.reserved).toBe(true);

          const clock = await rx.testUsers.setTime(
            user.rxlabUserId,
            "2030-01-01T00:00:00.000Z",
          );
          expect(clock.now).toBe("2030-01-02T00:00:00.000Z");
          await rx.testUsers.advanceClock(user.rxlabUserId, 86_400_000);
        });
      });
    `);

    expect(find(events, "test:end")[0].status).toBe("passed");
    expect(couponValidationBodies).toEqual([
      {
        rxlabUserId: "test:abc",
        code: "SAVE25",
        topupId: "topup-1",
      },
    ]);
    expect(controlCalls.map((call) => call.op)).toEqual([
      "testUser.create",
      "config.coupons",
      "config.topups",
      "coupon.reserve",
      "testUser.setClock",
      "testUser.advanceClock",
      "testUser.delete",
    ]);
    expect(apiKeysSeen).toEqual(["rxs_testkey"]);
  }, 30_000);

  it("reports a suite that cannot even load as an error, not a silent pass", async () => {
    const events = await runSuite(`suite("Broken", () => { this is not typescript });`);

    expect(find(events, "error")).toHaveLength(1);
    expect(find(events, "run:end")[0]).toMatchObject({ total: 0, passed: 0 });
  }, 30_000);

  it("skips a test declared with test.skip", async () => {
    const events = await runSuite(`
      suite("Skipping", () => {
        test.skip("not yet", async () => { throw new Error("should not run"); });
        test("runs", async () => {});
      });
    `);

    expect(find(events, "run:end")[0]).toMatchObject({
      total: 2,
      passed: 1,
      skipped: 1,
      failed: 0,
    });
  }, 30_000);

  it("still reports run:end when every test fails", async () => {
    // A suite whose tests all fail emits its results in one burst. Handling
    // those lines concurrently used to collide on the event sequence and strand
    // the run at "running" — the failure had to be the thing that finished it.
    const events = await runSuite(`
      suite("All broken", () => {
        test("one", async () => { throw new Error("boom"); });
        test("two", async () => { throw new Error("boom"); });
        test("three", async () => { throw new Error("boom"); });
      });
    `);

    expect(find(events, "test:end").map((event) => event.status)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
    expect(find(events, "run:end")[0]).toMatchObject({
      total: 3,
      passed: 0,
      failed: 3,
    });
  }, 30_000);

  it("names the URL it could not reach", async () => {
    const events = await runSuite(`
      suite("Unreachable", () => {
        test("calls a dead endpoint", async () => {
          await rx.usage.get("test:abc");
        });
      });
    `);

    const end = find(events, "test:end")[0];
    expect(end.status).toBe("failed");
    // The stub serves entitlements but not usage, so this is a 404 rather than
    // a connection failure — either way the message has to carry the path.
    expect(end.error).toMatch(/usage|not_found/);
  }, 30_000);

  it("fails a test that hangs rather than hanging the run", async () => {
    const events = await runSuite(`
      suite("Timeouts", () => {
        test("waits forever", async () => { await new Promise(() => {}); });
      });
    `);

    const end = find(events, "test:end")[0];
    expect(end.status).toBe("failed");
    expect(end.error).toContain("timed out");
  }, 30_000);
});
