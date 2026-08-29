import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // Route handlers the Workflow build writes into the app directory. They are
    // generated on every build and already git-ignored, so linting them only
    // reports on code nobody here can edit.
    "app/.well-known/workflow/**",
  ]),
]);

export default eslintConfig;
