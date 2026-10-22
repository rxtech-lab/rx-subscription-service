import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
const date = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const mcpClients = pgTable("mcp_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: date("created_at").notNull(),
});
export const mcpGrants = pgTable(
  "mcp_grants",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpClients.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    resource: text("resource").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    applicationIds: jsonb("application_ids").$type<string[]>().notNull(),
    upstreamToken: text("upstream_token").notNull(),
    createdAt: date("created_at").notNull(),
    expiresAt: date("expires_at").notNull(),
    revokedAt: date("revoked_at"),
  },
  (t) => [index("mcp_grants_user_idx").on(t.userId)],
);
export const mcpCredentials = pgTable("mcp_credentials", {
  hash: text("hash").primaryKey(),
  grantId: text("grant_id")
    .notNull()
    .references(() => mcpGrants.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["code", "access", "refresh"] }).notNull(),
  redirectUri: text("redirect_uri"),
  challenge: text("challenge"),
  expiresAt: date("expires_at").notNull(),
  usedAt: date("used_at"),
});
export type McpGrant = typeof mcpGrants.$inferSelect;
