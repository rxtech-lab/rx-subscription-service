import { describe, expect, it } from "vitest";
import { Status, Type } from "@apple/app-store-server-library";
import {
  appleCancelAtPeriodEnd,
  assertAppleEnvironment,
  assertAppleTransaction,
  mapAppleSubscriptionStatus,
} from "./validation";

const transaction = {
  transactionId: "2000000000000001",
  originalTransactionId: "2000000000000000",
  bundleId: "com.rxlab.rxargo",
  productId: "com.rxlab.rxargo.pro",
  type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
  appAccountToken: "11111111-1111-4111-8111-111111111111",
  environment: "Sandbox",
  purchaseDate: Date.now() - 1_000,
  expiresDate: Date.now() + 60_000,
  signedDate: Date.now(),
};

describe("Apple transaction validation", () => {
  it("accepts a fully matching StoreKit transaction", () => {
    expect(() =>
      assertAppleTransaction({
        transaction,
        bundleId: transaction.bundleId,
        environment: "sandbox",
        productId: transaction.productId,
        productType: "auto_renewable_subscription",
        accountToken: transaction.appAccountToken,
      }),
    ).not.toThrow();
  });

  it.each([
    ["bundle", { bundleId: "com.example.wrong" }],
    ["environment", { environment: "Production" }],
    ["product", { productId: "com.example.wrong" }],
    ["type", { type: Type.CONSUMABLE }],
    ["account", { appAccountToken: "22222222-2222-4222-8222-222222222222" }],
  ])("rejects a mismatched %s", (_label, change) => {
    expect(() =>
      assertAppleTransaction({
        transaction: { ...transaction, ...change },
        bundleId: transaction.bundleId,
        environment: "sandbox",
        productId: transaction.productId,
        productType: "auto_renewable_subscription",
        accountToken: transaction.appAccountToken,
      }),
    ).toThrow();
  });

  it("rejects malformed identifiers, dates, and quantities", () => {
    for (const malformed of [
      { ...transaction, transactionId: undefined },
      { ...transaction, signedDate: undefined },
      { ...transaction, quantity: 0 },
    ]) {
      expect(() =>
        assertAppleTransaction({
          transaction: malformed,
          bundleId: transaction.bundleId,
          environment: "sandbox",
          productId: transaction.productId,
          productType: "auto_renewable_subscription",
          accountToken: transaction.appAccountToken,
        }),
      ).toThrow();
    }
  });

  it("keeps Xcode, sandbox, and production isolated", () => {
    expect(() => assertAppleEnvironment("Xcode", "xcode")).not.toThrow();
    expect(() => assertAppleEnvironment("Sandbox", "sandbox")).not.toThrow();
    expect(() => assertAppleEnvironment("Sandbox", "xcode")).toThrow(
      /environment mismatch/i,
    );
    expect(() => assertAppleEnvironment("Production", "sandbox")).toThrow(
      /environment mismatch/i,
    );
  });
});

describe("Apple subscription state mapping", () => {
  it.each([
    [Status.ACTIVE, "active"],
    [Status.BILLING_GRACE_PERIOD, "active"],
    [Status.BILLING_RETRY, "past_due"],
    [Status.EXPIRED, "expired"],
    [Status.REVOKED, "canceled"],
  ] as const)("maps Apple status %s", (status, expected) => {
    expect(mapAppleSubscriptionStatus({ status, transaction })).toBe(expected);
  });

  it("treats a zero-price introductory period as trialing", () => {
    expect(
      mapAppleSubscriptionStatus({
        status: Status.ACTIVE,
        transaction: { ...transaction, offerType: 1, price: 0 },
      }),
    ).toBe("trialing");
  });

  it("uses renewal status for cancel-at-period-end", () => {
    expect(appleCancelAtPeriodEnd({ autoRenewStatus: 0 })).toBe(true);
    expect(appleCancelAtPeriodEnd({ autoRenewStatus: 1 })).toBe(false);
  });
});
