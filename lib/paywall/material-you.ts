import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
} from "@material/material-color-utilities";
import type { PaywallTheme } from "./schema";

export const DEFAULT_MATERIAL_SEED_COLOR = "#6750A4";

export const MATERIAL_PALETTE_OPTIONS = [
  { id: "violet", label: "Violet", seedColor: DEFAULT_MATERIAL_SEED_COLOR },
  { id: "blue", label: "Blue", seedColor: "#0061A4" },
  { id: "teal", label: "Teal", seedColor: "#006A6A" },
  { id: "green", label: "Green", seedColor: "#386A20" },
  { id: "coral", label: "Coral", seedColor: "#9C4146" },
  { id: "amber", label: "Amber", seedColor: "#825500" },
] as const;

export interface MaterialYouColors {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  surface: string;
  onSurface: string;
  onSurfaceVariant: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  outline: string;
  outlineVariant: string;
}

function hex(argb: number): string {
  return hexFromArgb(argb).toUpperCase();
}

/** Generate Material 3 color roles from one user-selected seed. */
export function materialYouColors(
  seedColor: string | undefined,
  scheme: "light" | "dark",
): MaterialYouColors {
  const source = /^#[0-9a-fA-F]{6}$/.test(seedColor ?? "")
    ? seedColor!
    : DEFAULT_MATERIAL_SEED_COLOR;
  const generated = themeFromSourceColor(argbFromHex(source));
  const roles = generated.schemes[scheme];
  const dark = scheme === "dark";

  return {
    primary: hex(roles.primary),
    onPrimary: hex(roles.onPrimary),
    primaryContainer: hex(roles.primaryContainer),
    onPrimaryContainer: hex(roles.onPrimaryContainer),
    secondary: hex(roles.secondary),
    onSecondary: hex(roles.onSecondary),
    secondaryContainer: hex(roles.secondaryContainer),
    onSecondaryContainer: hex(roles.onSecondaryContainer),
    tertiary: hex(roles.tertiary),
    onTertiary: hex(roles.onTertiary),
    tertiaryContainer: hex(roles.tertiaryContainer),
    onTertiaryContainer: hex(roles.onTertiaryContainer),
    error: hex(roles.error),
    surface: hex(roles.surface),
    onSurface: hex(roles.onSurface),
    onSurfaceVariant: hex(roles.onSurfaceVariant),
    surfaceContainer: hex(generated.palettes.neutral.tone(dark ? 12 : 94)),
    surfaceContainerHigh: hex(generated.palettes.neutral.tone(dark ? 17 : 92)),
    outline: hex(roles.outline),
    outlineVariant: hex(roles.outlineVariant),
  };
}

/** Map Material roles onto the document tokens used by every paywall node. */
export function materialPaywallTheme(
  base: PaywallTheme,
  colors: MaterialYouColors,
): PaywallTheme {
  return {
    ...base,
    colors: {
      primary: colors.primary,
      background: colors.surface,
      foreground: colors.onSurface,
      muted: colors.onSurfaceVariant,
      accent: colors.tertiary,
    },
    cornerRadius: 24,
    fontDesign: "default",
  };
}
