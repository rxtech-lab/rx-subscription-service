import { describe, expect, it } from "vitest";
import {
  buildPermissionExpression,
  hasPermission,
  isPermissionExpression,
  parsePermissionExpression,
  parsePermissionList,
  permissionTargets,
  serializePermissionList,
} from "./expression";

describe("parsePermissionExpression", () => {
  it("parses an all-scope expression", () => {
    expect(parsePermissionExpression("read:a:all")).toEqual({
      key: "read:a",
      scope: "all",
      targetIds: [],
    });
  });

  it("parses a selected-scope expression and sorts and dedupes ids", () => {
    expect(parsePermissionExpression("read:a:id2,id1,id2")).toEqual({
      key: "read:a",
      scope: "selected",
      targetIds: ["id1", "id2"],
    });
  });

  it("keeps colons that belong to the key", () => {
    expect(parsePermissionExpression("read:oauth_clients:all")?.key).toBe(
      "read:oauth_clients",
    );
  });

  it("treats a single-segment key as valid", () => {
    expect(parsePermissionExpression("billing:all")).toEqual({
      key: "billing",
      scope: "all",
      targetIds: [],
    });
  });

  it("rejects malformed values", () => {
    expect(parsePermissionExpression("read")).toBeNull();
    expect(parsePermissionExpression("read:")).toBeNull();
    expect(parsePermissionExpression(":all")).toBeNull();
    expect(parsePermissionExpression("read:a:")).toBeNull();
    expect(parsePermissionExpression("read a:all")).toBeNull();
    expect(parsePermissionExpression("read:a:id 1")).toBeNull();
  });

  it("rejects an empty id list", () => {
    expect(parsePermissionExpression("read:a:,,")).toBeNull();
  });
});

describe("buildPermissionExpression", () => {
  it("builds both scopes", () => {
    expect(
      buildPermissionExpression({ key: "read:a", scope: "all", targetIds: [] }),
    ).toBe("read:a:all");
    expect(
      buildPermissionExpression({
        key: "read:a",
        scope: "selected",
        targetIds: ["  id2 ", "id1", ""],
      }),
    ).toBe("read:a:id1,id2");
  });

  it("returns null when a selected grant has no targets", () => {
    expect(
      buildPermissionExpression({ key: "read:a", scope: "selected", targetIds: [] }),
    ).toBeNull();
  });

  it("round-trips through the parser", () => {
    const value = "write:plans:p1,p2";
    const parsed = parsePermissionExpression(value);
    expect(parsed && buildPermissionExpression(parsed)).toBe(value);
  });
});

describe("parsePermissionList", () => {
  it("unions selected grants for the same key", () => {
    expect(parsePermissionList(["read:a:id1", "read:a:id2"])).toEqual([
      { key: "read:a", scope: "selected", targetIds: ["id1", "id2"] },
    ]);
  });

  it("lets all beat selected regardless of order", () => {
    expect(parsePermissionList(["read:a:id1", "read:a:all"])).toEqual([
      { key: "read:a", scope: "all", targetIds: [] },
    ]);
    expect(parsePermissionList(["read:a:all", "read:a:id1"])).toEqual([
      { key: "read:a", scope: "all", targetIds: [] },
    ]);
  });

  it("skips malformed entries instead of throwing", () => {
    expect(parsePermissionList(["nonsense", "read:a:all"])).toEqual([
      { key: "read:a", scope: "all", targetIds: [] },
    ]);
  });

  it("sorts distinct keys", () => {
    expect(
      parsePermissionList(["write:b:all", "read:a:all"]).map((e) => e.key),
    ).toEqual(["read:a", "write:b"]);
  });
});

describe("hasPermission", () => {
  it("grants everything under an all scope", () => {
    expect(hasPermission(["read:a:all"], "read:a", "anything")).toBe(true);
  });

  it("grants only listed targets under a selected scope", () => {
    expect(hasPermission(["read:a:id1,id2"], "read:a", "id1")).toBe(true);
    expect(hasPermission(["read:a:id1,id2"], "read:a", "id3")).toBe(false);
  });

  it("answers the unscoped question when no target is given", () => {
    expect(hasPermission(["read:a:id1"], "read:a")).toBe(true);
    expect(hasPermission(["read:b:id1"], "read:a")).toBe(false);
  });

  it("does not confuse a key prefix for a match", () => {
    expect(hasPermission(["read:ab:all"], "read:a", "id1")).toBe(false);
  });
});

describe("permissionTargets", () => {
  it("reports all, a list, or null", () => {
    expect(permissionTargets(["read:a:all"], "read:a")).toBe("all");
    expect(permissionTargets(["read:a:id1"], "read:a")).toEqual(["id1"]);
    expect(permissionTargets([], "read:a")).toBeNull();
  });
});

describe("serializePermissionList", () => {
  it("drops empty grants and sorts the output", () => {
    expect(
      serializePermissionList([
        { key: "write:b", scope: "selected", targetIds: [] },
        { key: "read:a", scope: "all", targetIds: [] },
        { key: "write:c", scope: "selected", targetIds: ["x"] },
      ]),
    ).toEqual(["read:a:all", "write:c:x"]);
  });
});

describe("isPermissionExpression", () => {
  it("validates syntax", () => {
    expect(isPermissionExpression("read:a:all")).toBe(true);
    expect(isPermissionExpression("read:a")).toBe(true);
    expect(isPermissionExpression("read")).toBe(false);
  });
});

describe("custom action scopes", () => {
  it("serializes broad, targeted and custom actions without changing legacy expressions", () => {
    expect(buildPermissionExpression({ key: "market", scope: "read", targetIds: [] })).toBe("read:market:all");
    expect(buildPermissionExpression({ key: "market", scope: "write:id", targetIds: ["p1"] })).toBe("write:market:p1");
    expect(buildPermissionExpression({ key: "market", scope: "all:id", targetIds: ["p1"] })).toBe("market:p1");
    expect(buildPermissionExpression({ key: "market", scope: "approve", targetIds: [] })).toBe("approve:market:all");
  });

  it("keeps actions and targets isolated while allowing all actions for selected ids", () => {
    const grants = ["read:market:all", "write:market:p1", "market:p2"];
    expect(hasPermission(grants, "market", "p3", "read")).toBe(true);
    expect(hasPermission(grants, "market", "p3", "write")).toBe(false);
    expect(hasPermission(grants, "market", "p1", "write")).toBe(true);
    expect(hasPermission(grants, "market", "p1", "approve")).toBe(false);
    expect(hasPermission(grants, "market", "p2", "approve")).toBe(true);
    expect(hasPermission(grants, "other", "p2", "read")).toBe(false);
    expect(permissionTargets(grants, "market", "write")).toEqual(["p1", "p2"]);
    expect(permissionTargets(grants, "market", "read")).toBe("all");
  });

  it("rejects target ids that could become broader grants", () => {
    for (const target of ["all", "p1,p2", "p1:all", "p 1"]) {
      expect(buildPermissionExpression({ key: "market", scope: "write:id", targetIds: [target] })).toBeNull();
    }
    expect(buildPermissionExpression({ key: "market", scope: "write:id", targetIds: [] })).toBeNull();
  });
});
