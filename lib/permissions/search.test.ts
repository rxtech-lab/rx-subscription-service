import { describe, expect, it } from "vitest";
import { permissionGroup, permissionSearchPattern } from "./search";

describe("permission key search", () => {
  it("treats SQL wildcard characters as literal key characters", () => {
    expect(permissionSearchPattern(" market_publish% ")).toBe("%market\\_publish\\%%");
    expect(permissionSearchPattern("a\\b")).toBe("%a\\\\b%");
    expect(permissionSearchPattern("")).toBe("%%");
  });
  it("groups explicit and inferred groups consistently", () => {
    expect(permissionGroup({ key: "market.publish.item", group: null })).toBe("market.publish");
    expect(permissionGroup({ key: "market.publish", group: "custom" })).toBe("custom");
    expect(permissionGroup({ key: "read", group: null })).toBe("Ungrouped");
  });
});
