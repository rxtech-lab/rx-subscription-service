import { describe, expect, it } from "vitest";
import { countTests, parseOutline } from "./outline";

describe("parseOutline", () => {
  it("groups tests under the suite they are declared in", () => {
    const outline = parseOutline(`
      suite("Topups", () => {
        test("buys a pack", async () => {});
        test("is blocked without a plan", async () => {});
      });

      suite("Usage", () => {
        test("counts a call", async () => {});
      });
    `);

    expect(outline).toEqual([
      {
        name: "Topups",
        tests: [
          { name: "buys a pack", steps: [] },
          { name: "is blocked without a plan", steps: [] },
        ],
      },
      { name: "Usage", tests: [{ name: "counts a call", steps: [] }] },
    ]);
    expect(countTests(outline)).toBe(3);
  });

  it("attaches steps to the test that contains them", () => {
    const outline = parseOutline(`
      suite("Lifecycle", () => {
        test("subscribes", async () => {
          const user = await step("create a user", () => rx.testUsers.create());
          await step("grant the plan", () => rx.testUsers.grantPlan(user.id, "pro"));
        });
        test("cancels", async () => {
          await step("cancel", () => {});
        });
      });
    `);

    expect(outline[0].tests[0].steps).toEqual(["create a user", "grant the plan"]);
    expect(outline[0].tests[1].steps).toEqual(["cancel"]);
  });

  it("puts a test declared outside any suite into an implicit group", () => {
    const outline = parseOutline(`test("stands alone", async () => {});`);
    expect(outline).toEqual([
      { name: "Tests", tests: [{ name: "stands alone", steps: [] }] },
    ]);
  });

  it("ignores the vocabulary when it appears in a string or a comment", () => {
    const outline = parseOutline(`
      // suite("commented out", () => {});
      /* test("also not real", () => {}); */
      suite("Real", () => {
        test("mentions suite(\\"nope\\") in a message", async () => {
          expect("test(\\"inner\\")").toBe("test(\\"inner\\")");
        });
      });
    `);

    expect(outline).toHaveLength(1);
    expect(outline[0].name).toBe("Real");
    expect(outline[0].tests).toHaveLength(1);
  });

  it("does not treat a method call as the global helper", () => {
    const outline = parseOutline(`
      suite("Real", () => {
        test("a", async () => {
          runner.test("not a declaration");
          await rx.step("also not one");
        });
      });
    `);

    expect(outline[0].tests).toEqual([{ name: "a", steps: [] }]);
  });

  it("skips a name it cannot know before the file runs", () => {
    // An interpolated title is only knowable at run time; the run itself
    // reports the real outline, so the diagram simply omits it beforehand.
    const outline = parseOutline(
      "suite(\"Plans\", () => { test(`buys ${plan.name}`, async () => {}); });",
    );
    expect(outline).toEqual([{ name: "Plans", tests: [] }]);
  });

  it("handles a brace inside a string without losing the structure", () => {
    const outline = parseOutline(`
      suite("Braces", () => {
        test("a", async () => {
          expect(JSON.stringify({ a: 1 })).toBe("{\\"a\\":1}");
        });
        test("b", async () => {});
      });
    `);

    expect(outline[0].tests.map((test) => test.name)).toEqual(["a", "b"]);
  });

  it("returns nothing for a file with no declarations", () => {
    expect(parseOutline("const x = 1;")).toEqual([]);
  });
});
