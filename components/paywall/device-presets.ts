export const PAYWALL_DEVICE_PRESETS = [
  {
    id: "mobile",
    label: "iPhone",
    width: 390,
    height: 844,
    kind: "phone",
    platform: "apple",
    contentMaxWidth: 390,
  },
  {
    id: "android",
    label: "Android",
    width: 412,
    height: 915,
    kind: "phone",
    platform: "android",
    contentMaxWidth: 412,
  },
  {
    id: "foldable",
    label: "Foldable",
    width: 768,
    height: 968,
    kind: "foldable",
    platform: "android",
    contentMaxWidth: 680,
  },
  {
    id: "ipad",
    label: "iPad",
    width: 1024,
    height: 1366,
    kind: "tablet",
    platform: "apple",
    contentMaxWidth: 760,
  },
  {
    id: "macos",
    label: "macOS",
    width: 1440,
    height: 900,
    kind: "desktop",
    platform: "apple",
    contentMaxWidth: 920,
  },
] as const;

export type PaywallDevicePreset = (typeof PAYWALL_DEVICE_PRESETS)[number];
export type PaywallDevicePresetId = PaywallDevicePreset["id"];

export function paywallDevicePreset(id: PaywallDevicePresetId): PaywallDevicePreset {
  return PAYWALL_DEVICE_PRESETS.find((preset) => preset.id === id) ?? PAYWALL_DEVICE_PRESETS[0];
}

export function isMaterialDevice(id: PaywallDevicePresetId): boolean {
  return paywallDevicePreset(id).platform === "android";
}
