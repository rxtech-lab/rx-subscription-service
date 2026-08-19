import { describe, expect, it } from "vitest";
import { USAGE_LIMIT_PROMPT_RULES } from "./subscription-prompt-rules";
import { TEST_SUITE_EDIT_PROMPT_RULES } from "./test-suite-prompt-rules";

describe("subscription agent system prompt", () => {
  it("teaches the agent how to create trial-specific usage limits", () => {
    const prompt = USAGE_LIMIT_PROMPT_RULES.join("\n");

    expect(prompt).toContain(
      "`limitValue` is the non-trial allowance used while the subscription is `active` or `past_due`",
    );
    expect(prompt).toContain(
      "trial 100 and non-trial 1000 means `{ limitValue: 1000, trialLimitValue: 100 }`",
    );
    expect(prompt).toContain(
      "If the plan has zero `trialDays`, explain that a trial limit will not take effect",
    );
    expect(prompt).toContain(
      "Use null only when the user explicitly wants that state to be unlimited",
    );
    expect(prompt).toContain(
      "call `removePlanEntitlement` with the exact obsolete entitlement id",
    );
    expect(prompt).toContain("never remove the newly added replacement");
  });
});

describe("test suite editing system prompt", () => {
  it("uses incremental edits for focused changes and full saves for rewrites", () => {
    const prompt = TEST_SUITE_EDIT_PROMPT_RULES.join("\n");

    expect(prompt).toContain(
      "`saveTestSuite` creates a suite or intentionally replaces a whole file",
    );
    expect(prompt).toContain("`editTestSuite` changes part of an existing file");
    expect(prompt).toContain("call `getTestSuite` immediately before");
    expect(prompt).toContain("Each line number addresses the source produced by");
    expect(prompt).toContain("rejected without changing the existing source");
    expect(prompt).toContain(
      'grantPlan(user.rxlabUserId, plan.key, { status: "trialing" })',
    );
    expect(prompt).toContain("moving the test clock alone does not change subscription status");
  });
});
