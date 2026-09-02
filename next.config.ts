import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Playwright runs beside a developer's existing `next dev` process. Keeping
  // its build output separate avoids contending for the default `.next` lock.
  distDir: process.env.IS_E2E === "true" ? ".next-e2e" : ".next",

  // The symbol catalog contains thousands of generated modules and is used
  // only by the Node route that serves search results and SVGs. Loading it at
  // runtime avoids making Turbopack compile the entire catalog into the app.
  serverExternalPackages: ["@bradleyhodges/sfsymbols"],

  outputFileTracingIncludes: {
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
