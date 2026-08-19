import { describe, expect, it } from "vitest";
import {
  checkSuiteTypes,
  enforceSuiteTypes,
  formatSuiteDiagnostics,
} from "./typecheck";
import { STARTER_SUITE } from "./sdk-types";

const BROKEN = `suite("A", () => { test("b", async () => { await rx.nope(); }); });`;

/**
 * The check that stands between the assistant and a suite that cannot run.
 *
 * What matters is not that it catches everything a compiler catches — it does,
 * because it is one — but that it catches the specific ways a generated suite
 * goes wrong, and that it does not fire on code that is merely unusual.
 */

describe("checkSuiteTypes", () => {
  it("accepts the starter suite", () => {
    expect(checkSuiteTypes(STARTER_SUITE)).toEqual([]);
  });

  it("catches a method the harness does not implement", () => {
    const errors = checkSuiteTypes(`
      suite("A", () => {
        test("b", async () => {
          await rx.testUsers.createMany(3);
        });
      });
    `);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("createMany");
  });

  it("catches a field that does not exist on a result", () => {
    // The most likely way a plausible-looking generated suite is wrong.
    const errors = checkSuiteTypes(`
      suite("A", () => {
        test("b", async () => {
          const entitlements = await rx.entitlements("test:1");
          expect(entitlements.subscriptions).toHaveLength(0);
        });
      });
    `);

    expect(errors[0].message).toContain("subscriptions");
  });

  it("catches an argument of the wrong type", () => {
    const errors = checkSuiteTypes(`
      suite("A", () => {
        test("b", async () => {
          await rx.usage.record("test:1", "api_calls", "one");
        });
      });
    `);

    expect(errors[0].message).toMatch(/string.*not assignable.*number/i);
  });

  it("catches a syntax error", () => {
    const errors = checkSuiteTypes(`suite("A", () => { test("b" });`);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("reports the line and column, so the author can find it", () => {
    const errors = checkSuiteTypes(
      ['suite("A", () => {', '  test("b", async () => {', "    rx.nope();", "  });", "});"].join(
        "\n",
      ),
    );

    expect(errors[0].line).toBe(3);
    expect(errors[0].column).toBeGreaterThan(1);
    expect(formatSuiteDiagnostics(errors)).toContain("line 3:");
  });

  it("rejects an import, since a suite has no module resolution", () => {
    const errors = checkSuiteTypes(`
      import { readFile } from "node:fs/promises";
      suite("A", () => { test("b", async () => { await readFile("x"); }); });
    `);

    expect(errors.length).toBeGreaterThan(0);
  });

  it("allows ordinary TypeScript a suite might reasonably use", () => {
    const errors = checkSuiteTypes(`
      interface Expected {
        key: string;
        limit: number | null;
      }

      suite("Usage", () => {
        const expectations: Expected[] = [{ key: "api_calls", limit: 100 }];

        for (const expectation of expectations) {
          test("checks " + expectation.key, async () => {
            const user = await rx.testUsers.create({ displayName: "A" });
            const snapshot = await rx.usage.get(user.rxlabUserId);
            const item = snapshot.usage.find((entry) => entry.key === expectation.key);
            if (!item) return;
            expect(item.limit).toBe(expectation.limit);
          });
        }
      });
    `);

    expect(errors).toEqual([]);
  });

  it("accepts coupon reservations and deterministic time travel", () => {
    const errors = checkSuiteTypes(`
      suite("Coupon limits", () => {
        test("a scheduled code reaches its per-user limit", async () => {
          const user = await rx.testUsers.create();
          const coupons = await rx.config.coupons();
          const topups = await rx.config.topups();
          const coupon = coupons[0];
          const topup = topups[0];
          if (!coupon || !topup) return;

          if (coupon.startsAt) {
            await rx.testUsers.setTime(
              user.rxlabUserId,
              Date.parse(coupon.startsAt) + 60_000,
            );
          }

          const target: RxCouponTargetInput = { kind: "topup", id: topup.id };
          const preview = await rx.coupons.validate(
            user.rxlabUserId,
            coupon.code,
            target,
          );
          expect(preview.valid).toBe(true);

          const reservation = await rx.coupons.reserve(
            user.rxlabUserId,
            coupon.code,
            target,
          );
          expect(reservation.reserved).toBe(true);
          await rx.testUsers.advanceClock(user.rxlabUserId, 86_400_000);
        });
      });
    `);

    expect(errors).toEqual([]);
  });

  it("accepts trial grants and explicit trial-to-paid transitions", () => {
    const errors = checkSuiteTypes(`
      suite("Trial limits", () => {
        test("uses separate trial and paid allowances", async () => {
          const user = await rx.testUsers.create();
          const plans = await rx.config.plans();
          const plan = plans.find((entry) => entry.trialDays > 0);
          if (!plan) return;

          const trial = await rx.testUsers.grantPlan(user.rxlabUserId, plan.key, {
            status: "trialing",
          });
          expect(trial.status).toBe("trialing");
          expect(trial.currentPeriodEnd).not.toBeNull();

          const paid = await rx.testUsers.grantPlan(user.rxlabUserId, plan.key, {
            status: "active",
          });
          expect(paid.status).toBe("active");
        });
      });
    `);

    expect(errors).toEqual([]);
  });

  it("holds the compiler under strict mode", () => {
    // A suite that ignores a null is a suite that fails at run time with a
    // message about undefined rather than an assertion.
    const errors = checkSuiteTypes(`
      suite("A", () => {
        test("b", async () => {
          const catalog = await rx.catalog("test:1");
          const topup = catalog.topups.find((entry) => entry.key === "pack");
          expect(topup.eligible).toBe(true);
        });
      });
    `);

    expect(errors[0].message).toMatch(/possibly 'undefined'/i);
  });

  it("refuses a broken suite from the assistant, with the errors to fix", () => {
    // The assistant never sees a squiggle, so a broken suite must not reach the
    // database — the thrown message is the tool result it retries from.
    expect(() => enforceSuiteTypes(BROKEN, { type: "ai", id: "u1" })).toThrow(
      /does not compile/i,
    );
    expect(() => enforceSuiteTypes(BROKEN, { type: "ai", id: "u1" })).toThrow(/nope/);
  });

  it("lets a human save a broken suite, and says how broken", () => {
    // Monaco already showed these; blocking would only stop someone parking a
    // half-finished thought.
    const diagnostics = enforceSuiteTypes(BROKEN, { type: "user", id: "u1" });
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("reports nothing either way when the suite compiles", () => {
    expect(enforceSuiteTypes(STARTER_SUITE, { type: "ai", id: "u1" })).toEqual([]);
    expect(enforceSuiteTypes(STARTER_SUITE, { type: "user", id: "u1" })).toEqual([]);
  });

  it("checks the second call as fast as it can, having cached the library", () => {
    // Not a benchmark — a guard that the lib cache is actually wired up, since
    // losing it turns every save into a fresh parse of the standard library.
    checkSuiteTypes(STARTER_SUITE);
    const started = Date.now();
    checkSuiteTypes(STARTER_SUITE);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
