export const STORE_PROVIDER_VALUES = [
  "apple_app_store",
  "google_play",
] as const;
export type StoreProvider = (typeof STORE_PROVIDER_VALUES)[number];

export interface StorePurchaseOption {
  provider: "stripe" | StoreProvider;
  flow: "checkout" | "storekit" | "play_billing";
  productId?: string;
  productType?:
    | "auto_renewable_subscription"
    | "non_consumable"
    | "consumable";
}

/**
 * Provider adapters normalize store-specific payloads before fulfillment.
 * Google Play intentionally has no implementation yet, but can satisfy this
 * contract without changing the catalog or database representation.
 */
export interface StoreProviderAdapter<TTransaction, TNotification> {
  readonly provider: StoreProvider;
  verifyTransaction(input: {
    applicationId: string;
    environment: "sandbox" | "production";
    signedTransaction: string;
  }): Promise<TTransaction>;
  verifyNotification(input: {
    applicationId: string;
    signedPayload: string;
  }): Promise<TNotification>;
}
