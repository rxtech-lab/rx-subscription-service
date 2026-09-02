import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appleStoreIntegrations,
  plans,
  storeAccountLinks,
  storeProductMappings,
  storeProductPrices,
  storeTransactions,
  topupProducts,
  type AppUser,
  type StoreProductMapping,
  type StoreProductType,
} from "@/lib/db/schema";
import {
  newId,
  NotFoundError,
  recordAudit,
  ValidationError,
  type Actor,
} from "@/lib/subscription/shared";

const PRODUCT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/;

export function appleCredentialsConfigured(): boolean {
  return Boolean(
    process.env.APPLE_IAP_ISSUER_ID?.trim() &&
      process.env.APPLE_IAP_KEY_ID?.trim() &&
      process.env.APPLE_IAP_PRIVATE_KEY_BASE64?.trim() &&
      process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64?.trim(),
  );
}

export async function getAppleIntegration(applicationId: string) {
  const [row] = await db
    .select()
    .from(appleStoreIntegrations)
    .where(eq(appleStoreIntegrations.applicationId, applicationId))
    .limit(1);
  return row ?? null;
}

export async function requireAppleIntegration(applicationId: string) {
  const integration = await getAppleIntegration(applicationId);
  if (!integration || !integration.enabled) {
    throw new ValidationError("App Store integration is not enabled");
  }
  return integration;
}

export async function listEnabledAppleIntegrations() {
  return db
    .select()
    .from(appleStoreIntegrations)
    .where(eq(appleStoreIntegrations.enabled, true))
    .orderBy(asc(appleStoreIntegrations.applicationId));
}

export async function saveAppleIntegration(input: {
  applicationId: string;
  bundleId: string;
  appAppleId: number;
  enabled: boolean;
  actor: Actor;
}) {
  const bundleId = input.bundleId.trim();
  if (!BUNDLE_ID_PATTERN.test(bundleId)) {
    throw new ValidationError("bundleId must be a valid reverse-DNS identifier");
  }
  if (!Number.isSafeInteger(input.appAppleId) || input.appAppleId <= 0) {
    throw new ValidationError("appAppleId must be a positive integer");
  }
  if (input.enabled && !appleCredentialsConfigured()) {
    throw new ValidationError(
      "Configure the shared App Store credentials before enabling purchases",
    );
  }

  const before = await getAppleIntegration(input.applicationId);
  if (
    before &&
    (before.bundleId !== bundleId || before.appAppleId !== input.appAppleId)
  ) {
    const [transaction] = await db
      .select({ id: storeTransactions.id })
      .from(storeTransactions)
      .where(
        and(
          eq(storeTransactions.applicationId, input.applicationId),
          eq(storeTransactions.provider, "apple_app_store"),
        ),
      )
      .limit(1);
    if (transaction) {
      throw new ValidationError(
        "Bundle ID and Apple app ID cannot change after verified purchases exist",
      );
    }
  }
  const now = new Date();
  const [saved] = before
    ? await db
        .update(appleStoreIntegrations)
        .set({
          bundleId,
          appAppleId: input.appAppleId,
          enabled: input.enabled,
          updatedAt: now,
        })
        .where(eq(appleStoreIntegrations.id, before.id))
        .returning()
    : await db
        .insert(appleStoreIntegrations)
        .values({
          id: newId(),
          applicationId: input.applicationId,
          bundleId,
          appAppleId: input.appAppleId,
          enabled: input.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: before ? "apple_store.update" : "apple_store.create",
    entityType: "apple_store_integration",
    entityId: saved.id,
    before,
    after: saved,
  });
  return saved;
}

/**
 * A mapping plus its store price override, when one is set.
 * `priceAmountCents` is null whenever the store quotes the local plan or
 * top-up price. An alias rather than an interface because `recordAudit` takes
 * a `Record<string, unknown>`, which only aliases satisfy implicitly.
 */
export type StoreProductMappingWithPrice = StoreProductMapping & {
  priceAmountCents: number | null;
  currency: string | null;
};

const mappingWithPriceColumns = {
  id: storeProductMappings.id,
  applicationId: storeProductMappings.applicationId,
  provider: storeProductMappings.provider,
  productId: storeProductMappings.productId,
  productType: storeProductMappings.productType,
  planId: storeProductMappings.planId,
  topupProductId: storeProductMappings.topupProductId,
  createdAt: storeProductMappings.createdAt,
  updatedAt: storeProductMappings.updatedAt,
  priceAmountCents: storeProductPrices.priceAmountCents,
  currency: storeProductPrices.currency,
};

export async function listStoreProductMappings(
  applicationId: string,
): Promise<StoreProductMappingWithPrice[]> {
  return db
    .select(mappingWithPriceColumns)
    .from(storeProductMappings)
    .leftJoin(
      storeProductPrices,
      eq(storeProductPrices.storeProductMappingId, storeProductMappings.id),
    )
    .where(eq(storeProductMappings.applicationId, applicationId))
    .orderBy(asc(storeProductMappings.productId));
}

