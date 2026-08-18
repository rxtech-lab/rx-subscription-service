import { describe, expect, it } from "vitest";
import { confirmationInputSchema } from "./confirmation";

describe("confirmationInputSchema", () => {
  it("accepts only a title and description", () => {
    expect(
      confirmationInputSchema.safeParse({
        title: "Create points top-up",
        description: "Create a points unit before creating the top-up.",
      }).success,
    ).toBe(true);
  });

  it("rejects action details", () => {
    expect(
      confirmationInputSchema.safeParse({
        title: "Create points top-up",
        description: "Create a points unit before creating the top-up.",
        actions: ["createBalanceUnit", "createTopup"],
      }).success,
    ).toBe(false);
  });
});
