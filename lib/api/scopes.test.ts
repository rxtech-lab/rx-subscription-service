import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import {
  assertKeyKindAllows,
  keyKindAllows,
  PUBLISHABLE_KEY_OPERATIONS,
} from "./scopes";

/**
 * The operations that must stay behind a secret key. Spelled out rather than
 * derived, so adding one to `PUBLISHABLE_KEY_OPERATIONS` by accident fails
 * here instead of shipping.
 */
const VALUE_MOVING_OPERATIONS = [
  "balances.adjust",
  "usage.record",
  "balances.reserve",
  "balances.reservations.read",
  "balances.reservations.increase",
  "balances.reservations.settle",
  "balances.reservations.release",
];

describe("key scopes", () => {
  it("lets a secret key do anything, including operations nobody has written yet", () => {
    for (const operation of [...PUBLISHABLE_KEY_OPERATIONS, ...VALUE_MOVING_OPERATIONS]) {
      expect(keyKindAllows("secret", operation)).toBe(true);
    }
    expect(keyKindAllows("secret", "some.future.route")).toBe(true);
  });

  it("keeps every value-moving operation away from a publishable key", () => {
    for (const operation of VALUE_MOVING_OPERATIONS) {
      expect(keyKindAllows("publishable", operation)).toBe(false);
    }
  });

  it("closes unknown operations to publishable keys by default", () => {
    expect(keyKindAllows("publishable", "some.future.route")).toBe(false);
  });

  it("lets a publishable key read its user and start a purchase", () => {
    for (const operation of [
      "catalog.read",
      "entitlements.read",
      "checkout.create",
      "apple.transactions.submit",
    ]) {
      expect(keyKindAllows("publishable", operation)).toBe(true);
    }
  });

  it("raises a 403 that names the operation", () => {
    try {
      assertKeyKindAllows("publishable", "balances.adjust");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(403);
      expect(apiError.code).toBe("insufficient_key_scope");
      expect(apiError.details).toEqual({ operation: "balances.adjust" });
    }
  });

  it("passes silently when the operation is allowed", () => {
    expect(() => assertKeyKindAllows("publishable", "entitlements.read")).not.toThrow();
    expect(() => assertKeyKindAllows("secret", "balances.adjust")).not.toThrow();
  });
});
