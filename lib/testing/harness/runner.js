/**
 * The test harness that runs inside the sandbox.
 *
 * This file is never imported by the app. It is shipped verbatim into a Vercel
 * Sandbox alongside the suite under test, executed by `node`, and reports back
 * by printing one JSON line per event on stdout (see `lib/testing/protocol.ts`).
 * It therefore has no dependencies beyond the Node standard library and must
 * stay plain JavaScript.
 *
 * Everything the suite can reach is defined here: `suite`, `test`, `step`,
 * `expect`, and the `rx` client. They are installed as globals rather than
 * exported from a module so a suite file needs no import path and no
 * `node_modules` — the ambient declarations in `lib/testing/sdk-types.ts` give
 * the editor the same vocabulary.
 *
 * The sandbox holds a run-scoped API key and a signed control token. Both are
 * minted for one run and revoked when it ends, and the control endpoint refuses
 * every operation that is not scoped to a test user, so a suite cannot reach a
 * real subscriber even though it is executing arbitrary code.
 */

const MARKER = "rxtest";
const VERSION = 1;

const BASE_URL = (process.env.RX_BASE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.RX_API_KEY || "";
const CONTROL_TOKEN = process.env.RX_CONTROL_TOKEN || "";
const SUITE_PATH = process.env.RX_SUITE_PATH || "./suite.ts";
const TEST_TIMEOUT_MS = Number(process.env.RX_TEST_TIMEOUT_MS || 30_000);

// -------------------------------------------------------------- reporting ---

const rawWrite = process.stdout.write.bind(process.stdout);

function emit(event) {
  rawWrite(JSON.stringify({ [MARKER]: VERSION, ...event }) + "\n");
}

function format(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// A `console.log` inside a test is the author talking to themselves during a
// run; it must reach the viewer without being mistaken for a protocol line.
for (const level of ["log", "info", "debug", "warn", "error"]) {
  console[level] = (...args) => {
    emit({
      type: "log",
      stream: level === "warn" || level === "error" ? "stderr" : "stdout",
      message: args.map(format).join(" "),
    });
  };
}

// ------------------------------------------------------------- assertions ---

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
  );
}

function makeExpect(actual, negated) {
  const check = (pass, message) => {
    if (pass === !negated) return;
    throw new AssertionError(negated ? `not: ${message}` : message);
  };

  const api = {
    toBe(expected) {
      check(
        Object.is(actual, expected),
        `expected ${show(actual)} to be ${show(expected)}`,
      );
    },
    toEqual(expected) {
      check(
        deepEqual(actual, expected),
        `expected ${show(actual)} to equal ${show(expected)}`,
      );
    },
    toBeTruthy() {
      check(Boolean(actual), `expected ${show(actual)} to be truthy`);
    },
    toBeFalsy() {
      check(!actual, `expected ${show(actual)} to be falsy`);
    },
    toBeNull() {
      check(actual === null, `expected ${show(actual)} to be null`);
    },
    toBeUndefined() {
      check(actual === undefined, `expected ${show(actual)} to be undefined`);
    },
    toBeDefined() {
      check(actual !== undefined, `expected ${show(actual)} to be defined`);
    },
    toContain(item) {
      const has =
        typeof actual === "string"
          ? actual.includes(item)
          : Array.isArray(actual) && actual.some((entry) => deepEqual(entry, item));
      check(has, `expected ${show(actual)} to contain ${show(item)}`);
    },
    toHaveLength(length) {
      const actualLength = actual == null ? undefined : actual.length;
      check(
        actualLength === length,
        `expected length ${show(actualLength)} to be ${show(length)}`,
      );
    },
    toBeGreaterThan(value) {
      check(actual > value, `expected ${show(actual)} to be greater than ${show(value)}`);
    },
    toBeGreaterThanOrEqual(value) {
      check(actual >= value, `expected ${show(actual)} to be >= ${show(value)}`);
    },
    toBeLessThan(value) {
      check(actual < value, `expected ${show(actual)} to be less than ${show(value)}`);
    },
    toBeLessThanOrEqual(value) {
      check(actual <= value, `expected ${show(actual)} to be <= ${show(value)}`);
    },
    toMatch(pattern) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      check(
        typeof actual === "string" && regex.test(actual),
        `expected ${show(actual)} to match ${String(pattern)}`,
      );
    },
    toMatchObject(expected) {
      const matches =
        actual != null &&
        typeof actual === "object" &&
        Object.entries(expected).every(([key, value]) =>
          deepEqual(actual[key], value),
        );
      check(matches, `expected ${show(actual)} to match ${show(expected)}`);
    },
    async toReject(message) {
      let rejected = false;
      let reason = null;
      try {
        await actual;
      } catch (error) {
        rejected = true;
        reason = error;
      }
      const matched =
        rejected &&
        (message === undefined || String(reason?.message ?? reason).includes(message));
      check(
        matched,
        message === undefined
          ? "expected the promise to reject"
          : `expected the promise to reject with ${show(message)}, got ${show(String(reason?.message ?? reason))}`,
      );
    },
  };

  if (!negated) api.not = makeExpect(actual, true);
  return api;
}

