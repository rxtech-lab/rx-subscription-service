import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// Bun loads .env and .env.local automatically; explicit environment variables win.

const url = process.env.DATABASE_URL;
let client: ReturnType<typeof postgres> | undefined;
try {
  if (!url) throw new Error("DATABASE_URL is required");
  const target = new URL(url);
  console.log(`Database target: ${target.hostname}${target.pathname}`);
  client = postgres(url, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
  const tables = await client<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `;
  const names = new Set(tables.map(row => row.tablename));
  const required = ["applications", "app_users", "subscriptions", "store_account_links"];
  const missing = required.filter(name => !names.has(name));
  console.log(`Public tables: ${tables.length}. RxSubscription markers: ${required.filter(name => names.has(name)).join(", ") || "none"}.`);
  if (tables.length > 0 && missing.length > 0) {
    throw new Error(`Database identity check failed: missing ${missing.join(", ")}. No migrations executed. Correct DATABASE_URL or inspect this partial schema before proceeding.`);
  }
  if (process.argv.includes("--check")) {
    console.log("Read-only database check passed. No migrations executed.");
  } else {
    console.log("Applying committed migrations...");
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied successfully.");
  }
} catch (error) {
  // Drizzle wraps the driver error with SQL and parameters. Report the nested
  // error directly, without dumping queries, connection options or credentials.
  let cause: unknown = error;
  const seen = new Set<unknown>();
  while (cause instanceof Error && cause.cause && !seen.has(cause)) {
    seen.add(cause);
    cause = cause.cause;
  }
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "ERROR";
  let message = cause instanceof Error ? cause.message : "Migration failed without an error message";
  message = message.replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[redacted URL]");
  if (url) {
    try {
      const password = decodeURIComponent(new URL(url).password);
      if (password) message = message.split(password).join("[redacted]");
    } catch { /* The original URL error is reported below. */ }
  }
  console.error(`Migration failed [${code}]: ${message.slice(0, 1500)}`);
  process.exitCode = 1;
} finally {
  await client?.end({ timeout: 5 });
}
