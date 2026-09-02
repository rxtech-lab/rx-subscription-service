import type { PaywallNode, PaywallSpec, PaywallTheme } from "./schema";

/**
 * Starter paywalls. Each `build()` returns a fresh tree so two paywalls made
 * from the same template never share node objects.
 */

export function defaultTheme(): PaywallTheme {
  return {
    colorScheme: "system",
    colors: {
      primary: "#2563EB",
      background: "#FFFFFF",
      foreground: "#0F172A",
      muted: "#64748B",
      accent: "#F59E0B",
    },
    cornerRadius: 14,
    fontDesign: "default",
  };
}

const LEGAL_ROW: PaywallNode = {
  id: "legal",
  type: "HStack",
  props: { spacing: 16, alignment: "center" },
  modifiers: { padding: { top: 8 } },
  children: [
    { id: "spacer-legal-a", type: "Spacer", props: {} },
    { id: "terms", type: "Link", props: { text: "Terms", url: "https://example.com/terms" } },
    { id: "privacy", type: "Link", props: { text: "Privacy", url: "https://example.com/privacy" } },
    { id: "spacer-legal-b", type: "Spacer", props: {} },
  ],
};

const RESTORE_BUTTON: PaywallNode = {
  id: "restore",
  type: "Button",
  props: {
    label: "Restore purchases",
    action: { type: "restorePurchases" },
    style: "plain",
    color: "muted",
  },
};

function page(children: PaywallNode[]): PaywallNode {
  return {
    id: "root",
    type: "ScrollView",
    props: { axis: "vertical", showsIndicators: false },
    children: [
      {
        id: "page",
        type: "VStack",
        props: { spacing: 20, alignment: "leading" },
        modifiers: { padding: { top: 24, leading: 20, bottom: 32, trailing: 20 } },
        children,
      },
    ],
  };
}

function blank(): PaywallSpec {
  return {
    version: 1,
    theme: defaultTheme(),
    root: page([
      { id: "title", type: "Text", props: { text: "Your headline", style: "title" } },
      { id: "products", type: "ProductList", props: { layout: "vertical", style: "card", highlight: "first" } },
      {
        id: "cta",
        type: "Button",
        props: { label: "Continue", action: { type: "purchase" }, style: "filled", fullWidth: true },
      },
    ]),
  };
}

function classic(): PaywallSpec {
  return {
    version: 1,
    theme: defaultTheme(),
    root: page([
      {
        id: "hero",
        type: "VStack",
        props: { spacing: 12, alignment: "center" },
        modifiers: { frame: { maxWidth: 10_000 } },
        children: [
          { id: "hero-icon", type: "Image", props: { systemName: "checkmark.seal.fill", width: 56, height: 56, tint: "accent" } },
          { id: "hero-title", type: "Text", props: { text: "Unlock everything", style: "largeTitle", alignment: "center" } },
          {
            id: "hero-subtitle",
            type: "Text",
            props: {
              text: "Get unlimited access to every feature, on all your devices.",
              style: "body",
              color: "muted",
              alignment: "center",
            },
          },
        ],
      },
      {
        id: "features",
        type: "VStack",
        props: { spacing: 12, alignment: "leading" },
        children: [
          { id: "f1", type: "FeatureRow", props: { icon: "infinity", title: "Unlimited projects", subtitle: "No caps, ever." } },
          { id: "f2", type: "FeatureRow", props: { icon: "cloud.fill", title: "Sync across devices" } },
          { id: "f3", type: "FeatureRow", props: { icon: "sparkles", title: "Early access to new features" } },
        ],
      },
      {
        id: "products",
        type: "ProductList",
        props: { layout: "vertical", style: "card", highlight: "longest", showTrialBadge: true, showSavings: true },
      },
      {
        id: "cta",
        type: "Button",
        props: { label: "Continue", action: { type: "purchase" }, style: "filled", fullWidth: true },
      },
      {
        id: "fine-print",
        type: "Text",
        props: {
          text: "Cancel anytime. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the period.",
          style: "caption",
          color: "muted",
          alignment: "center",
        },
      },
      RESTORE_BUTTON,
      LEGAL_ROW,
    ]),
  };
}

