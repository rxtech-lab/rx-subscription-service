import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required.");

const globalForDb = globalThis as unknown as { postgresClient?: ReturnType<typeof postgres> };
export const client = globalForDb.postgresClient ?? postgres(url, {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});
if (process.env.NODE_ENV !== "production") globalForDb.postgresClient = client;
export const db = drizzle(client, { schema });
export { schema };

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = typeof db | DbTransaction;
