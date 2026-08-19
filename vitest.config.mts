import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws on import outside a React Server Component, which
      // is exactly what it is for — it keeps modules like the suite
      // type-checker from dragging the TypeScript compiler into a client
      // bundle. Under vitest there is no bundle and no client, so it resolves
      // to the package's own no-op entry, by path because its exports map
      // offers that entry only under the `react-server` condition.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    exclude: ["e2e/**", "**/node_modules/**", "**/.git/**"],
  },
});
