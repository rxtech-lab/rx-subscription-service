import { defineConfig } from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_DATABASE_URL,
  E2E_SANDBOX_WEBHOOK_SECRET,
  E2E_SECRET,
  E2E_STRIPE_URL,
} from "./e2e/fixtures";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: E2E_BASE_URL },
  webServer: [
    {
      command: "bun e2e/fake-stripe.ts",
      url: `${E2E_STRIPE_URL}/health`,
      reuseExistingServer: false,
    },
    {
      command:
        "bun e2e/prepare.ts && bun run dev -- --hostname 127.0.0.1 --port 3100",
      url: `${E2E_BASE_URL}/login`,
      reuseExistingServer: false,
      env: {
        TURSO_DATABASE_URL: E2E_DATABASE_URL,
        TURSO_AUTH_TOKEN: "",
        IS_E2E: "true",
        E2E_SECRET,
        // Pinned so a spec can mint the storefront session cookie itself.
        AUTH_SECRET: E2E_SECRET,
        E2E_STRIPE_API_BASE: E2E_STRIPE_URL,
        STRIPE_SECRET_KEY: "sk_test_playwright",
        STRIPE_WEBHOOK_SECRET: E2E_SANDBOX_WEBHOOK_SECRET,
        STRIPE_SANDBOX_SECRET_KEY: "sk_test_playwright_sandbox",
        STRIPE_SANDBOX_WEBHOOK_SECRET: E2E_SANDBOX_WEBHOOK_SECRET,
        NEXT_PUBLIC_SITE_URL: E2E_BASE_URL,
        APPLE_IAP_ISSUER_ID: "e2e-issuer",
        APPLE_IAP_KEY_ID: "e2e-key",
        APPLE_IAP_PRIVATE_KEY_BASE64: Buffer.from(
          "-----BEGIN PRIVATE KEY-----\ne2e\n-----END PRIVATE KEY-----",
        ).toString("base64"),
        APPLE_IAP_ROOT_CERTIFICATES_BASE64: Buffer.from("e2e-root").toString(
          "base64",
        ),
      },
    },
  ],
});
