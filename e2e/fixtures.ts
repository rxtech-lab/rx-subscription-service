export const E2E_BASE_URL = "http://127.0.0.1:3100";
export const E2E_STRIPE_URL = "http://127.0.0.1:3101";
export const E2E_DATABASE_URL = "file:/tmp/rx-subscription-playwright.db";
export const E2E_SECRET = "rx-subscription-playwright-only";
export const E2E_API_KEY =
  "rxs_e2e000000000000000000000000000000000000000000000000000000000000";
export const E2E_SANDBOX_API_KEY =
  "rxs_sandbox_e2e000000000000000000000000000000000000000000000000000000000000";

export const E2E_APPLICATION_ID = "e2e-app";
export const E2E_UNIT_ID = "e2e-points";
export const E2E_PLAN_ID = "e2e-pro-plan";
export const E2E_ROLE_ID = "e2e-pro-role";
export const E2E_ROLE_KEY = "pro";
export const E2E_PERMISSION_ID = "e2e-reports-permission";
export const E2E_PERMISSION_KEY = "read:reports";
export const E2E_USAGE_ITEM_ID = "e2e-api-calls";
/** Deliberately tiny, so a test can walk into the limit in one call. */
export const E2E_USAGE_DEFAULT_LIMIT = 1;
/** A second item that rolls over daily, for testing time-based resets. */
export const E2E_DAILY_ITEM_ID = "e2e-daily-calls";
export const E2E_DAILY_ITEM_NAME = "Daily calls";
export const E2E_PLAN_USER = "e2e-plan-user";
export const E2E_STANDALONE_USER = "e2e-standalone-user";
