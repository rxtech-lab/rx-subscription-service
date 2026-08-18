import { describe, expect, it } from "vitest";
import { writeToolSchemas } from "./tool-schemas";

const topup = {
  key: "points_1000",
  name: "1,000 points",
  unitId: "unit-points",
  amount: 1_000,
  priceAmountCents: 500,
};

describe("createTopup tool schema", () => {
  it("defaults to a standalone topup", () => {
    expect(writeToolSchemas.createTopup.parse(topup).eligibility).toEqual({
      type: "standalone",
    });
  });

  it("accepts plan- and role-linked topups", () => {
    expect(
      writeToolSchemas.createTopup.parse({
        ...topup,
        eligibility: { type: "plan", planId: "plan-pro" },
      }).eligibility,
    ).toEqual({ type: "plan", planId: "plan-pro" });
    expect(
      writeToolSchemas.createTopup.parse({
        ...topup,
        eligibility: { type: "role", roleId: "role-pro" },
      }).eligibility,
    ).toEqual({ type: "role", roleId: "role-pro" });
  });

  it("requires the selected plan or role id", () => {
    expect(
      writeToolSchemas.createTopup.safeParse({
        ...topup,
        eligibility: { type: "plan" },
      }).success,
    ).toBe(false);
    expect(
      writeToolSchemas.createTopup.safeParse({
        ...topup,
        eligibility: { type: "role" },
      }).success,
    ).toBe(false);
  });
});
