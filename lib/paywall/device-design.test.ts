import { describe, expect, it } from "vitest";
import {
  hasDeviceLayout,
  paywallRootForDevice,
  withPaywallDeviceRoot,
  withoutPaywallDeviceLayout,
} from "./device-design";
import { TEMPLATES } from "./templates";

describe("device-specific paywall designs", () => {
  it("uses the iPhone root as the default for every device", () => {
    const spec = TEMPLATES.classic.build();
    expect(paywallRootForDevice(spec, "mobile")).toBe(spec.root);
    expect(paywallRootForDevice(spec, "android")).toBe(spec.root);
    expect(paywallRootForDevice(spec, "ipad")).toBe(spec.root);
  });

  it("stores and removes an independent device root", () => {
    const spec = TEMPLATES.classic.build();
    const androidRoot = { ...spec.root, id: "android-root" };
    const customized = withPaywallDeviceRoot(spec, "android", androidRoot);

    expect(hasDeviceLayout(customized, "android")).toBe(true);
    expect(paywallRootForDevice(customized, "android")).toBe(androidRoot);
    expect(paywallRootForDevice(customized, "mobile")).toBe(spec.root);

    const reset = withoutPaywallDeviceLayout(customized, "android");
    expect(hasDeviceLayout(reset, "android")).toBe(false);
    expect(paywallRootForDevice(reset, "android")).toBe(spec.root);
  });
});