// ---------------------------------------------------------------- client ----

class RxApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RxApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * A bare `TypeError: fetch failed` is the least useful thing a test can report,
 * and it is the first error anyone hits when the base URL is wrong — a dev
 * server on another port, or a sandbox pointed at localhost. Say which URL, and
 * say what to check.
 */
async function reach(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new RxApiError(
      0,
      "unreachable",
      `Could not reach ${url} (${error?.message || error}). Check that the app is running there and that TEST_RUNNER_BASE_URL points at it.`,
    );
  }
}

async function apiFetch(path, init = {}) {
  const response = await reach(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok && response.status !== 402) {
    throw new RxApiError(
      response.status,
      body?.error || "request_failed",
      body?.error_description || body?.error || `${path} failed (${response.status})`,
    );
  }
  return body;
}

/**
 * Operations the public API deliberately does not expose — creating a test
 * user, granting a plan without paying, moving a clock. They are authorized by
 * the run's control token and re-scoped to test users on the server.
 */
async function control(op, args = {}) {
  const response = await reach(`${BASE_URL}/api/testing/control`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CONTROL_TOKEN}`,
    },
    body: JSON.stringify({ op, args }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new RxApiError(
      response.status,
      body?.error || "control_failed",
      body?.error_description || `${op} failed (${response.status})`,
    );
  }
  return body;
}

const createdUsers = [];
let keepUsers = false;

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

const rx = {
  /** Everything one user is entitled to, in one call. */
  entitlements: (rxlabUserId) =>
    apiFetch(`/api/v1/entitlements${query({ rxlabUserId })}`),

  /** Purchasable plans and topups, with per-user eligibility when a user is given. */
  catalog: (rxlabUserId) => apiFetch(`/api/v1/catalog${query({ rxlabUserId })}`),

  usage: {
    get: (rxlabUserId) => apiFetch(`/api/v1/usage${query({ rxlabUserId })}`),
    record: (rxlabUserId, item, amount = 1, options = {}) =>
      apiFetch("/api/v1/usage", {
        method: "POST",
        body: JSON.stringify({ rxlabUserId, item, amount, ...options }),
      }),
  },

  balances: {
    get: (rxlabUserId) => apiFetch(`/api/v1/balances${query({ rxlabUserId })}`),
    credit: (rxlabUserId, unit, amount, options = {}) =>
      apiFetch("/api/v1/balances", {
        method: "POST",
        body: JSON.stringify({
          rxlabUserId,
          unit,
          amount,
          operation: "credit",
          idempotencyKey: options.idempotencyKey || `test-${randomId()}`,
          ...options,
        }),
      }),
    debit: (rxlabUserId, unit, amount, options = {}) =>
      apiFetch("/api/v1/balances", {
        method: "POST",
        body: JSON.stringify({
          rxlabUserId,
          unit,
          amount,
          operation: "debit",
          idempotencyKey: options.idempotencyKey || `test-${randomId()}`,
          ...options,
        }),
      }),
  },

  /** The application's configuration, for asserting against what is set up. */
  config: {
    plans: () => control("config.plans"),
    topups: () => control("config.topups"),
    roles: () => control("config.roles"),
    units: () => control("config.units"),
    usageItems: () => control("config.usageItems"),
  },

  testUsers: {
    async create(input = {}) {
      const user = await control("testUser.create", input);
      createdUsers.push(user.rxlabUserId);
      return user;
    },
    list: () => control("testUser.list"),
    delete: (rxlabUserId) => control("testUser.delete", { rxlabUserId }),
    grantPlan: (rxlabUserId, planKey) =>
      control("testUser.grantPlan", { rxlabUserId, planKey }),
    cancelPlan: (rxlabUserId, planKey, options = {}) =>
      control("testUser.cancelPlan", {
        rxlabUserId,
        planKey,
        immediately: options.immediately ?? true,
      }),
    setRoles: (rxlabUserId, roleKeys) =>
      control("testUser.setRoles", { rxlabUserId, roleKeys }),
    setUsageLimit: (rxlabUserId, itemKey, limit) =>
      control("testUser.setUsageLimit", { rxlabUserId, itemKey, limit }),
    adjustBalance: (rxlabUserId, unitKey, delta, reason) =>
      control("testUser.adjustBalance", { rxlabUserId, unitKey, delta, reason }),
    /**
     * Buy a topup without Stripe: the eligibility gate is evaluated exactly as
     * checkout would, and the units land only if it passes.
     */
    buyTopup: (rxlabUserId, topupKey) =>
      control("testUser.buyTopup", { rxlabUserId, topupKey }),
    setClock: (rxlabUserId, offsetMs) =>
      control("testUser.setClock", { rxlabUserId, offsetMs }),
    advanceClock: (rxlabUserId, ms) =>
      control("testUser.advanceClock", { rxlabUserId, ms }),
  },

  /** Keep the users this run created instead of deleting them at the end. */
  keepTestUsers() {
    keepUsers = true;
  },
};

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// -------------------------------------------------------------- collection --

const collected = [];
let activeSuite = null;
let activeSteps = null;

function ensureSuite() {
  if (activeSuite) return activeSuite;
  let fallback = collected.find((entry) => entry.implicit);
  if (!fallback) {
    fallback = { name: "Tests", tests: [], implicit: true };
    collected.push(fallback);
  }
  return fallback;
}

function defineSuite(name, fn) {
  const entry = { name: String(name), tests: [], implicit: false };
  collected.push(entry);
  const previous = activeSuite;
  activeSuite = entry;
  try {
    fn?.();
  } finally {
    activeSuite = previous;
  }
}

function defineTest(name, fn, options = {}) {
  ensureSuite().tests.push({
    name: String(name),
    fn,
    skip: Boolean(options.skip),
  });
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    const record = { name: String(name), status: "passed", durationMs: Date.now() - started };
    activeSteps?.push(record);
    emit({ type: "step", ...currentLocation, step: record.name, status: "passed", durationMs: record.durationMs });
    return result;
  } catch (error) {
    const record = { name: String(name), status: "failed", durationMs: Date.now() - started };
    activeSteps?.push(record);
    emit({ type: "step", ...currentLocation, step: record.name, status: "failed", durationMs: record.durationMs });
    throw error;
  }
}

let currentLocation = { suite: "", test: "" };

globalThis.suite = defineSuite;
globalThis.describe = defineSuite;
globalThis.test = defineTest;
globalThis.it = defineTest;
globalThis.step = step;
globalThis.expect = (actual) => makeExpect(actual, false);
globalThis.rx = rx;
globalThis.sleep = sleep;

defineTest.skip = (name, fn) => defineTest(name, fn, { skip: true });
defineSuite.skip = (name) => defineSuite(name, () => {});

// -------------------------------------------------------------- execution ---

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function describeError(error) {
  if (error instanceof Error) {
    // A failed assertion's stack is noise; the message is the whole point.
    if (error.name === "AssertionError") return error.message;
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

async function main() {
  const startedAt = Date.now();

  try {
    await import(SUITE_PATH);
  } catch (error) {
    emit({ type: "error", message: `Could not load the suite — ${describeError(error)}` });
    emit({ type: "run:end", total: 0, passed: 0, failed: 0, skipped: 0, durationMs: Date.now() - startedAt });
    process.exitCode = 1;
    return;
  }

  const outline = collected.map((entry) => ({
    name: entry.name,
    tests: entry.tests.map((test) => ({ name: test.name, steps: [] })),
  }));
  emit({ type: "run:start", outline });

  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let position = 0;

  for (const entry of collected) {
    emit({ type: "suite:start", suite: entry.name });
    let suitePassed = 0;
    let suiteFailed = 0;

    for (const testCase of entry.tests) {
      total += 1;
      const index = position;
      position += 1;

      if (testCase.skip) {
        skipped += 1;
        emit({
          type: "test:end",
          suite: entry.name,
          test: testCase.name,
          position: index,
          status: "skipped",
          durationMs: 0,
          error: null,
          steps: [],
        });
        continue;
      }

      emit({
        type: "test:start",
        suite: entry.name,
        test: testCase.name,
        position: index,
      });

      const steps = [];
      activeSteps = steps;
      currentLocation = { suite: entry.name, test: testCase.name };
      const startedTest = Date.now();

      try {
        await withTimeout(
          Promise.resolve().then(() => testCase.fn()),
          TEST_TIMEOUT_MS,
          `"${testCase.name}"`,
        );
        passed += 1;
        suitePassed += 1;
        emit({
          type: "test:end",
          suite: entry.name,
          test: testCase.name,
          position: index,
          status: "passed",
          durationMs: Date.now() - startedTest,
          error: null,
          steps,
        });
      } catch (error) {
        failed += 1;
        suiteFailed += 1;
        emit({
          type: "test:end",
          suite: entry.name,
          test: testCase.name,
          position: index,
          status: "failed",
          durationMs: Date.now() - startedTest,
          error: describeError(error),
          steps,
        });
      } finally {
        activeSteps = null;
      }
    }

    emit({ type: "suite:end", suite: entry.name, passed: suitePassed, failed: suiteFailed });
  }

  // Disposable users are disposable: a run that leaves dozens behind makes the
  // Test tab useless within a day.
  if (!keepUsers && createdUsers.length > 0) {
    for (const rxlabUserId of createdUsers) {
      try {
        await control("testUser.delete", { rxlabUserId });
      } catch (error) {
        emit({ type: "log", stream: "stderr", message: `Cleanup failed for ${rxlabUserId}: ${describeError(error)}` });
      }
    }
  }

  emit({
    type: "run:end",
    total,
    passed,
    failed,
    skipped,
    durationMs: Date.now() - startedAt,
  });
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  emit({ type: "error", message: describeError(error) });
  process.exitCode = 1;
});
