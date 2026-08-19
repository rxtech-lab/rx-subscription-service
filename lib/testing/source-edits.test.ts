import { describe, expect, it } from "vitest";
import { applySuiteSourceEdits } from "./source-edits";

describe("applySuiteSourceEdits", () => {
  it("replaces one exact source fragment", () => {
    expect(
      applySuiteSourceEdits("const limit = 300;\nrun(limit);", [
        {
          type: "replace",
          oldCode: "const limit = 300;",
          newCode: "const limit = 1_000;",
        },
      ]),
    ).toBe("const limit = 1_000;\nrun(limit);");
  });

  it("refuses an ambiguous exact replacement", () => {
    expect(() =>
      applySuiteSourceEdits("test();\ntest();", [
        { type: "replace", oldCode: "test();", newCode: "skip();" },
      ]),
    ).toThrow(/matches more than once/);
  });

  it("supports ordered inserts, line replacement, and deletion", () => {
    expect(
      applySuiteSourceEdits("one\ntwo\nthree", [
        { type: "insert_after", line: 1, code: "one-and-a-half" },
        { type: "replace_lines", startLine: 3, endLine: 3, code: "TWO" },
        { type: "insert_before", line: 4, code: "two-and-a-half" },
        { type: "delete_lines", startLine: 1, endLine: 1 },
      ]),
    ).toBe("one-and-a-half\nTWO\ntwo-and-a-half\nthree");
  });

  it("appends without losing or doubling the separating newline", () => {
    expect(
      applySuiteSourceEdits("one", [{ type: "append", code: "two" }]),
    ).toBe("one\ntwo");
    expect(
      applySuiteSourceEdits("one\n", [{ type: "append", code: "two" }]),
    ).toBe("one\ntwo");
  });

  it("rejects line numbers outside the current source", () => {
    expect(() =>
      applySuiteSourceEdits("one\ntwo", [
        { type: "insert_after", line: 3, code: "three" },
      ]),
    ).toThrow(/outside the current 1-2 line range/);
  });
});
