import { describe, expect, it } from "vitest";
import { USAGE_LIMIT_PROMPT_RULES } from "./subscription-prompt-rules";
import { TEST_SUITE_EDIT_PROMPT_RULES } from "./test-suite-prompt-rules";
import { APP_STORE_SETUP_PROMPT_RULES } from "./app-store-prompt-rules";

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
    expect(prompt).toContain(
      "1000 trial points and 10000 after the trial means `{ amount: 10000, trialAmount: 1000 }`",
    );
    expect(prompt).toContain(
      "Set it to zero when the trial should grant no stored units",
    );
  });
});

describe("App Store setup system prompt", () => {
  it("teaches the agent the manual Apple product setup and mapping flow", () => {
    const prompt = APP_STORE_SETUP_PROMPT_RULES.join("\n");

    expect(prompt).toContain("call `getAppStoreSetup` first");
    expect(prompt).toContain(
      "does not create or update a product in App Store Connect",
    );
    expect(prompt).toContain(
      "Users and Access -> Integrations -> Keys -> In-App Purchase",
    );
    expect(prompt).toContain(
      "numeric Apple ID shown in App Store Connect -> Apps -> the app -> App Information",
    );
    expect(prompt).toContain("`quarter` = 3 months");
    expect(prompt).toContain(
      "RxArgo `trialDays` does not create the Apple trial",
    );
    expect(prompt).toContain("create a Non-Consumable In-App Purchase");
    expect(prompt).toContain("create a Consumable");
    expect(prompt).toContain("select Version 2");
    expect(prompt).toContain("StoreKit sandbox purchase tested");
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
