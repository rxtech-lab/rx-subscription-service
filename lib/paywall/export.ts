import { formatInterval, formatMoney } from "@/lib/utils";
import type { PaywallNode, PaywallSpec } from "./schema";

/**
 * Turn a template into the document an app renders.
 *
 * A template says "the products go here"; an application has actual plans. The
 * export copies the tree and fills every `ProductList` with that application's
 * plans — filtered, labelled, and with the highlighted one picked out — so the
 * mobile renderer receives plain data and never has to compute a price string.
 */

export interface PurchaseOption {
  provider: string;
  flow: string;
  productId?: string;
  productType?: string;
}

/** The plan payload of `GET /api/v1/catalog`, plus display strings. */
export interface ResolvedProduct {
  id: string;
  key: string;
  name: string;
  description: string | null;
  planGroup: string;
  billingInterval: string;
  intervalCount: number;
  priceAmountCents: number;
  currency: string;
  trialDays: number;
  purchaseOptions: PurchaseOption[];
  /** "$19.00" */
  priceLabel: string;
  /** "per month", "every 3 months", "one-time" */
  periodLabel: string;
  /** "Save 20%" against the priciest recurring plan per month, when cheaper. */
  savingsLabel: string | null;
  /** A label from a per-plan override, or the list's highlight badge. */
  badge: string | null;
}

export type CatalogProduct = Omit<
  ResolvedProduct,
  "priceLabel" | "periodLabel" | "savingsLabel" | "badge"
>;

export interface ResolvedProductList extends PaywallNode {
  type: "ProductList";
  products: ResolvedProduct[];
  highlightedProductId: string | null;
}

export interface ResolvedPaywall {
  version: 1;
  theme: PaywallSpec["theme"];
  root: PaywallNode;
  deviceLayouts?: PaywallSpec["deviceLayouts"];
  materialYou?: PaywallSpec["materialYou"];
}

interface ProductFilter {
  planGroup?: string;
  billingIntervals?: string[];
}

export interface ProductOverride {
  productKey: string;
  name?: string;
  description?: string;
  badge?: string;
  hidden?: boolean;
}

/** The ProductList props the resolver reads; the rest are presentation. */
export interface ProductListOptions {
  filter?: ProductFilter;
  sort?: "default" | "priceAscending" | "priceDescending";
  highlight?: string;
  highlightBadge?: string;
  overrides?: ProductOverride[];
}

const MONTHS: Record<string, number> = { month: 1, quarter: 3, year: 12 };

/** Months a plan covers; null for one-time purchases. */
export function planMonths(product: Pick<CatalogProduct, "billingInterval" | "intervalCount">): number | null {
  const unit = MONTHS[product.billingInterval];
  return unit ? unit * product.intervalCount : null;
}

export function labelProducts(products: CatalogProduct[]): ResolvedProduct[] {
  // The baseline for savings is the most expensive per-month recurring price
  // in the same currency, so a yearly plan shows what it saves against monthly.
  const perMonthBaseline = new Map<string, number>();
  for (const product of products) {
    const months = planMonths(product);
    if (!months) continue;
    const perMonth = product.priceAmountCents / months;
    const current = perMonthBaseline.get(product.currency) ?? 0;
    if (perMonth > current) perMonthBaseline.set(product.currency, perMonth);
  }

  return products.map((product) => {
    const months = planMonths(product);
    const baseline = perMonthBaseline.get(product.currency);
    let savingsLabel: string | null = null;
    if (months && baseline) {
      const perMonth = product.priceAmountCents / months;
      const saved = Math.round((1 - perMonth / baseline) * 100);
      if (saved >= 5) savingsLabel = `Save ${saved}%`;
    }
    return {
      ...product,
      priceLabel: formatMoney(product.priceAmountCents, product.currency),
      periodLabel: formatInterval(product.billingInterval, product.intervalCount),
      savingsLabel,
      badge: null,
    };
  });
}

/** Apply per-plan overrides: hide, rename, re-describe, or badge a product. */
export function applyOverrides(
  products: ResolvedProduct[],
  overrides: ProductOverride[] | undefined,
): ResolvedProduct[] {
  if (!overrides?.length) return products;
  const byKey = new Map(overrides.map((override) => [override.productKey, override]));
  const result: ResolvedProduct[] = [];
  for (const product of products) {
    const override = byKey.get(product.key);
    if (!override) {
      result.push(product);
      continue;
    }
    if (override.hidden) continue;
    result.push({
      ...product,
      name: override.name?.trim() || product.name,
      description: override.description !== undefined ? override.description : product.description,
      badge: override.badge?.trim() || product.badge,
    });
  }
  return result;
}

