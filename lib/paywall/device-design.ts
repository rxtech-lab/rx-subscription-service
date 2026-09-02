import type {
  PaywallDeviceLayoutId,
  PaywallNode,
  PaywallSpec,
} from "./schema";

export type PaywallDeviceId = "mobile" | PaywallDeviceLayoutId;
export const DEFAULT_PAYWALL_DEVICE_ID: PaywallDeviceId = "mobile";

export function deviceLayoutId(device: PaywallDeviceId): PaywallDeviceLayoutId | null {
  return device === "mobile" ? null : device;
}

export function paywallRootForDevice(
  spec: PaywallSpec,
  device: PaywallDeviceId,
): PaywallNode {
  const layoutId = deviceLayoutId(device);
  return (layoutId ? spec.deviceLayouts?.[layoutId] : undefined) ?? spec.root;
}

/** A view of the full document whose root is the design active for this device. */
export function paywallSpecForDevice(
  spec: PaywallSpec,
  device: PaywallDeviceId,
): PaywallSpec {
  const root = paywallRootForDevice(spec, device);
  return root === spec.root ? spec : { ...spec, root };
}

export function hasDeviceLayout(spec: PaywallSpec, device: PaywallDeviceId): boolean {
  const layoutId = deviceLayoutId(device);
  return layoutId ? Boolean(spec.deviceLayouts?.[layoutId]) : true;
}

/** Save a root into the active device. Editing a fallback creates an override. */
export function withPaywallDeviceRoot(
  spec: PaywallSpec,
  device: PaywallDeviceId,
  root: PaywallNode,
): PaywallSpec {
  const layoutId = deviceLayoutId(device);
  if (!layoutId) return { ...spec, root };
  return {
    ...spec,
    deviceLayouts: { ...spec.deviceLayouts, [layoutId]: root },
  };
}

export function withoutPaywallDeviceLayout(
  spec: PaywallSpec,
  device: PaywallDeviceId,
): PaywallSpec {
  const layoutId = deviceLayoutId(device);
  if (!layoutId || !spec.deviceLayouts?.[layoutId]) return spec;
  const deviceLayouts = { ...spec.deviceLayouts };
  delete deviceLayouts[layoutId];
  return {
    ...spec,
    deviceLayouts: Object.keys(deviceLayouts).length ? deviceLayouts : undefined,
  };
}
