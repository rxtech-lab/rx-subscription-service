import { describe, expect, it } from "vitest";
import { isTargetedScope, normalizeScopeOptions, permissionScopeOptions } from "./scope-options";

describe("permission scope configuration", () => {
  it("accepts custom actions and deduplicates choices", () => {
    expect(normalizeScopeOptions([" read ", "read", "approve:id"])).toEqual(["read", "approve:id"]);
    expect(isTargetedScope("approve:id")).toBe(true);
    expect(isTargetedScope("approve")).toBe(false);
  });
  it("rejects empty, ambiguous and malformed choices", () => {
    for (const values of [[], [""], ["selected"], ["selected:id"], ["read:all"], ["read,write"], ["Read"]]) {
      expect(() => normalizeScopeOptions(values)).toThrow();
    }
  });
  it("preserves the available choices for legacy permissions", () => {
    expect(permissionScopeOptions({ supportsAll: false, supportsIds: true })).toEqual(["selected"]);
    expect(permissionScopeOptions({ supportsAll: true, supportsIds: true, scopeOptions: ["approve"] })).toEqual(["approve"]);
  });
});
