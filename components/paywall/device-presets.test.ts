import { describe, expect, it } from "vitest";
import { PAYWALL_DEVICE_PRESETS, paywallDevicePreset } from "./device-presets";

describe("paywall device presets", () => {
  it("keeps the supported previews in their intended order", () => {
    expect(PAYWALL_DEVICE_PRESETS.map((preset) => preset.id)).toEqual([
      "mobile",
      "android",
      "foldable",
      "ipad",
      "macos",
    ]);
  });

  it("uses representative portrait and desktop viewport sizes", () => {
    expect(paywallDevicePreset("mobile")).toMatchObject({ width: 390, height: 844 });
    expect(paywallDevicePreset("android")).toMatchObject({
      width: 412,
      height: 915,
      platform: "android",
    });
    expect(paywallDevicePreset("foldable")).toMatchObject({ width: 768, height: 968 });
    expect(paywallDevicePreset("ipad")).toMatchObject({ width: 1024, height: 1366 });
    expect(paywallDevicePreset("macos")).toMatchObject({ width: 1440, height: 900 });
  });
});
