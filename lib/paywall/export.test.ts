import { describe, expect, it } from "vitest";
import {
  applyProductFilter,
  buildPeriodOptions,
  labelProducts,
  pickHighlighted,
  resolvePaywall,
  resolveProductList,
  SAMPLE_PRODUCTS,
  type ResolvedProductList,
} from "./export";
import type { PaywallSpec } from "./schema";
import { TEMPLATES } from "./templates";

describe("labelProducts", () => {
  it("formats price and period and computes savings against the priciest per-month plan", () => {
    const labelled = labelProducts(SAMPLE_PRODUCTS);
    const monthly = labelled.find((p) => p.key === "monthly")!;
    const yearly = labelled.find((p) => p.key === "yearly")!;
    const lifetime = labelled.find((p) => p.key === "lifetime")!;
    expect(monthly.priceLabel).toBe("$9.99");
    expect(monthly.periodLabel).toBe("per month");
    expect(monthly.savingsLabel).toBeNull();
    expect(yearly.periodLabel).toBe("per year");
    expect(yearly.savingsLabel).toBe("Save 33%");
    expect(lifetime.periodLabel).toBe("one-time");
    expect(lifetime.savingsLabel).toBeNull();
  });
});

describe("applyProductFilter", () => {
  it("filters by plan group and billing interval", () => {
    expect(applyProductFilter(SAMPLE_PRODUCTS, { planGroup: "lifetime" }).map((p) => p.key)).toEqual(["lifetime"]);
    expect(
      applyProductFilter(SAMPLE_PRODUCTS, { billingIntervals: ["month", "year"] }).map((p) => p.key),
    ).toEqual(["monthly", "yearly"]);
    expect(applyProductFilter(SAMPLE_PRODUCTS, undefined)).toHaveLength(3);
  });
});

describe("pickHighlighted", () => {
  const labelled = labelProducts(SAMPLE_PRODUCTS);
  it("chooses by strategy", () => {
    expect(pickHighlighted(labelled, "first")).toBe("sample-monthly");
    expect(pickHighlighted(labelled, undefined)).toBe("sample-monthly");
    expect(pickHighlighted(labelled, "cheapest")).toBe("sample-monthly");
    expect(pickHighlighted(labelled, "longest")).toBe("sample-yearly");
    expect(pickHighlighted(labelled, "none")).toBeNull();
    expect(pickHighlighted([], "first")).toBeNull();
  });
});

describe("resolvePaywall", () => {
  it("fills every ProductList and leaves other nodes alone", () => {
    const spec: PaywallSpec = TEMPLATES.classic.build();
    const resolved = resolvePaywall(spec, SAMPLE_PRODUCTS);
    const lists: ResolvedProductList[] = [];
    const visit = (node: typeof resolved.root) => {
      if (node.type === "ProductList") lists.push(node as ResolvedProductList);
      node.children?.forEach(visit);
    };
    visit(resolved.root);
    expect(lists).toHaveLength(1);
    expect(lists[0].products.map((p) => p.key)).toEqual(["monthly", "yearly", "lifetime"]);
    expect(lists[0].highlightedProductId).toBe("sample-yearly");
    expect(lists[0].products[0]).toHaveProperty("priceLabel");
    // The template itself is untouched.
    expect(JSON.stringify(spec)).toBe(JSON.stringify(TEMPLATES.classic.build()));
    expect(resolved.theme).toEqual(spec.theme);
  });

  it("respects a list's own filter", () => {
    const spec: PaywallSpec = {
      version: 1,
      theme: TEMPLATES.blank.build().theme,
      root: {
        id: "root",
        type: "VStack",
        props: {},
        children: [
          { id: "p", type: "ProductList", props: { filter: { planGroup: "lifetime" }, highlight: "first" } },
        ],
      },
    };
    const resolved = resolvePaywall(spec, SAMPLE_PRODUCTS);
    const list = resolved.root.children![0] as ResolvedProductList;
    expect(list.products.map((p) => p.key)).toEqual(["lifetime"]);
    expect(list.highlightedProductId).toBe("sample-lifetime");
  });

  it("resolves product lists in every device design and keeps Material You settings", () => {
    const base = TEMPLATES.blank.build();
    const spec: PaywallSpec = {
      ...base,
      materialYou: { seedColor: "#0061A4" },
      deviceLayouts: {
        android: {
          id: "android-root",
          type: "VStack",
          props: {},
          children: [{ id: "android-products", type: "ProductList", props: {} }],
        },
      },
    };

    const resolved = resolvePaywall(spec, SAMPLE_PRODUCTS);
    const androidList = resolved.deviceLayouts?.android?.children?.[0] as ResolvedProductList;
    expect(androidList.products).toHaveLength(SAMPLE_PRODUCTS.length);
    expect(resolved.materialYou).toEqual({ seedColor: "#0061A4" });
  });
});

