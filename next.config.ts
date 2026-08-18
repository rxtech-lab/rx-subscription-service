import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright runs beside a developer's existing `next dev` process. Keeping
  // its build output separate avoids contending for the default `.next` lock.
  distDir: process.env.IS_E2E === "true" ? ".next-e2e" : ".next",
};

export default nextConfig;
