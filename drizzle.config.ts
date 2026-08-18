import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit evaluates this file in its own bundled context, which does not
// inherit the env `bun run` loads from `.env.local`. Without this, every
// drizzle-kit command silently reads `process.env.TURSO_DATABASE_URL` as
// undefined. Load the files ourselves, nearest-wins, so `db:migrate` reaches
// the same database the app does.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  // Never fall back to a local file here. That fallback is what let a
  // production build report "migrations applied successfully" after writing
  // them to a throwaway `local.db` inside the build container, leaving the
  // real Turso database without a single table.
  throw new Error(
    "TURSO_DATABASE_URL is not set. Set it (and TURSO_AUTH_TOKEN for remote " +
      "databases) before running drizzle-kit; use TURSO_DATABASE_URL=file:local.db " +
      "for a local file database.",
  );
}

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "turso",
  // Turso keeps internal bookkeeping tables (`__turso_internal_mvcc_meta`) in
  // the same schema. drizzle-kit sees them as unknown tables and puts a
  // `DROP TABLE` at the head of every push batch, which the server rejects
  // ("Cannot drop system table"), failing the whole batch — so no push ever
  // lands. Hide them from introspection instead.
  tablesFilter: ["!__turso_internal_*"],
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
