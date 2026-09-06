import { index, pgTable, text, uniqueIndex, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";
import { applications } from "./applications";

/**
 * Agent- and human-authored test suites, and the record of running them.
 *
 * A suite is a TypeScript file. It is never executed inside this process: the
 * runner ships it to a Vercel Sandbox, which talks back to this deployment over
 * the ordinary `/api/v1` surface with a run-scoped API key. What is stored here
 * is therefore only source text and results — nothing in this schema is
 * evaluated.
 */

export const testSuites = pgTable(
  "test_suites",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    code: text("code").notNull(),
    /** Who last wrote the file — a console admin or the assistant. */
    updatedBy: text("updated_by", { enum: ["user", "ai"] }).notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [
    index("test_suites_app_idx").on(table.applicationId, table.updatedAt),
    uniqueIndex("test_suites_app_name_idx").on(table.applicationId, table.name),
  ],
);

export const testRuns = pgTable(
  "test_runs",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    suiteId: text("suite_id")
      .notNull()
      .references(() => testSuites.id, { onDelete: "cascade" }),
    /** Snapshot of the file as it was run, so a later edit cannot rewrite history. */
    code: text("code").notNull(),
    status: text("status", {
      enum: ["queued", "running", "passed", "failed", "error", "canceled"],
    })
      .notNull()
      .default("queued"),
    trigger: text("trigger", {
      enum: ["console", "ai", "automatic"],
    })
      .notNull()
      .default("console"),
    triggeredBy: text("triggered_by"),
    conversationId: text("conversation_id"),
    /** Which execution backend served the run: `sandbox` or `local`. */
    driver: text("driver").notNull().default("sandbox"),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    passed: bigint("passed", { mode: "number" }).notNull().default(0),
    failed: bigint("failed", { mode: "number" }).notNull().default(0),
    skipped: bigint("skipped", { mode: "number" }).notNull().default(0),
    durationMs: bigint("duration_ms", { mode: "number" }),
    /** Set when the harness itself could not run — a compile error, a timeout. */
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date", precision: 3 }),
  },
  (table) => [
    index("test_runs_suite_started_idx").on(table.suiteId, table.startedAt),
    index("test_runs_app_started_idx").on(table.applicationId, table.startedAt),
  ],
);

export const testRunCases = pgTable(
  "test_run_cases",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    /** The `suite()` block the test was declared in. */
    suiteName: text("suite_name").notNull(),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["running", "passed", "failed", "skipped"],
    }).notNull(),
    position: bigint("position", { mode: "number" }).notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }),
    error: text("error"),
    /** Named `step()` calls, in order, each with its own outcome. */
    steps: jsonb("steps")
      .$type<{ name: string; status: string; durationMs: number | null }[]>()
      .notNull()
      .default([]),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [index("test_run_cases_run_idx").on(table.runId, table.position)],
);

/**
 * The append-only event log a run produces.
 *
 * The console tab and the chat card both read progress by polling for events
 * after a sequence number, so a viewer that connects late — or reloads — replays
 * the whole run rather than joining a live stream it cannot rewind.
 */
export const testRunEvents = pgTable(
  "test_run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 }).notNull(),
  },
  (table) => [uniqueIndex("test_run_events_run_seq_idx").on(table.runId, table.seq)],
);

export type TestSuite = typeof testSuites.$inferSelect;
export type TestRun = typeof testRuns.$inferSelect;
export type TestRunCase = typeof testRunCases.$inferSelect;
export type TestRunEvent = typeof testRunEvents.$inferSelect;
