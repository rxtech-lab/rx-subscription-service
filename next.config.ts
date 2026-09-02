import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Playwright runs beside a developer's existing `next dev` process. Keeping
  // its build output separate avoids contending for the default `.next` lock.
  distDir: process.env.IS_E2E === "true" ? ".next-e2e" : ".next",

  // The symbol catalog contains thousands of generated modules and is used
  // only by the Node route that serves search results and SVGs. Keeping it
  // external stops Turbopack from ever compiling the catalog into the app.
  serverExternalPackages: ["@bradleyhodges/sfsymbols"],

  outputFileTracingIncludes: {
    // The symbol route requires one generated module per drawn symbol, by
    // absolute path off `sf-symbol-index.json`. Nothing imports them
    // statically, so tracing cannot infer them and every symbol would 404
    // once deployed. The package manifest has to ship too: the directory is
    // located with `require.resolve`, which reads `main`/`exports` out of
    // `package.json` and throws MODULE_NOT_FOUND without it.
    "/api/sf-symbols": [
      "./node_modules/@bradleyhodges/sfsymbols/package.json",
      "./node_modules/@bradleyhodges/sfsymbols/dist/main/*.js",
    ],

    "/**": [
      // The test harness is read from disk at run time and shipped into a
      // sandbox, so nothing imports it and tracing cannot infer it. Without
      // this include the Test cases tab works locally and every deployed run
      // fails to start.
      "./lib/testing/harness/**",
      // Type-checking a saved suite needs the standard library, which the
      // compiler loads by path at run time — also invisible to tracing.
      "./node_modules/typescript/lib/lib.*.d.ts",
    ],
  },
};

// `withWorkflow` is what compiles the "use workflow" / "use step" directives in
// `lib/workflows`. Without it those files are ordinary async functions and the
// trial and expiry jobs silently lose their durability.
export default withWorkflow(nextConfig);
