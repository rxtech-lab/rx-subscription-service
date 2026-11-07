import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { usageRecords } from '@/lib/db/schema';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite();
  return { db: drizzle(client), testClient: client };
});
vi.mock('./users', () => ({ requireAppUser: async () => ({ testClockOffsetMs: 0 }), debitBalance: vi.fn(), InsufficientBalanceError: class extends Error {} }));
vi.mock('./entitlements', () => ({ resolveEntitlements: async () => ({ usageLimits: {} }), getBillingWindow: async () => ({ start: null, end: null }) }));
vi.mock('./usage-items', () => ({ requireUsageItem: async () => ({ id: 'meter', name: 'Storage', defaultLimit: 10, overagePolicy: 'block', resetPolicy: 'never' }) }));
import { db } from '@/lib/db';
import { recordUsage, releaseUsage, settleUsage } from './usage';
const input = { applicationId: 'app', appUserId: 'user', usageItemId: 'meter' };
beforeAll(async () => {
 const statements = `CREATE TABLE app_users (id text PRIMARY KEY); INSERT INTO app_users VALUES ('user');
 CREATE TABLE usage_counters (id text PRIMARY KEY, app_user_id text, usage_item_id text, period_start timestamptz, period_end timestamptz, used bigint NOT NULL DEFAULT 0 CHECK(used >= 0), limit_value bigint, created_at timestamptz, updated_at timestamptz, UNIQUE(app_user_id,usage_item_id,period_start));
 CREATE TABLE usage_records (id text PRIMARY KEY, app_user_id text, usage_item_id text, counter_id text, amount bigint, used_after bigint, charged_units bigint DEFAULT 0, idempotency_key text UNIQUE, metadata jsonb, created_at timestamptz);`;
 for (const statement of statements.split(";").filter(s=>s.trim())) await db.execute(sql.raw(statement));
});
afterAll(async () => { const { testClient } = await import('@/lib/db') as unknown as { testClient: { close(): Promise<void> } }; await testClient.close(); });
it('atomically blocks concurrent excess, releases once, and never reconsumes released operations', async () => {
 const outcomes = await Promise.all(['a','b','c'].map(idempotencyKey => recordUsage({ ...input, amount: 4, idempotencyKey })));
 expect(outcomes.filter(x=>x.allowed)).toHaveLength(2);
 const key = ['a','b','c'][outcomes.findIndex(x=>x.allowed)];
 expect(await releaseUsage({ ...input, idempotencyKey: key })).toEqual({ released: true, duplicate: false });
 expect(await releaseUsage({ ...input, idempotencyKey: key })).toEqual({ released: true, duplicate: true });
 expect(await recordUsage({ ...input, amount: 4, idempotencyKey: key })).toMatchObject({ allowed: false, reason: 'released' });
 expect(await recordUsage({ ...input, amount: 6, idempotencyKey: 'new' })).toMatchObject({ allowed: true, used: 10 });
});
it('tombstones release-before-consume so delayed requests cannot leak quota', async () => {
 await releaseUsage({ ...input, idempotencyKey: 'late' });
 await releaseUsage({ ...input, idempotencyKey: 'new' });
 expect(await recordUsage({ ...input, amount: 1, idempotencyKey: 'late' })).toMatchObject({ allowed: false, reason: 'released' });
});

it('settles actual usage exactly once and prevents later refunds', async () => {
 await recordUsage({ ...input, amount: 6, idempotencyKey: 'settle-test' });
 expect(await settleUsage({ ...input, amount: 2, idempotencyKey: 'settle-test' })).toEqual({ settled: true, duplicate: false });
 expect(await settleUsage({ ...input, amount: 2, idempotencyKey: 'settle-test' })).toEqual({ settled: true, duplicate: true });
 await expect(settleUsage({ ...input, amount: 1, idempotencyKey: 'settle-test' })).rejects.toThrow('conflicts');
 await expect(releaseUsage({ ...input, idempotencyKey: 'settle-test' })).rejects.toThrow('Settled');
 const rows = await db.select().from(usageRecords).where(eq(usageRecords.idempotencyKey, 'settle:settle-test'));
 expect(rows[0].amount).toBe(-4);
});
it('rejects missing reservations, released reservations, and over-settlement', async () => {
 await expect(settleUsage({ ...input, amount: 0, idempotencyKey: 'missing' })).rejects.toThrow('not found');
 await expect(settleUsage({ ...input, amount: 0, idempotencyKey: 'late' })).rejects.toThrow('Released');
 await recordUsage({ ...input, amount: 2, idempotencyKey: 'bounds' });
 await expect(settleUsage({ ...input, amount: 3, idempotencyKey: 'bounds' })).rejects.toThrow('exceeds');
 const results = await Promise.all([0,0].map(amount => settleUsage({ ...input, amount, idempotencyKey: 'bounds' })));
 expect(results.filter(r => r.duplicate)).toHaveLength(1);
});
