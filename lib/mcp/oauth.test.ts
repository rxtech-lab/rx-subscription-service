import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/console/session", () => ({
  requireConsoleUser: async () => ({ id: "user-a", accessToken: "test-admin" }),
  getManagedApplications: async () => [{ id: "project-a", name: "Project A" }],
}));
import {
  authenticate,
  authorize,
  challenge,
  exchange,
  registerClient,
  resource,
  revoke,
  seal,
  unseal,
  validRedirect,
  validateAuthorization,
} from "./oauth";
import { toolCatalog, callTool } from "./tools";
import { POST } from "@/app/api/mcp/route";
import { updateConnection } from "@/app/settings/actions";
const pg = new PGlite();
const database = drizzle(pg, { schema });
state.db = database;
const verifier = "a".repeat(43);
let params: URLSearchParams;
async function connect(
  scopes = ["projects:read", "subscriptions:read"],
  upstream = "test-admin",
) {
  params.set("scope", scopes.join(" "));
  const code = await authorize(params, "user-a", upstream, scopes, [
    "project-a",
    "project-b",
  ]);
  const exchangeParams = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.get("client_id")!,
    code,
    code_verifier: verifier,
    redirect_uri: params.get("redirect_uri")!,
    resource: resource(),
  });
  return { tokens: await exchange(exchangeParams), exchangeParams };
}
beforeAll(async () => {
  process.env.AUTH_SECRET = "unit-test-secret";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
}, 30000);
beforeEach(async () => {
  await pg.exec("TRUNCATE mcp_clients CASCADE");
  const client = await registerClient({
    client_name: "Test MCP",
    redirect_uris: ["http://127.0.0.1:3210/callback"],
  });
  params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge(verifier),
    resource: resource(),
    state: "state",
  });
});
afterAll(async () => {
  await pg.close();
});
describe("OAuth security", () => {
  it("rejects unsafe redirects and encrypts delegated tokens with authentication", () => {
    for (const uri of [
      "javascript:alert(1)",
      "https://good.test/#fragment",
      "https://u:p@good.test",
      "http://evil.test/callback",
    ])
      expect(validRedirect(uri)).toBe(false);
    expect(validRedirect("com.example.app:/callback")).toBe(true);
    const value = seal("secret-token");
    expect(value).not.toContain("secret-token");
    expect(unseal(value)).toBe("secret-token");
    expect(() => unseal(value.slice(0, -5) + "aaaaa")).toThrow();
  });
  it("rejects unregistered redirect, wrong resource, missing PKCE and unknown scope", async () => {
    for (const [key, value] of [
      ["redirect_uri", "https://evil.test"],
      ["resource", "https://evil.test/api/mcp"],
      ["code_challenge_method", "plain"],
      ["scope", "admin"],
    ]) {
      const bad = new URLSearchParams(params);
      bad.set(key, value);
      await expect(validateAuthorization(bad)).rejects.toThrow();
    }
  });
  it("binds codes to client, redirect, PKCE, and consumes them once", async () => {
    const { tokens, exchangeParams } = await connect();
    expect(await authenticate(tokens.access_token)).not.toBeNull();
    await expect(exchange(exchangeParams)).rejects.toMatchObject({
      code: "invalid_grant",
    });
    expect(await authenticate(tokens.access_token)).toBeNull();
  });
  it("does not consume a code with wrong verifier or client", async () => {
    const code = await authorize(
      params,
      "user-a",
      "test-admin",
      ["projects:read"],
      [],
    );
    const p = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: params.get("client_id")!,
      code,
      code_verifier: "b".repeat(43),
      redirect_uri: params.get("redirect_uri")!,
      resource: resource(),
    });
    await expect(exchange(p)).rejects.toThrow();
    p.set("code_verifier", verifier);
    p.set("client_id", "other");
    await expect(exchange(p)).rejects.toThrow();
    p.set("client_id", params.get("client_id")!);
    expect((await exchange(p)).access_token).toBeTruthy();
  });
  it("rotates refresh tokens and revokes the entire family on replay", async () => {
    const { tokens } = await connect();
    const p = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: params.get("client_id")!,
      refresh_token: tokens.refresh_token,
      resource: resource(),
    });
    const refreshed = await exchange(p);
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    expect(await authenticate(refreshed.access_token)).not.toBeNull();
    await expect(exchange(p)).rejects.toThrow();
    expect(await authenticate(refreshed.access_token)).toBeNull();
  });
  it("applies scope changes and disconnects to existing tokens, and rejects foreign owners", async () => {
    const { tokens } = await connect();
    const grant = (await authenticate(tokens.access_token))!;
    const edit = new FormData();
    edit.set("scopes", "projects:read");
    edit.set("applicationIds", "project-a");
    expect(await updateConnection(grant.id, edit)).toHaveProperty("success");
    expect((await authenticate(tokens.access_token))?.scopes).toEqual([
      "projects:read",
    ]);
    await database
      .update(schema.mcpGrants)
      .set({ userId: "other" })
      .where(eq(schema.mcpGrants.id, grant.id));
    const remove = new FormData();
    remove.set("operation", "disconnect");
    expect(await updateConnection(grant.id, remove)).toHaveProperty("error");
    expect(await authenticate(tokens.access_token)).not.toBeNull();
    await database
      .update(schema.mcpGrants)
      .set({ userId: "user-a" })
      .where(eq(schema.mcpGrants.id, grant.id));
    expect(await updateConnection(grant.id, remove)).toHaveProperty("success");
    expect(await authenticate(tokens.access_token)).toBeNull();
  });
  it("revokes by token only for the matching client", async () => {
    const { tokens } = await connect();
    await revoke(tokens.access_token, "wrong");
    expect(await authenticate(tokens.access_token)).not.toBeNull();
    await revoke(tokens.refresh_token, params.get("client_id")!);
    expect(await authenticate(tokens.access_token)).toBeNull();
  });
  it("expires access tokens and grants", async () => {
    const { tokens } = await connect();
    await database.update(schema.mcpGrants).set({ expiresAt: new Date(0) });
    expect(await authenticate(tokens.access_token)).toBeNull();
  });
  it("advertises only permitted tools and returns an OAuth challenge without login redirects", async () => {
    const { tokens } = await connect();
    const grant = (await authenticate(tokens.access_token))!;
    const names = toolCatalog(grant).map((t) => t.name);
    expect(names).toContain("listPlans");
    expect(names).not.toContain("createPlan");
    expect(names).not.toContain("renderUI");
    expect(() =>
      toolCatalog({
        ...grant,
        scopes: ["subscriptions:write", "paywalls:write"],
      }),
    ).not.toThrow();
    const response = await POST(
      new Request("http://localhost:3000/api/mcp", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "resource_metadata",
    );
    const denied = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          authorization: `Bearer ${tokens.access_token}`,
        },
      }),
    );
    expect(denied.status).toBe(403);
    await expect(callTool(grant, "createPlan", {})).rejects.toMatchObject({
      code: "insufficient_scope",
    });
  });
});
// Explicit opt-in: this suite uses the local Postman simulator over real HTTP.
describe.skipIf(!process.env.MCP_SIMULATION_URL)(
  "MCP permission simulation",
  () => {
    beforeEach(() => {
      process.env.AUTH_ISSUER = process.env.MCP_SIMULATION_URL;
    });
    it("intersects the grant with current RxLab projects and denies cross-project calls", async () => {
      const { tokens } = await connect();
      const grant = (await authenticate(tokens.access_token))!;
      expect(await callTool(grant, "listProjects", {})).toEqual([
        { id: "project-a", name: "Project A", description: null },
      ]);
      await expect(
        callTool(grant, "listPlans", { applicationId: "project-b", input: {} }),
      ).rejects.toMatchObject({ code: "access_denied" });
      expect(
        await callTool({ ...grant, applicationIds: [] }, "listProjects", {}),
      ).toEqual([]);
    });
    it("fails closed when upstream permissions are revoked", async () => {
      const { tokens } = await connect(["projects:read"], "revoked-admin");
      await expect(
        callTool(
          (await authenticate(tokens.access_token))!,
          "listProjects",
          {},
        ),
      ).rejects.toMatchObject({ code: "access_denied" });
    });
    it("uses the agent subscription writes and rejects IDs from other projects", async () => {
      const now = new Date();
      await database
        .insert(schema.applications)
        .values([
          { id: "project-a", name: "A", createdAt: now, updatedAt: now },
          { id: "project-b", name: "B", createdAt: now, updatedAt: now },
        ])
        .onConflictDoNothing();
      const { tokens } = await connect([
        "subscriptions:read",
        "subscriptions:write",
      ]);
      const grant = (await authenticate(tokens.access_token))!;
      const input = {
        key: "mcp-test",
        name: "MCP plan",
        billingInterval: "month",
        priceAmountCents: 500,
      };
      await expect(
        callTool(grant, "createPlan", { applicationId: "project-a", input }),
      ).rejects.toThrow();
      const result = (await callTool(grant, "createPlan", {
        applicationId: "project-a",
        input,
        confirmed: true,
      })) as { ok: boolean; result: { id: string } };
      expect(result.ok).toBe(true);
      expect(
        await callTool(grant, "listPlans", {
          applicationId: "project-a",
          input: {},
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: result.result.id }),
        ]),
      );
      await database
        .update(schema.plans)
        .set({ applicationId: "project-b" })
        .where(eq(schema.plans.id, result.result.id));
      await expect(
        callTool(grant, "getPlanEntitlements", {
          applicationId: "project-a",
          input: { planId: result.result.id },
        }),
      ).rejects.toThrow();
    });
    it("creates and updates paywall drafts through the same MCP path", async () => {
      const { tokens } = await connect(["paywalls:read", "paywalls:write"]);
      const grant = (await authenticate(tokens.access_token))!;
      await expect(
        callTool(grant, "createPaywall", { name: "No approval" }),
      ).rejects.toThrow();
      const created = (await callTool(grant, "createPaywall", {
        name: "MCP test paywall",
        confirmed: true,
      })) as { id: string; draftSpec: unknown };
      expect(created.id).toBeTruthy();
      await callTool(grant, "updatePaywall", {
        paywallId: created.id,
        spec: created.draftSpec,
        confirmed: true,
      });
      expect(
        await callTool(grant, "getPaywall", { paywallId: created.id }),
      ).toHaveProperty("publishedSpec", null);
    });
  },
);