describe("resolveProductList", () => {
  it("applies overrides, sorting, and the highlight badge", async () => {
    const { resolveProductList } = await import("./export");
    const labelled = labelProducts(SAMPLE_PRODUCTS);
    const { products, highlightedProductId } = resolveProductList(labelled, {
      sort: "priceDescending",
      highlight: "cheapest",
      highlightBadge: "Most popular",
      overrides: [
        { productKey: "lifetime", hidden: true },
        { productKey: "yearly", name: "Annual", badge: "Best value", description: "" },
      ],
    });
    expect(products.map((p) => p.key)).toEqual(["yearly", "monthly"]);
    expect(products[0].name).toBe("Annual");
    expect(products[0].badge).toBe("Best value");
    expect(products[0].description).toBe("");
    expect(highlightedProductId).toBe("sample-monthly");
    expect(products[1].badge).toBe("Most popular");
    // An override badge wins over the highlight badge.
    const alt = resolveProductList(labelled, {
      highlight: "first",
      highlightBadge: "Popular",
      overrides: [{ productKey: "monthly", badge: "Starter" }],
    });
    expect(alt.products[0].badge).toBe("Starter");
  });
});

describe("buildPeriodOptions", () => {
  const labelled = labelProducts(SAMPLE_PRODUCTS);

  it("offers the periods the plans actually use, in interval order", () => {
    const options = buildPeriodOptions(labelled, {}, "first");
    expect(options.map((option) => option.key)).toEqual(["month", "year", "one_time"]);
    expect(options.map((option) => option.label)).toEqual(["Monthly", "Yearly", "One-time"]);
    expect(options[0].productIds).toEqual(["sample-monthly"]);
    expect(options.filter((option) => option.selected)).toHaveLength(1);
    expect(options[0].selected).toBe(true);
  });

  it("narrows to the named intervals and drops the ones with no plans", () => {
    const options = buildPeriodOptions(labelled, { intervals: ["month", "quarter", "year"] }, "first");
    expect(options.map((option) => option.key)).toEqual(["month", "year"]);
  });

  it("gives every period its own highlight", () => {
    const options = buildPeriodOptions(labelled, { intervals: ["month", "year"] }, "cheapest");
    expect(options[0].highlightedProductId).toBe("sample-monthly");
    expect(options[1].highlightedProductId).toBe("sample-yearly");
  });

  it("opens on the named period, and prepends an All option", () => {
    const options = buildPeriodOptions(labelled, { showAll: true, defaultInterval: "year" }, "first");
    expect(options.map((option) => option.key)).toEqual(["all", "month", "year", "one_time"]);
    expect(options[0].productIds).toHaveLength(3);
    expect(options.find((option) => option.selected)?.key).toBe("year");
  });

  it("stays away unless there is something to switch between", () => {
    expect(buildPeriodOptions(labelled, undefined, "first")).toEqual([]);
    expect(buildPeriodOptions(labelled, { intervals: ["month"] }, "first")).toEqual([]);
    const monthlyOnly = labelled.filter((product) => product.billingInterval === "month");
    expect(buildPeriodOptions(monthlyOnly, {}, "first")).toEqual([]);
  });
});

describe("resolveProductList with a period filter", () => {
  const labelled = labelProducts(SAMPLE_PRODUCTS);

  it("preselects the opening period's product and badges each period's highlight", () => {
    const resolved = resolveProductList(labelled, {
      periodFilter: { intervals: ["month", "year"], defaultInterval: "year" },
      highlight: "cheapest",
      highlightBadge: "Most popular",
    });
    expect(resolved.highlightedProductId).toBe("sample-yearly");
    // Every card the switcher can land on keeps its badge, so switching to
    // another period does not reveal an unbadged "most popular" plan.
    const badged = resolved.products.filter((product) => product.badge === "Most popular");
    expect(badged.map((product) => product.id)).toEqual(["sample-monthly", "sample-yearly"]);
    expect(resolved.products).toHaveLength(3);
  });

  it("leaves the list untouched when there is no period filter", () => {
    const resolved = resolveProductList(labelled, { highlight: "first" });
    expect(resolved.periodOptions).toEqual([]);
    expect(resolved.highlightedProductId).toBe("sample-monthly");
  });

  it("only offers periods that survived the list's own filter", () => {
    const resolved = resolveProductList(labelled, {
      filter: { billingIntervals: ["month", "year"] },
      periodFilter: {},
    });
    expect(resolved.periodOptions.map((option) => option.key)).toEqual(["month", "year"]);
  });
});