export async function getStoreProductMapping(input: {
  applicationId: string;
  provider: "apple_app_store" | "google_play";
  productId: string;
}): Promise<StoreProductMappingWithPrice | null> {
  const [mapping] = await db
    .select(mappingWithPriceColumns)
    .from(storeProductMappings)
    .leftJoin(
      storeProductPrices,
      eq(storeProductPrices.storeProductMappingId, storeProductMappings.id),
    )
    .where(
      and(
        eq(storeProductMappings.applicationId, input.applicationId),
        eq(storeProductMappings.provider, input.provider),
        eq(storeProductMappings.productId, input.productId),
      ),
    )
    .limit(1);
  return mapping ?? null;
}

function normalizeStorePrice(input: {
  priceAmountCents: number;
  currency: string;
}) {
  if (
    !Number.isSafeInteger(input.priceAmountCents) ||
    input.priceAmountCents < 0
  ) {
    throw new ValidationError(
      "Store price must be a non-negative whole number of cents",
    );
  }
  const currency = input.currency.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new ValidationError("Store currency must be a 3-letter ISO code");
  }
  return { priceAmountCents: input.priceAmountCents, currency };
}

/**
 * Set or clear one mapping's store price. A null amount removes the override,
 * so the store falls back to the local plan or top-up price.
 *
 * The number is catalog metadata: Apple and Google charge from their own price
 * tiers and the app renders StoreKit's localized string. What is stored here is
 * what the console, the catalog, and the paywall report for that platform.
 */
async function saveStoreProductPrice(input: {
  mappingId: string;
  priceAmountCents: number | null;
  currency: string;
}) {
  if (input.priceAmountCents === null) {
    await db
      .delete(storeProductPrices)
      .where(eq(storeProductPrices.storeProductMappingId, input.mappingId));
    return null;
  }
  const price = normalizeStorePrice({
    priceAmountCents: input.priceAmountCents,
    currency: input.currency,
  });
  const now = new Date();
  const [saved] = await db
    .insert(storeProductPrices)
    .values({
      id: newId(),
      storeProductMappingId: input.mappingId,
      priceAmountCents: price.priceAmountCents,
      currency: price.currency,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: storeProductPrices.storeProductMappingId,
      set: {
        priceAmountCents: price.priceAmountCents,
        currency: price.currency,
        updatedAt: now,
      },
    })
    .returning();
  return saved;
}

async function storeProductPrice(mappingId: string) {
  const [price] = await db
    .select()
    .from(storeProductPrices)
    .where(eq(storeProductPrices.storeProductMappingId, mappingId))
    .limit(1);
  return price ?? null;
}

export async function saveAppleProductMapping(input: {
  applicationId: string;
  productId: string;
  planId?: string | null;
  topupProductId?: string | null;
  /**
   * The App Store price of this item, when it differs from the local one.
   * `undefined` leaves any existing override alone; `null` removes it.
   */
  priceAmountCents?: number | null;
  /** Defaults to the plan or top-up currency. */
  currency?: string | null;
  actor: Actor;
}) {
  const productId = input.productId.trim();
  if (!PRODUCT_ID_PATTERN.test(productId)) {
    throw new ValidationError("App Store product id is invalid");
  }
  if (Boolean(input.planId) === Boolean(input.topupProductId)) {
    throw new ValidationError("Choose exactly one plan or top-up");
  }

  let productType: StoreProductType;
  let localCurrency: string;
  if (input.planId) {
    const [plan] = await db
      .select()
      .from(plans)
      .where(
        and(
          eq(plans.id, input.planId),
          eq(plans.applicationId, input.applicationId),
        ),
      )
      .limit(1);
    if (!plan) throw new NotFoundError("plan", input.planId);
    productType =
      plan.billingInterval === "one_time"
        ? "non_consumable"
        : "auto_renewable_subscription";
    localCurrency = plan.currency;
  } else {
    const [topup] = await db
      .select({ id: topupProducts.id, currency: topupProducts.currency })
      .from(topupProducts)
      .where(
        and(
          eq(topupProducts.id, input.topupProductId!),
          eq(topupProducts.applicationId, input.applicationId),
        ),
      )
      .limit(1);
    if (!topup) throw new NotFoundError("top-up", input.topupProductId!);
    productType = "consumable";
    localCurrency = topup.currency;
  }

  const targetCondition = input.planId
    ? eq(storeProductMappings.planId, input.planId)
    : eq(storeProductMappings.topupProductId, input.topupProductId!);
  const [before] = await db
    .select()
    .from(storeProductMappings)
    .where(
      and(
        eq(storeProductMappings.provider, "apple_app_store"),
        targetCondition,
      ),
    )
    .limit(1);
  if (before && before.productId !== productId) {
    const [transaction] = await db
      .select({ id: storeTransactions.id })
      .from(storeTransactions)
      .where(
        and(
          eq(storeTransactions.applicationId, input.applicationId),
          eq(storeTransactions.provider, "apple_app_store"),
          eq(storeTransactions.productId, before.productId),
        ),
      )
      .limit(1);
    if (transaction) {
      throw new ValidationError(
        "This App Store product ID has verified purchases and cannot be replaced",
      );
    }
  }

  const beforePrice = before ? await storeProductPrice(before.id) : null;
  const now = new Date();
  const [saved] = before
    ? await db
        .update(storeProductMappings)
        .set({ productId, productType, updatedAt: now })
        .where(eq(storeProductMappings.id, before.id))
        .returning()
    : await db
        .insert(storeProductMappings)
        .values({
          id: newId(),
          applicationId: input.applicationId,
          provider: "apple_app_store",
          productId,
          productType,
          planId: input.planId ?? null,
          topupProductId: input.topupProductId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

  const price =
    input.priceAmountCents === undefined
      ? beforePrice
      : await saveStoreProductPrice({
          mappingId: saved.id,
          priceAmountCents: input.priceAmountCents,
          currency:
            input.currency?.trim() || beforePrice?.currency || localCurrency,
        });

  const after: StoreProductMappingWithPrice = {
    ...saved,
    priceAmountCents: price?.priceAmountCents ?? null,
    currency: price?.currency ?? null,
  };
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: before ? "store_product.update" : "store_product.create",
    entityType: "store_product_mapping",
    entityId: saved.id,
    before: before
      ? {
          ...before,
          priceAmountCents: beforePrice?.priceAmountCents ?? null,
          currency: beforePrice?.currency ?? null,
        }
      : undefined,
    after,
  });
  return after;
}

