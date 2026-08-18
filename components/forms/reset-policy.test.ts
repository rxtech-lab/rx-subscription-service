import { describe, expect, it } from "vitest";
import { resetPolicyHasInterval } from "./reset-policy";

describe("resetPolicyHasInterval", () => {
  it("requires interval fields only for windowed reset policies", () => {
    expect(resetPolicyHasInterval("never")).toBe(false);
    expect(resetPolicyHasInterval("billing_period")).toBe(false);
    expect(resetPolicyHasInterval("rolling_window")).toBe(true);
    expect(resetPolicyHasInterval("calendar_period")).toBe(true);
  });
});
