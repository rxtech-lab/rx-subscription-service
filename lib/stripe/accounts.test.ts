import { afterEach, describe, expect, it } from "vitest";
import {
  modeForUser,
  sandboxConfigured,
  stripeConfigured,
  stripeMode,
  stripePointerColumns,
  stripePointers,
} from "./accounts";

const LIVE = process.env.STRIPE_SECRET_KEY;
const SANDBOX = process.env.STRIPE_SANDBOX_SECRET_KEY;

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = LIVE;
  process.env.STRIPE_SANDBOX_SECRET_KEY = SANDBOX;
});

describe("stripe account routing", () => {
  it("routes test users to the sandbox and everyone else to live", () => {
    expect(modeForUser({ isTest: true })).toBe("sandbox");
    expect(modeForUser({ isTest: false })).toBe("live");
  });

  it("reports configuration per account", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    process.env.STRIPE_SANDBOX_SECRET_KEY = "";
    expect(stripeConfigured()).toBe(true);
    expect(sandboxConfigured()).toBe(false);

    process.env.STRIPE_SANDBOX_SECRET_KEY = "sk_test_abc";
    expect(sandboxConfigured()).toBe(true);
  });

  it("identifies each account's key mode separately", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    process.env.STRIPE_SANDBOX_SECRET_KEY = "sk_test_abc";
    expect(stripeMode()).toBe("live");
    expect(stripeMode("sandbox")).toBe("test");

    // A live key in the sandbox slot is the dangerous misconfiguration: the
    // Test tab surfaces it so a "test" checkout cannot quietly charge a card.
    process.env.STRIPE_SANDBOX_SECRET_KEY = "sk_live_oops";
    expect(stripeMode("sandbox")).toBe("live");
  });
});

/**
 * Reading or writing the wrong pair would bill a test user against the live
 * account — or hand a live Price id to the sandbox client, where it does not
 * exist. Both directions are pinned here.
 */
describe("stripe pointer columns", () => {
  const row = {
    stripeProductId: "prod_live",
    stripePriceId: "price_live",
    stripeSandboxProductId: "prod_sandbox",
    stripeSandboxPriceId: "price_sandbox",
  };

  it("reads the pair belonging to the mode", () => {
    expect(stripePointers(row, "live")).toEqual({
      productId: "prod_live",
      priceId: "price_live",
    });
    expect(stripePointers(row, "sandbox")).toEqual({
      productId: "prod_sandbox",
      priceId: "price_sandbox",
    });
  });

  it("reports a missing sandbox mirror independently of the live one", () => {
    const liveOnly = { ...row, stripeSandboxProductId: null, stripeSandboxPriceId: null };
    expect(stripePointers(liveOnly, "sandbox")).toEqual({
      productId: null,
      priceId: null,
    });
    expect(stripePointers(liveOnly, "live").priceId).toBe("price_live");
  });

  it("writes only the columns belonging to the mode", () => {
    expect(stripePointerColumns("sandbox", "prod_x", "price_x")).toEqual({
      stripeSandboxProductId: "prod_x",
      stripeSandboxPriceId: "price_x",
    });
    expect(stripePointerColumns("live", "prod_x", "price_x")).toEqual({
      stripeProductId: "prod_x",
      stripePriceId: "price_x",
    });
  });
});
