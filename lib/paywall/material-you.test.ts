import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATERIAL_SEED_COLOR,
  materialPaywallTheme,
  materialYouColors,
} from "./material-you";
import { defaultTheme } from "./templates";

describe("Material You colors", () => {
  it("derives complete light and dark roles from a seed", () => {
    const light = materialYouColors("#0061A4", "light");
    const dark = materialYouColors("#0061A4", "dark");

    expect(light.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(light.primary).not.toBe(dark.primary);
    expect(light.surface).not.toBe(dark.surface);
    expect(light.onPrimary).not.toBe(light.primary);
  });

  it("falls back to the default seed and maps roles to paywall tokens", () => {
    expect(materialYouColors("invalid", "light")).toEqual(
      materialYouColors(DEFAULT_MATERIAL_SEED_COLOR, "light"),
    );
    const generated = materialYouColors(DEFAULT_MATERIAL_SEED_COLOR, "light");
    const theme = materialPaywallTheme(defaultTheme(), generated);
    expect(theme.colors.primary).toBe(generated.primary);
    expect(theme.colors.background).toBe(generated.surface);
    expect(theme.cornerRadius).toBe(24);
  });
});