function features(): PaywallSpec {
  return {
    version: 1,
    theme: { ...defaultTheme(), colors: { ...defaultTheme().colors, primary: "#7C3AED", accent: "#EC4899" } },
    root: page([
      { id: "eyebrow", type: "Badge", props: { text: "PRO", color: "primary" } },
      { id: "title", type: "Text", props: { text: "Do more with Pro", style: "title" } },
      {
        id: "features",
        type: "List",
        props: { spacing: 4, showsSeparators: true },
        children: [
          { id: "f1", type: "FeatureRow", props: { icon: "bolt.fill", title: "Faster exports", subtitle: "Up to 10× quicker rendering." } },
          { id: "f2", type: "FeatureRow", props: { icon: "lock.open.fill", title: "All templates unlocked" } },
          { id: "f3", type: "FeatureRow", props: { icon: "person.2.fill", title: "Share with your team" } },
          { id: "f4", type: "FeatureRow", props: { icon: "heart.fill", title: "Support an independent developer" } },
        ],
      },
      { id: "spacer", type: "Spacer", props: { minLength: 8 } },
      {
        id: "products",
        type: "ProductList",
        props: { layout: "horizontal", style: "card", highlight: "cheapest", showSavings: true },
      },
      {
        id: "cta",
        type: "Button",
        props: { label: "Start free trial", action: { type: "purchase" }, style: "filled", fullWidth: true },
      },
      RESTORE_BUTTON,
      LEGAL_ROW,
    ]),
  };
}

function comparison(): PaywallSpec {
  return {
    version: 1,
    theme: {
      ...defaultTheme(),
      colorScheme: "dark",
      colors: {
        primary: "#22D3EE",
        background: "#0B1020",
        foreground: "#F8FAFC",
        muted: "#94A3B8",
        accent: "#F472B6",
      },
    },
    root: page([
      { id: "title", type: "Text", props: { text: "Choose your plan", style: "title", alignment: "center" } },
      {
        id: "grid",
        type: "Grid",
        props: { columns: 2, spacing: 12 },
        children: [
          {
            id: "tile-1",
            type: "VStack",
            props: { spacing: 6, alignment: "leading" },
            modifiers: { padding: 14, background: "#111A33", cornerRadius: 14 },
            children: [
              { id: "tile-1-icon", type: "Image", props: { systemName: "photo.on.rectangle", width: 24, height: 24, tint: "primary" } },
              { id: "tile-1-title", type: "Text", props: { text: "Unlimited storage", style: "headline" } },
            ],
          },
          {
            id: "tile-2",
            type: "VStack",
            props: { spacing: 6, alignment: "leading" },
            modifiers: { padding: 14, background: "#111A33", cornerRadius: 14 },
            children: [
              { id: "tile-2-icon", type: "Image", props: { systemName: "wand.and.sparkles", width: 24, height: 24, tint: "accent" } },
              { id: "tile-2-title", type: "Text", props: { text: "AI tools", style: "headline" } },
            ],
          },
          {
            id: "tile-3",
            type: "VStack",
            props: { spacing: 6, alignment: "leading" },
            modifiers: { padding: 14, background: "#111A33", cornerRadius: 14 },
            children: [
              { id: "tile-3-icon", type: "Image", props: { systemName: "xmark.octagon", width: 24, height: 24, tint: "primary" } },
              { id: "tile-3-title", type: "Text", props: { text: "No ads", style: "headline" } },
            ],
          },
          {
            id: "tile-4",
            type: "VStack",
            props: { spacing: 6, alignment: "leading" },
            modifiers: { padding: 14, background: "#111A33", cornerRadius: 14 },
            children: [
              { id: "tile-4-icon", type: "Image", props: { systemName: "headphones", width: 24, height: 24, tint: "accent" } },
              { id: "tile-4-title", type: "Text", props: { text: "Priority support", style: "headline" } },
            ],
          },
        ],
      },
      {
        id: "products",
        type: "ProductList",
        props: { layout: "vertical", style: "row", highlight: "longest", showSavings: true, showTrialBadge: true },
      },
      {
        id: "cta",
        type: "Button",
        props: { label: "Subscribe", action: { type: "purchase" }, style: "filled", fullWidth: true },
      },
      { id: "dismiss", type: "Button", props: { label: "Not now", action: { type: "dismiss" }, style: "plain", color: "muted" } },
      LEGAL_ROW,
    ]),
  };
}

export const TEMPLATES = {
  blank: { name: "Blank", description: "A headline, the products, and a button.", build: blank },
  classic: {
    name: "Classic",
    description: "Hero icon and headline, three benefits, product cards, and legal links.",
    build: classic,
  },
  features: {
    name: "Feature list",
    description: "A benefits checklist with side-by-side product cards and a trial button.",
    build: features,
  },
  comparison: {
    name: "Feature grid (dark)",
    description: "A dark theme with a two-column feature grid and compact product rows.",
    build: comparison,
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as string[]).includes(value);
}
