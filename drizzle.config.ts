import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must be set before running drizzle-kit.");

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
