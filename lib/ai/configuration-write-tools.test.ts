import { describe, expect, it } from "vitest";
import { isConfigurationWriteTool } from "./configuration-write-tools";

describe("automatic tests after assistant writes", () => {
  it("includes subscription configuration changes", () => {
    expect(isConfigurationWriteTool("updatePlan")).toBe(true);
    expect(isConfigurationWriteTool("updateTopup")).toBe(true);
    expect(isConfigurationWriteTool("setRolePermissions")).toBe(true);
    expect(isConfigurationWriteTool("updateCoupon")).toBe(true);
  });

  it("excludes test fixtures, suite edits, and explicit runs", () => {
    expect(isConfigurationWriteTool("createTestUser")).toBe(false);
    expect(isConfigurationWriteTool("editTestSuite")).toBe(false);
    expect(isConfigurationWriteTool("runTestSuite")).toBe(false);
  });
});
