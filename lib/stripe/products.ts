import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { plans, topupProducts, type Plan, type TopupProduct } from "@/lib/db/schema";
import { stripeRecurring } from "@/lib/subscription/plans";
import {
  idempotencyScope as scope,
  stripePointerColumns,
  stripePointers,
  stripeProductColumns,
  type StripeMode,
} from "./accounts";
import { stripe } from "./client";

/**
 * Mirror a plan into Stripe and return its Price id.
 *
 * Stripe Prices are immutable, so a price or currency change clears the stored
 * pointer (see `updatePlan`) and the next sync mints a new Price. Existing
 * subscriptions keep billing on the Price they were created with, which is what
 * makes an edit safe to perform on a live plan.
 */
export async function ensurePlanPrice(
  plan: Plan,
  mode: StripeMode = "live",
): Promise<string> {
  const pointers = stripePointers(plan, mode);
  if (pointers.priceId) return pointers.priceId;

  const productId = await ensurePlanProduct(plan, mode);
  const recurring = stripeRecurring(plan.billingInterval, plan.intervalCount);

  const price = await stripe(mode).prices.create(
    {
      product: productId,
      currency: plan.currency,
      unit_amount: plan.priceAmountCents,
      ...(recurring ? { recurring } : {}),
      metadata: { applicationId: plan.applicationId, planId: plan.id },
    },
    {
      idempotencyKey: `plan-price:${scope(mode)}${plan.id}:${plan.priceAmountCents}:${plan.currency}`,
    },
  );

  await db
    .update(plans)
    .set({ ...stripePointerColumns(mode, productId, price.id), updatedAt: new Date() })
    .where(eq(plans.id, plan.id));

  return price.id;
}

/**
 * The plan's Stripe Product, minted and stored on first need.
 *
 * Separate from the Price because a coupon needs the Product id — that is what
 * `applies_to` pins a discount to — without caring what anything costs.
 */
export async function ensurePlanProduct(
  plan: Plan,
  mode: StripeMode = "live",
): Promise<string> {
  const pointers = stripePointers(plan, mode);
  if (pointers.productId) return pointers.productId;

  const product = await stripe(mode).products.create(
    {
      name: plan.name,
      description: plan.description ?? undefined,
      metadata: {
        applicationId: plan.applicationId,
        planId: plan.id,
        planKey: plan.key,
      },
    },
    { idempotencyKey: `plan-product:${scope(mode)}${plan.id}` },
  );

  await db
    .update(plans)
    .set({ ...stripeProductColumns(mode, product.id), updatedAt: new Date() })
    .where(eq(plans.id, plan.id));
  return product.id;
}

/** The topup's Stripe Product. See `ensurePlanProduct`. */
export async function ensureTopupProduct(
  product: TopupProduct,
  mode: StripeMode = "live",
): Promise<string> {
  const pointers = stripePointers(product, mode);
  if (pointers.productId) return pointers.productId;

  const created = await stripe(mode).products.create(
    {
      name: product.name,
      description: product.description ?? undefined,
      metadata: {
        applicationId: product.applicationId,
        topupProductId: product.id,
        topupKey: product.key,
      },
    },
    { idempotencyKey: `topup-product:${scope(mode)}${product.id}` },
  );

  await db
    .update(topupProducts)
    .set({ ...stripeProductColumns(mode, created.id), updatedAt: new Date() })
    .where(eq(topupProducts.id, product.id));
  return created.id;
}

export async function ensureTopupPrice(
  product: TopupProduct,
  mode: StripeMode = "live",
): Promise<string> {
  const pointers = stripePointers(product, mode);
  if (pointers.priceId) return pointers.priceId;

  const productId = await ensureTopupProduct(product, mode);

  const price = await stripe(mode).prices.create(
    {
      product: productId,
      currency: product.currency,
      unit_amount: product.priceAmountCents,
      metadata: { applicationId: product.applicationId, topupProductId: product.id },
    },
    {
      idempotencyKey: `topup-price:${scope(mode)}${product.id}:${product.priceAmountCents}:${product.currency}`,
    },
  );

  await db
    .update(topupProducts)
    .set({ ...stripePointerColumns(mode, productId, price.id), updatedAt: new Date() })
    .where(eq(topupProducts.id, product.id));

  return price.id;
}
