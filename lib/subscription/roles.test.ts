import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ values: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        mocks.values(row);
        return { returning: async () => [row] };
      },
    }),
  },
}));

import { createPermission, createRole } from "./roles";
import { buildPermissionExpression, hasPermission } from "@/lib/permissions/expression";

const input = {
  applicationId: "app",
  title: "Publish marketplace items",
  actor: { type: "user" as const, id: "admin" },
};

beforeEach(() => vi.clearAllMocks());

it.each(["marketplace.publish", "marketplace.publish:all", "read:marketplace.items", "read:a", "marketplace-publish", "marketplace_publish", "a".repeat(64)])(
  "creates a permission with key %s",
  async (key) => {
    expect(await createPermission({ ...input, key })).toMatchObject({ key });
  },
);

it("normalizes dotted keys and preserves their scoped access behavior", async () => {
  const permission = await createPermission({ ...input, key: " Marketplace.Publish " });
  const expression = buildPermissionExpression({ key: permission.key, scope: "all", targetIds: [] });
  expect(expression).toBe("marketplace.publish:all");
  expect(hasPermission([expression!], "marketplace.publish", "item1")).toBe(true);
  expect(hasPermission([expression!], "marketplace", "item1")).toBe(false);
  expect(hasPermission(["marketplace.publish:item1"], "marketplace.publish", "item2")).toBe(false);
});

it.each(["", ".publish", "marketplace/publish", "marketplace publish", "marketplace::publish", "a:b:c:d", "a".repeat(65)])(
  "rejects invalid permission key %s before writing",
  async (key) => {
    await expect(createPermission({ ...input, key })).rejects.toThrow();
    expect(mocks.values).not.toHaveBeenCalled();
  },
);

it("keeps dots invalid for role keys", async () => {
  await expect(createRole({ ...input, key: "marketplace.publisher" })).rejects.toThrow();
  expect(mocks.values).not.toHaveBeenCalled();
});