export async function removeStoreProductMapping(input: {
  applicationId: string;
  mappingId: string;
  actor: Actor;
}) {
  const [before] = await db
    .select()
    .from(storeProductMappings)
    .where(
      and(
        eq(storeProductMappings.id, input.mappingId),
        eq(storeProductMappings.applicationId, input.applicationId),
      ),
    )
    .limit(1);
  if (!before) throw new NotFoundError("store product mapping", input.mappingId);
  const [transaction] = await db
    .select({ id: storeTransactions.id })
    .from(storeTransactions)
    .where(
      and(
        eq(storeTransactions.applicationId, input.applicationId),
        eq(storeTransactions.provider, before.provider),
        eq(storeTransactions.productId, before.productId),
      ),
    )
    .limit(1);
  if (transaction) {
    throw new ValidationError(
      "This store product has verified purchases and cannot be removed",
    );
  }
  // libsql does not enforce foreign keys by default, so the price row would
  // otherwise outlive the mapping it belongs to.
  await db
    .delete(storeProductPrices)
    .where(eq(storeProductPrices.storeProductMappingId, input.mappingId));
  await db
    .delete(storeProductMappings)
    .where(eq(storeProductMappings.id, input.mappingId));
  await recordAudit({
    applicationId: input.applicationId,
    actor: input.actor,
    action: "store_product.remove",
    entityType: "store_product_mapping",
    entityId: before.id,
    before,
  });
}

export async function getOrCreateStoreAccountLink(user: AppUser) {
  const [existing] = await db
    .select()
    .from(storeAccountLinks)
    .where(
      and(
        eq(storeAccountLinks.appUserId, user.id),
        eq(storeAccountLinks.provider, "apple_app_store"),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(storeAccountLinks)
    .values({
      id: newId(),
      applicationId: user.applicationId,
      appUserId: user.id,
      provider: "apple_app_store",
      providerAccountToken: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(storeAccountLinks)
    .where(
      and(
        eq(storeAccountLinks.appUserId, user.id),
        eq(storeAccountLinks.provider, "apple_app_store"),
      ),
    )
    .limit(1);
  if (!raced) throw new Error("STORE_ACCOUNT_LINK_NOT_CREATED");
  return raced;
}

export async function setAppleConsumptionConsent(input: {
  user: AppUser;
  consented: boolean;
}) {
  const link = await getOrCreateStoreAccountLink(input.user);
  const now = new Date();
  const [updated] = await db
    .update(storeAccountLinks)
    .set({
      consumptionDataConsent: input.consented,
      consentUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(storeAccountLinks.id, link.id))
    .returning();
  return updated;
}

export async function findAppleAccountByToken(token: string) {
  const [link] = await db
    .select()
    .from(storeAccountLinks)
    .where(
      and(
        eq(storeAccountLinks.provider, "apple_app_store"),
        eq(storeAccountLinks.providerAccountToken, token),
      ),
    )
    .limit(1);
  return link ?? null;
}
