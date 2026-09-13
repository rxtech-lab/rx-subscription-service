import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import {
  E2E_API_KEY, E2E_SANDBOX_API_KEY, E2E_SECRET, E2E_DATABASE_URL,
  E2E_PLAN_ID, E2E_SECOND_PLAN_ID, E2E_ADDON_PLAN_ID,
  E2E_DEFAULT_PLAN_API_KEY, E2E_DEFAULT_PLAN_ID, E2E_DEFAULT_PLAN_PAID_ID, E2E_UNIT_ID, E2E_DEFAULT_PLAN_UNIT_ID,
} from "./fixtures";

const sql = postgres(E2E_DATABASE_URL, { max: 1 });
test.afterAll(() => sql.end());
const headers = (key = E2E_API_KEY) => ({ "X-Api-Key": key, "X-E2E-Secret": E2E_SECRET });
async function user(request: APIRequestContext, key = E2E_API_KEY, rxlabUserId = `complimentary-${crypto.randomUUID()}`) {
  const response = await request.get("/api/v1/entitlements", { headers: headers(key), params: { rxlabUserId } });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return { appUserId: body.user.id as string, rxlabUserId, body };
}
async function grant(request: APIRequestContext, appUserId: string, options: Record<string, unknown> = {}, operationId = crypto.randomUUID(), key = E2E_API_KEY) {
  const response = await request.post("/api/e2e/agent-grants", {
    headers: headers(key), data: { name: "grantComplimentarySubscription", operationId, args: {
      appUserId, environment: "production", planId: E2E_SECOND_PLAN_ID, periodDays: 30, reason: "Support goodwill", ...options,
    } },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

for (const environment of ["sandbox", "production"] as const) {
  test(`grants ${environment} access through the chat tool once, with isolated allowances and an audit`, async ({ request }) => {
    const key = environment === "production" ? E2E_API_KEY : E2E_SANDBOX_API_KEY;
    const target = await user(request, key);
    const operationId = crypto.randomUUID();
    const attempts = await Promise.all([
      grant(request, target.appUserId, { environment }, operationId),
      grant(request, target.appUserId, { environment }, operationId),
    ]);
    expect(attempts.every((result) => result.ok)).toBe(true);
    expect(attempts.map((result) => result.result.duplicate).sort()).toEqual([false, true]);
    const subscription = attempts[0].result.subscription;
    expect(subscription).toMatchObject({ billingProvider: "complimentary", status: "active", cancelAtPeriodEnd: true, stripeSubscriptionId: null, providerProductId: null });
    expect(new Date(subscription.currentPeriodEnd).getTime() - new Date(subscription.currentPeriodStart).getTime()).toBe(30 * 86_400_000);
    const refreshed = await user(request, key, target.rxlabUserId);
    expect(refreshed.body).toMatchObject({
      plans: [], complimentaryPlans: [{ planId: E2E_SECOND_PLAN_ID }],
      balances: [{ unit: "points", amount: 10_000 }],
      usage: expect.arrayContaining([expect.objectContaining({ key: "pts", limit: 10_000 })]),
    });
    const other = await user(request, environment === "production" ? E2E_SANDBOX_API_KEY : E2E_API_KEY, target.rxlabUserId);
    expect(other.body.complimentaryPlans).toEqual([]);
    expect(other.body.balances).toEqual([]);
    const audits = await sql`select * from audit_logs where entity_id = ${subscription.id} and action = 'subscription.grant_complimentary'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_type: "ai", actor_id: "e2e-admin" });
    expect(audits[0].after).toMatchObject({ environment, reason: "Support goodwill" });
    const credits = await sql`select * from ledger_entries where reference_id = ${subscription.id}`;
    expect(credits).toHaveLength(1);
    const purchases = await sql`select * from purchases where app_user_id = ${target.appUserId}`;
    expect(purchases).toHaveLength(0);
    expect((await grant(request, target.appUserId, { environment, periodDays: 31 }, operationId)).ok).toBe(false);
  });
}

test("rejects wrong environments, cross-application targets, inactive plans, and group conflicts", async ({ request }) => {
  const target = await user(request);
  await sql`update plans set status = 'draft' where id = ${E2E_ADDON_PLAN_ID}`;
  try {
    expect(await grant(request, target.appUserId, { planId: E2E_ADDON_PLAN_ID })).toMatchObject({ ok: false, error: expect.stringContaining("active plan") });
  } finally { await sql`update plans set status = 'active' where id = ${E2E_ADDON_PLAN_ID}`; }
  expect(await grant(request, target.appUserId, { environment: "sandbox" })).toMatchObject({ ok: false, error: expect.stringContaining("belongs to production") });
  expect((await grant(request, target.appUserId, {}, crypto.randomUUID(), E2E_DEFAULT_PLAN_API_KEY)).ok).toBe(false);
  expect((await grant(request, target.appUserId, { planId: E2E_DEFAULT_PLAN_PAID_ID })).ok).toBe(false);
  const competing = await Promise.all([
    grant(request, target.appUserId),
    grant(request, target.appUserId, { planId: E2E_PLAN_ID }),
  ]);
  expect(competing.filter((outcome) => outcome.ok)).toHaveLength(1);
  expect(competing.find((outcome) => !outcome.ok).error).toContain("User already has");
  expect((await grant(request, target.appUserId, { planId: E2E_ADDON_PLAN_ID })).ok).toBe(true);
});

test("preserves existing provider subscriptions and rejects complimentary overlap", async ({ request }) => {
  const target = await user(request);
  const response = await request.post("/api/e2e/subscriptions", { headers: headers(), data: { rxlabUserId: target.rxlabUserId, planId: E2E_PLAN_ID } });
  expect(response.ok()).toBe(true);
  const before = await sql`select * from subscriptions where app_user_id = ${target.appUserId}`;
  expect((await grant(request, target.appUserId)).ok).toBe(false);
  const after = await sql`select * from subscriptions where app_user_id = ${target.appUserId}`;
  expect(after).toEqual(before);
});

test("expires complimentary access on read, restores the free default, and allows a new grant", async ({ request }) => {
  const target = await user(request, E2E_DEFAULT_PLAN_API_KEY);
  expect(target.body.defaultPlans).toMatchObject([{ planId: E2E_DEFAULT_PLAN_ID }]);
  const outcome = await grant(request, target.appUserId, { planId: E2E_DEFAULT_PLAN_PAID_ID }, crypto.randomUUID(), E2E_DEFAULT_PLAN_API_KEY);
  expect(outcome.ok).toBe(true);
  const active = await user(request, E2E_DEFAULT_PLAN_API_KEY, target.rxlabUserId);
  expect(active.body.defaultPlans).toEqual([]);
  expect(active.body.complimentaryPlans).toHaveLength(1);
  const endedAt = new Date(Date.now() - 1000);
  await sql`update subscriptions set current_period_end = ${endedAt} where id = ${outcome.result.subscription.id}`;
  const expired = await user(request, E2E_DEFAULT_PLAN_API_KEY, target.rxlabUserId);
  expect(expired.body.complimentaryPlans).toEqual([]);
  expect(expired.body.defaultPlans).toMatchObject([{ planId: E2E_DEFAULT_PLAN_ID }]);
  const [stored] = await sql`select * from subscriptions where id = ${outcome.result.subscription.id}`;
  expect(stored.status).toBe("expired");
  expect(new Date(stored.ended_at).getTime()).toBe(endedAt.getTime());
  expect((await grant(request, target.appUserId, { planId: E2E_DEFAULT_PLAN_PAID_ID }, crypto.randomUUID(), E2E_DEFAULT_PLAN_API_KEY)).ok).toBe(true);
});

test("shows Complimentary in the console and revokes access through Cancel now", async ({ browser, request }) => {
  const target = await user(request);
  const outcome = await grant(request, target.appUserId, { planId: E2E_PLAN_ID });
  expect(outcome.ok).toBe(true);
  expect((await user(request, E2E_API_KEY, target.rxlabUserId)).body.roles).toContain("pro");
  const context = await browser.newContext({ extraHTTPHeaders: { "X-E2E-Secret": E2E_SECRET } });
  const page = await context.newPage();
  try {
    await page.goto("/apps/e2e-app/subscriptions");
    const row = page.locator("tr").filter({ hasText: target.rxlabUserId });
    await expect(row.getByText("Complimentary", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Actions for Pro" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cancel now", exact: true }).click();
    await expect(row.getByText("canceled", { exact: true })).toBeVisible();
    const revoked = await user(request, E2E_API_KEY, target.rxlabUserId);
    expect(revoked.body.complimentaryPlans).toEqual([]);
    expect(revoked.body.roles).not.toContain("pro");
  } finally { await context.close(); }
});


async function credits(request: APIRequestContext, appUserId: string, options: Record<string, unknown> = {}, operationId = crypto.randomUUID(), key = E2E_API_KEY) {
  const response = await request.post("/api/e2e/agent-grants", {
    headers: headers(key), data: { name: "grantUserCredits", operationId, args: {
      appUserId, environment: "production", unitId: E2E_UNIT_ID, amount: 100, reason: "Support credit", ...options,
    } },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

for (const environment of ["sandbox", "production"] as const) {
  test(`adds ${environment} credits once per approval and preserves existing balances`, async ({ request }) => {
    const key = environment === "production" ? E2E_API_KEY : E2E_SANDBOX_API_KEY;
    const target = await user(request, key);
    expect((await credits(request, target.appUserId, { environment, amount: 25 })).ok).toBe(true);
    const operationId = crypto.randomUUID();
    const attempts = await Promise.all([
      credits(request, target.appUserId, { environment }, operationId),
      credits(request, target.appUserId, { environment }, operationId),
    ]);
    expect(attempts.every((result) => result.ok)).toBe(true);
    expect(attempts.map((result) => result.result.duplicate).sort()).toEqual([false, true]);
    const refreshed = await user(request, key, target.rxlabUserId);
    expect(refreshed.body).toMatchObject({ plans: [], complimentaryPlans: [], balances: [{ unit: "points", amount: 125, available: 125 }] });
    expect((await credits(request, target.appUserId, { environment, amount: 101 }, operationId)).ok).toBe(false);
    const other = await user(request, environment === "production" ? E2E_SANDBOX_API_KEY : E2E_API_KEY, target.rxlabUserId);
    expect(other.body.balances).toEqual([]);
    const audits = await sql`select * from audit_logs where entity_id = ${attempts[0].result.entry.id}`;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "balance.grant_credits", actor_type: "ai", actor_id: "e2e-admin", after: { environment, reason: "Support credit", delta: 100 } });
    const lots = await sql`select * from balance_lots where app_user_id = ${target.appUserId}`;
    expect(lots).toHaveLength(2);
    expect(lots.every((lot) => lot.expires_at === null)).toBe(true);
  });
}

test("rejects credit grants to the wrong environment, application, or balance unit", async ({ request }) => {
  const target = await user(request);
  expect((await credits(request, target.appUserId, { environment: "sandbox" })).ok).toBe(false);
  expect((await credits(request, target.appUserId, {}, crypto.randomUUID(), E2E_DEFAULT_PLAN_API_KEY)).ok).toBe(false);
  expect((await credits(request, target.appUserId, { unitId: E2E_DEFAULT_PLAN_UNIT_ID })).ok).toBe(false);
  expect((await user(request, E2E_API_KEY, target.rxlabUserId)).body.balances).toEqual([]);
});

test("chat finds the exact environment record and complimentary grants add no revenue", async ({ request }) => {
  const target = await user(request);
  const sandbox = await user(request, E2E_SANDBOX_API_KEY, target.rxlabUserId);
  const read = async (environment: string) => {
    const response = await request.get("/api/e2e/agent-grants", { headers: headers(), params: { environment, search: target.rxlabUserId } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const before = await read("production");
  expect(before.users).toMatchObject([{ appUserId: target.appUserId, environment: "production" }]);
  expect((await read("sandbox")).users).toMatchObject([{ appUserId: sandbox.appUserId, environment: "sandbox" }]);
  expect((await grant(request, target.appUserId)).ok).toBe(true);
  expect((await credits(request, target.appUserId)).ok).toBe(true);
  const after = await read("production");
  expect(after.analytics.totals.mrrCents).toBe(before.analytics.totals.mrrCents);
  expect(after.analytics.totals.grossCents).toBe(before.analytics.totals.grossCents);
});

test("rolls back access, allowances, and credits if the audit cannot be recorded", async ({ request }) => {
  const target = await user(request);
  await sql.unsafe(`CREATE FUNCTION e2e_reject_grant_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.after->>'reason' = 'Force transactional rollback' THEN RAISE EXCEPTION 'E2E audit failure'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
  await sql.unsafe(`CREATE TRIGGER e2e_reject_grant_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION e2e_reject_grant_audit()`);
  try {
    const reason = "Force transactional rollback";
    expect((await grant(request, target.appUserId, { reason })).ok).toBe(false);
    expect((await credits(request, target.appUserId, { reason })).ok).toBe(false);
    expect(await sql`select id from subscriptions where app_user_id = ${target.appUserId}`).toHaveLength(0);
    expect(await sql`select id from ledger_entries where app_user_id = ${target.appUserId}`).toHaveLength(0);
    expect(await sql`select id from balances where app_user_id = ${target.appUserId}`).toHaveLength(0);
  } finally {
    await sql.unsafe("DROP TRIGGER e2e_reject_grant_audit ON audit_logs");
    await sql.unsafe("DROP FUNCTION e2e_reject_grant_audit()");
  }
});
