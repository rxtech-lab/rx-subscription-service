import "server-only";
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import type { ApiEnvironment, AppleStoreIntegration } from "@/lib/db/schema";
import { ValidationError } from "@/lib/subscription/shared";

type AppleServerEnvironment = Exclude<ApiEnvironment, "xcode">;

const verifierCache = new Map<string, SignedDataVerifier>();
const clientCache = new Map<string, AppStoreServerAPIClient>();

function requiredSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ValidationError(`${name} is not configured`);
  return value;
}

function rootCertificates(): Buffer[] {
  const raw = requiredSecret("APPLE_IAP_ROOT_CERTIFICATES_BASE64");
  let values: string[];
  try {
    const parsed: unknown = JSON.parse(raw);
    values = Array.isArray(parsed) ? parsed.map(String) : [raw];
  } catch {
    values = raw.split(",");
  }
  const certificates = values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Buffer.from(value, "base64"));
  if (certificates.length === 0 || certificates.some((value) => value.length === 0)) {
    throw new ValidationError("APPLE_IAP_ROOT_CERTIFICATES_BASE64 is invalid");
  }
  return certificates;
}

export function appleEnvironment(environment: ApiEnvironment): Environment {
  switch (environment) {
    case "xcode":
      return Environment.XCODE;
    case "sandbox":
      return Environment.SANDBOX;
    case "production":
      return Environment.PRODUCTION;
  }
}

function verifier(
  integration: AppleStoreIntegration,
  environment: ApiEnvironment,
): SignedDataVerifier {
  const key = `${integration.id}:${environment}`;
  const cached = verifierCache.get(key);
  if (cached) return cached;
  const xcode = environment === "xcode";
  const created = new SignedDataVerifier(
    xcode ? [] : rootCertificates(),
    !xcode,
    appleEnvironment(environment),
    integration.bundleId,
    environment === "production" ? integration.appAppleId : undefined,
  );
  verifierCache.set(key, created);
  return created;
}

export function appleApiClient(
  integration: AppleStoreIntegration,
  environment: ApiEnvironment,
): AppStoreServerAPIClient {
  if (environment === "xcode") {
    throw new ValidationError(
      "The App Store Server API is unavailable for Xcode StoreKit testing",
    );
  }
  const key = `${integration.id}:${environment}`;
  const cached = clientCache.get(key);
  if (cached) return cached;
  const privateKey = Buffer.from(
    requiredSecret("APPLE_IAP_PRIVATE_KEY_BASE64"),
    "base64",
  ).toString("utf8");
  if (!privateKey.includes("PRIVATE KEY")) {
    throw new ValidationError("APPLE_IAP_PRIVATE_KEY_BASE64 is invalid");
  }
  const created = new AppStoreServerAPIClient(
    privateKey,
    requiredSecret("APPLE_IAP_KEY_ID"),
    requiredSecret("APPLE_IAP_ISSUER_ID"),
    integration.bundleId,
    appleEnvironment(environment),
  );
  clientCache.set(key, created);
  return created;
}

function decodeE2E<T>(signedData: string): T | null {
  if (process.env.IS_E2E !== "true" || !signedData.startsWith("e2e.")) return null;
  try {
    return JSON.parse(Buffer.from(signedData.slice(4), "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Malformed E2E Apple payload");
  }
}

export async function verifyAppleTransaction(
  integration: AppleStoreIntegration,
  environment: ApiEnvironment,
  signedTransaction: string,
): Promise<JWSTransactionDecodedPayload> {
  return (
    decodeE2E<JWSTransactionDecodedPayload>(signedTransaction) ??
    (await verifier(integration, environment).verifyAndDecodeTransaction(
      signedTransaction,
    ))
  );
}

export async function verifyAppleRenewalInfo(
  integration: AppleStoreIntegration,
  environment: ApiEnvironment,
  signedRenewalInfo: string,
): Promise<JWSRenewalInfoDecodedPayload> {
  return (
    decodeE2E<JWSRenewalInfoDecodedPayload>(signedRenewalInfo) ??
    (await verifier(integration, environment).verifyAndDecodeRenewalInfo(
      signedRenewalInfo,
    ))
  );
}

/** Decode only enough to select sandbox vs production; the result is never trusted. */
export function unverifiedAppleEnvironment(
  signedPayload: string,
): AppleServerEnvironment {
  const e2e = decodeE2E<ResponseBodyV2DecodedPayload>(signedPayload);
  if (e2e) return notificationEnvironment(e2e.data?.environment);
  try {
    const payload = JSON.parse(
      Buffer.from(signedPayload.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as ResponseBodyV2DecodedPayload;
    return notificationEnvironment(payload.data?.environment);
  } catch {
    throw new ValidationError("Malformed App Store notification");
  }
}

function notificationEnvironment(
  environment: string | undefined,
): AppleServerEnvironment {
  if (environment === Environment.SANDBOX) return "sandbox";
  if (environment === Environment.PRODUCTION) return "production";
  throw new ValidationError("Xcode StoreKit testing does not send server notifications");
}

export async function verifyAppleNotification(
  integration: AppleStoreIntegration,
  signedPayload: string,
): Promise<{
  environment: AppleServerEnvironment;
  payload: ResponseBodyV2DecodedPayload;
}> {
  const environment = unverifiedAppleEnvironment(signedPayload);
  const payload =
    decodeE2E<ResponseBodyV2DecodedPayload>(signedPayload) ??
    (await verifier(integration, environment).verifyAndDecodeNotification(signedPayload));
  return { environment, payload };
}

/** Test-only adapter input. Production code can never opt into this path. */
export function encodeE2EApplePayload(value: unknown): string {
  if (process.env.IS_E2E !== "true") {
    throw new ValidationError("Fake Apple payloads are only available under IS_E2E");
  }
  return `e2e.${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}