export function sortProducts(
  products: ResolvedProduct[],
  sort: ProductListOptions["sort"],
): ResolvedProduct[] {
  if (sort === "priceAscending") {
    return [...products].sort((a, b) => a.priceAmountCents - b.priceAmountCents);
  }
  if (sort === "priceDescending") {
    return [...products].sort((a, b) => b.priceAmountCents - a.priceAmountCents);
  }
  return products;
}

/** Everything a ProductList needs, computed from the labelled catalog. */
export function resolveProductList(
  labelled: ResolvedProduct[],
  options: ProductListOptions,
): { products: ResolvedProduct[]; highlightedProductId: string | null } {
  const filtered = applyProductFilter(labelled, options.filter);
  const sorted = sortProducts(applyOverrides(filtered, options.overrides), options.sort);
  const highlightedProductId = pickHighlighted(sorted, options.highlight);
  const badgeText = options.highlightBadge?.trim();
  const products = badgeText
    ? sorted.map((product) =>
        product.id === highlightedProductId && !product.badge
          ? { ...product, badge: badgeText }
          : product,
      )
    : sorted;
  return { products, highlightedProductId };
}

export function applyProductFilter<T extends CatalogProduct>(
  products: T[],
  filter: ProductFilter | undefined,
): T[] {
  if (!filter) return products;
  return products.filter((product) => {
    if (filter.planGroup && product.planGroup !== filter.planGroup) return false;
    if (filter.billingIntervals?.length && !filter.billingIntervals.includes(product.billingInterval)) {
      return false;
    }
    return true;
  });
}

export function pickHighlighted(
  products: ResolvedProduct[],
  highlight: string | undefined,
): string | null {
  if (products.length === 0 || highlight === "none") return null;
  if (highlight === "cheapest") {
    return [...products].sort((a, b) => a.priceAmountCents - b.priceAmountCents)[0].id;
  }
  if (highlight === "longest") {
    const recurring = products.filter((product) => planMonths(product) !== null);
    if (recurring.length === 0) return products[0].id;
    return [...recurring].sort(
      (a, b) => (planMonths(b) ?? 0) - (planMonths(a) ?? 0),
    )[0].id;
  }
  // "first" and the default
  return products[0].id;
}

/**
 * Fill every ProductList in the tree with the products it should show. The
 * template itself is not modified.
 */
export function resolvePaywall(spec: PaywallSpec, products: CatalogProduct[]): ResolvedPaywall {
  const labelled = labelProducts(products);
  const visit = (node: PaywallNode): PaywallNode => {
    if (node.type === "ProductList") {
      const resolved: ResolvedProductList = {
        ...node,
        type: "ProductList",
        ...resolveProductList(labelled, node.props as ProductListOptions),
      };
      return resolved;
    }
    if (!node.children) return { ...node };
    return { ...node, children: node.children.map(visit) };
  };
  const deviceLayouts = spec.deviceLayouts
    ? Object.fromEntries(
        Object.entries(spec.deviceLayouts).map(([device, root]) => [device, visit(root)]),
      ) as PaywallSpec["deviceLayouts"]
    : undefined;
  return {
    version: 1,
    theme: spec.theme,
    root: visit(spec.root),
    deviceLayouts,
    materialYou: spec.materialYou,
  };
}

/** Stand-in products for the editor before an application is chosen. */
export const SAMPLE_PRODUCTS: CatalogProduct[] = [
  {
    id: "sample-monthly",
    key: "monthly",
    name: "Monthly",
    description: "Billed every month.",
    planGroup: "default",
    billingInterval: "month",
    intervalCount: 1,
    priceAmountCents: 999,
    currency: "usd",
    trialDays: 7,
    purchaseOptions: [{ provider: "stripe", flow: "checkout" }],
  },
  {
    id: "sample-yearly",
    key: "yearly",
    name: "Yearly",
    description: "Two months free.",
    planGroup: "default",
    billingInterval: "year",
    intervalCount: 1,
    priceAmountCents: 7999,
    currency: "usd",
    trialDays: 7,
    purchaseOptions: [{ provider: "stripe", flow: "checkout" }],
  },
  {
    id: "sample-lifetime",
    key: "lifetime",
    name: "Lifetime",
    description: "Pay once, keep forever.",
    planGroup: "lifetime",
    billingInterval: "one_time",
    intervalCount: 1,
    priceAmountCents: 19_900,
    currency: "usd",
    trialDays: 0,
    purchaseOptions: [{ provider: "stripe", flow: "checkout" }],
  },
];
