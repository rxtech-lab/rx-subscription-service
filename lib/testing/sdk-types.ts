/**
 * The ambient vocabulary a suite is written against.
 *
 * One string, three consumers: Monaco loads it as an extra lib so the editor
 * autocompletes and type-checks against the real surface, `typecheck.ts`
 * compiles saved suites against it, and the assistant's system prompt embeds it
 * so a generated suite uses the same names. The runtime side of every
 * declaration lives in `lib/testing/harness/runner.js` — if you add to one, add
 * to the other.
 *
 * Two rules for editing this file, both enforced by `sdk-types.test.ts`:
 *
 * - Every declaration carries a JSDoc comment. TypeScript surfaces those on
 *   hover and in completions and ignores `//` ones entirely, and this is the
 *   only documentation an author of a suite gets — there is no package to go
 *   and read.
 * - Nothing a call returns is an anonymous object type. A named interface can
 *   be documented and shows up in a hover as a name worth following; an inline
 *   shape can do neither.
 *
 * The string is delimited by backticks, so the documentation inside must not
 * use them. Quote code with 'single quotes'.
 */
export const SDK_TYPES = `
declare global {
  /**
   * Group related tests. Suites run in declaration order.
   *
   * A file may declare several. Each becomes a section in the workflow diagram
   * beside the editor.
   *
   * @param name Shown in the diagram and in the run report.
   * @param body Calls 'test()' once per case. Runs immediately, at collection
   * time, so do not put setup work here — put it in the tests that need it.
   *
   * @example
   * suite("Topup eligibility", () => {
   *   test("a free user cannot buy the pro pack", async () => {});
   * });
   */
  function suite(name: string, body: () => void): void;

  /** Alias for 'suite', for anyone with the habit. */
  function describe(name: string, body: () => void): void;

  /**
   * Declare one test.
   *
   * Tests inside a suite run one after another, never in parallel, so a test
   * may rely on state an earlier one left behind — though a test that creates
   * its own user is easier to read and to move.
   *
   * A test fails when an assertion throws, when the body throws, or when it
   * runs longer than 30 seconds.
   *
   * @param name Stated as a fact about the system, e.g. "a new user has no roles".
   * @param body May be async. Awaited before the next test starts.
   */
  function test(name: string, body: () => void | Promise<void>): void;

  /** Alias for 'test', for anyone with the habit. */
  function it(name: string, body: () => void | Promise<void>): void;

  namespace test {
    /**
     * Declare a test that is reported as skipped without running.
     *
     * Better than commenting one out: it stays visible in the diagram and in
     * the totals, so nobody forgets it is off.
     */
    function skip(name: string, body?: () => void | Promise<void>): void;
  }

  /**
   * Name a phase of a test.
   *
   * Steps are the nodes of the workflow diagram and are reported individually,
   * so a run shows exactly how far a failing test got. Prefer three named steps
   * over one long body.
   *
   * Returns whatever the body returns, so it wraps an existing call without
   * restructuring anything.
   *
   * @param name Shown as a node under the test, e.g. "grant the plan".
   * @param body The work. May be async.
   *
   * @example
   * const user = await step("create a subscriber", () => rx.testUsers.create());
   * await step("grant the plan", () => rx.testUsers.grantPlan(user.rxlabUserId, "pro"));
   */
  function step<T>(name: string, body: () => T | Promise<T>): Promise<T>;

  /**
   * Pause for a number of milliseconds.
   *
   * Useful after an operation that settles asynchronously. Prefer asserting on
   * a value over waiting a fixed time — a sleep long enough to be reliable is
   * usually long enough to be slow.
   *
   * @param ms How long to wait.
   */
  function sleep(ms: number): Promise<void>;

  /**
   * Start an assertion.
   *
   * A failed assertion reports its message without a stack, so write the
   * expectation so that its failure reads well.
   *
   * @param actual The value under test.
   *
   * @example
   * expect(entitlements.roles).toContain("pro");
   * expect(balance.amount).toBeGreaterThan(0);
   * expect(topup.eligible).toBe(false);
   */
  function expect<T>(actual: T): Matchers<T>;

  /** What you can assert about a value. Each throws on failure, ending the test. */
  interface Matchers<T> {
    /**
     * Strict identity, as 'Object.is'. Use 'toEqual' for objects and arrays.
     * @param expected The value it should be.
     */
    toBe(expected: unknown): void;

    /**
     * Deep structural equality. The usual choice for an object or an array.
     * @param expected The structure it should match.
     */
    toEqual(expected: unknown): void;

    /**
     * Deep equality on the listed keys only; other keys are ignored.
     *
     * Use it to assert the part of a response you care about without pinning
     * fields that are allowed to change.
     *
     * @param expected The subset that must match.
     */
    toMatchObject(expected: Record<string, unknown>): void;

    /** Passes for any truthy value. */
    toBeTruthy(): void;

    /** Passes for any falsy value: false, 0, "", null, undefined, NaN. */
    toBeFalsy(): void;

    /** Strictly null. 'undefined' does not pass. */
    toBeNull(): void;

    /** Strictly undefined. 'null' does not pass. */
    toBeUndefined(): void;

    /** Anything other than undefined, including null. */
    toBeDefined(): void;

    /**
     * A substring of a string, or a deep-equal member of an array.
     * @param item What it should contain.
     */
    toContain(item: unknown): void;

    /**
     * Exact '.length'. Reads better than comparing '.length' yourself.
     * @param length The expected length.
     */
    toHaveLength(length: number): void;

    /**
     * Strictly greater than.
     * @param value The exclusive lower bound.
     */
    toBeGreaterThan(value: number): void;

    /**
     * Greater than or equal to.
     * @param value The inclusive lower bound.
     */
    toBeGreaterThanOrEqual(value: number): void;

    /**
     * Strictly less than.
     * @param value The exclusive upper bound.
     */
    toBeLessThan(value: number): void;

    /**
     * Less than or equal to.
     * @param value The inclusive upper bound.
     */
    toBeLessThanOrEqual(value: number): void;

    /**
     * Test a string against a pattern.
     * @param pattern A regex, or a string read as one.
     */
    toMatch(pattern: string | RegExp): void;

    /**
     * Await a promise and assert that it rejected. Must itself be awaited.
     *
     * This is how you assert that something is refused — a debit past zero, a
     * gated topup, a usage call over the limit.
     *
     * @param messageContains Optional substring the rejection message must have.
     *
     * @example
     * await expect(rx.balances.debit(user.rxlabUserId, "points", 999999)).toReject();
     */
    toReject(messageContains?: string): Promise<void>;

    /** Invert the matcher that follows: 'expect(x).not.toBe(1)'. */
    readonly not: Matchers<T>;
  }

  /** One balance a user holds, in a single unit. */
  interface RxBalance {
    /** The unit's key, e.g. "points". */
    unit: string;
    /** The unit's display name, e.g. "Points". */
    name: string;
    /** Whole units held. Always an integer. */
    amount: number;
    /** 'amount' minus anything reserved; what can be spent right now. */
    available: number;
    /** Decimal places used when displaying the amount. The stored value is integer. */
    precision: number;
  }

  /** One metered item and where the user stands against it. */
  interface RxUsage {
    /** The item's key, as passed to 'rx.usage.record'. */
    key: string;
    /** The item's display name. */
    name: string;
    /** Units consumed in the current period. */
    used: number;
    /** The allowance for this period. null means unlimited. */
    limit: number | null;
    /** 'limit' minus 'used'. null when the limit is unlimited. */
    remaining: number | null;
    /** ISO timestamp of the next reset, or null when the policy never resets. */
    resetsAt: string | null;
    /** One of never, rolling_window, calendar_period, billing_period. */
    resetPolicy: string;
  }

  /** Who a set of entitlements belongs to. */
  interface RxUserRef {
    /** This application's own id for the user. */
    id: string;
    /** The id every 'rx' call takes. */
    rxlabUserId: string;
    /** Numeric tier, if the application uses one. */
    level: number;
    /** Named tier, if the application uses one. */
    levelKey: string | null;
  }

  /** A plan the user is currently subscribed to. */
  interface RxHeldPlan {
    /** The plan's id. */
    id: string;
    /** The plan's key. */
    key: string;
    /** The plan's display name. */
    name: string;
    /** Subscription status: active, trialing, past_due, canceled. */
    status: string;
  }

  /** Everything the application needs to gate a feature for one user. */
  interface RxEntitlements {
    /** The user these entitlements describe. */
    user: RxUserRef;
    /** Plans currently subscribed to. Empty for a user who has bought nothing. */
    plans: RxHeldPlan[];
    /** Subscription role keys held, from plans and direct grants alike. */
    roles: string[];
    /** Serialized permission expressions, e.g. "read:a:all". */
    permissions: string[];
    /** Feature flags granted by a plan, keyed by flag. */
    features: Record<string, unknown>;
    /** Every balance the user holds. */
    balances: RxBalance[];
    /** Every metered item and the user's standing against it. */
    usage: RxUsage[];
  }

  /** A plan as the catalog presents it, without any per-user state. */
  interface RxCatalogPlan {
    /** The plan's id. */
    id: string;
    /** Stable identifier. This is what 'grantPlan' takes. */
    key: string;
    /** The plan's display name. */
    name: string;
    /** Longer copy, if the plan has any. */
    description: string | null;
    /** month, quarter, year, or one_time. */
    billingInterval: string;
    /** How many intervals per period. 3 with "month" is quarterly. */
    intervalCount: number;
    /** Integer cents. 999 is $9.99. */
    priceAmountCents: number;
    /** Lowercase ISO code, e.g. "usd". */
    currency: string;
    /** Free days before the first charge. 0 for no trial. */
    trialDays: number;
  }

  /** One rule that stood between a user and a purchase. */
  interface RxBlockedBy {
    /** The rule type: requires_active_plan, requires_any_plan, or requires_role. */
    kind: string;
    /** A human-readable statement of what was missing. */
    reason: string;
  }

  /** A purchasable pack of units, with the gate that gets in the way of it. */
  interface RxCatalogTopup {
    /** The pack's id. */
    id: string;
    /** Stable identifier. This is what 'buyTopup' takes. */
    key: string;
    /** The pack's display name. */
    name: string;
    /** Longer copy, if the pack has any. */
    description: string | null;
    /** Key of the balance unit this pack credits. */
    unit: string | null;
    /** Units credited on purchase. */
    amount: number;
    /** Integer cents. */
    priceAmountCents: number;
    /** Lowercase ISO code. */
    currency: string;
    /**
     * Whether this user may buy it. null when the catalog was read without a
     * user, since eligibility is a question about somebody.
     */
    eligible: boolean | null;
    /** The rules that blocked it, when it is not eligible. */
    blockedBy: RxBlockedBy[] | null;
  }

  /** What is on sale right now. */
  interface RxCatalog {
    /** Active plans, cheapest tier first is not guaranteed — sort if you care. */
    plans: RxCatalogPlan[];
    /** Active topup packs, each with its eligibility verdict for the given user. */
    topups: RxCatalogTopup[];
  }

  /** A subscription role this application defines. */
  interface RxRole {
    /** The role's id. */
    id: string;
    /** Stable identifier, as it appears in 'RxEntitlements.roles'. */
    key: string;
    /** The role's display name. */
    title: string;
  }

  /** A balance unit this application meters in. */
  interface RxUnit {
    /** The unit's id. */
    id: string;
    /** Stable identifier, as passed to 'rx.balances.credit'. */
    key: string;
    /** The unit's display name. */
    name: string;
  }

  /** A metered item this application defines. */
  interface RxUsageItem {
    /** The item's id. */
    id: string;
    /** Stable identifier, as passed to 'rx.usage.record'. */
    key: string;
    /** The item's display name. */
    name: string;
    /** The allowance when no plan or override says otherwise. null is unlimited. */
    defaultLimit: number | null;
  }

  /** A disposable user. Pass its 'rxlabUserId' to everything else. */
  interface RxTestUser {
    /** This application's own id for the user. */
    appUserId: string;
    /** The id every 'rx' call takes. Synthetic, of the form "test:<uuid>". */
    rxlabUserId: string;
    /** The name shown on the Test tab. */
    displayName: string;
    /** Optional address, used for the Stripe customer record. */
    email: string | null;
    /** Numeric tier. 0 unless set. */
    level: number;
  }

  /** The starting state a test user is created in. Every field is optional. */
  interface RxTestUserInput {
    /** Defaults to "Test user". */
    displayName?: string;
    /** Optional address, used for the Stripe customer record. */
    email?: string;
    /** Shown on the Test tab, if the user survives the run. */
    note?: string;
    /** Numeric tier. */
    level?: number;
    /** Named tier. */
    levelKey?: string;
    /** Roles granted directly, with no plan behind them. */
    roleKeys?: string[];
    /** Start the user subscribed to this plan, with no payment. */
    planKey?: string;
    /** Balance unit to seed. Needs 'amount'. */
    unitKey?: string;
    /** Units to seed. Needs 'unitKey'. */
    amount?: number;
  }

  /** Every metered item and where the user stands. */
  interface RxUsageSnapshot {
    /** One entry per metered item this application defines. */
    usage: RxUsage[];
  }

  /** Every balance the user holds. */
  interface RxBalanceSnapshot {
    /** One entry per unit the user has ever held, including zeroed ones. */
    balances: RxBalance[];
  }

  /** Options for reporting metered usage. */
  interface RxUsageOptions {
    /** Reuse a key to make a retry count once. Generated per call when omitted. */
    idempotencyKey?: string;
    /** Arbitrary data stored with the usage record. */
    metadata?: Record<string, unknown>;
  }

  /** Options for moving a balance. */
  interface RxBalanceOptions {
    /** Reuse a key to make a retry count once. Generated per call when omitted. */
    idempotencyKey?: string;
    /** What the ledger entry says. Defaults to a generic adjustment. */
    description?: string;
  }

  /** Options for cancelling a subscription. */
  interface RxCancelOptions {
    /** true ends it now; false lets the paid period run out. Defaults to true. */
    immediately?: boolean;
  }

  /** The verdict on one metered call, and where it left the counter. */
  interface RxUsageResult {
    /** false when the item is configured to block and the limit is reached. */
    allowed: boolean;
    /** Units consumed in this period, including this call when it was allowed. */
    used: number;
    /** The allowance in force. null means unlimited. */
    limit: number | null;
    /** What is left. null when the limit is unlimited. */
    remaining: number | null;
    /** Units taken from a balance, when the item charges for overage. */
    chargedUnits?: number;
    /** Why it was refused, when 'allowed' is false. */
    reason?: string;
  }

  /** The ledger entry a credit or debit wrote. */
  interface RxBalanceResult {
    /** Id of the ledger entry. */
    entryId: string;
    /** true when the idempotency key had already been used, so nothing moved. */
    duplicate: boolean;
    /** The balance after this entry. */
    balanceAfter: number;
  }

  /** The outcome of a topup purchase: the gate's verdict and what it credited. */
  interface RxTopupPurchase {
    /** Whether the gate passed. Nothing is credited when this is false. */
    eligible: boolean;
    /** Units credited. 0 when the purchase was refused. */
    credited: number;
    /** Key of the unit credited. */
    unit: string | null;
    /** The balance after the credit, or null when nothing was credited. */
    balanceAfter: number | null;
    /** The rules that refused the purchase, or null when it went through. */
    blockedBy: RxBlockedBy[] | null;
  }

  /** The subscription a plan grant created. */
  interface RxPlanGrant {
    /** Id of the new subscription. */
    subscriptionId: string;
    /** Key of the plan granted. */
    planKey: string;
  }

  /** Confirmation that a subscription was cancelled. */
  interface RxCancellation {
    /** Always true; a subscription that was not active throws instead. */
    canceled: boolean;
  }

  /** Confirmation that a test user was removed. */
  interface RxDeletion {
    /** Always true; an unknown or non-test user throws instead. */
    deleted: boolean;
  }

  /** The roles a user holds directly after a 'setRoles' call. */
  interface RxRoleAssignment {
    /** The role keys now held directly. Plan-granted roles are not listed. */
    roles: string[];
  }

  /** The allowance now in force for one user and one item. */
  interface RxUsageLimit {
    /** The override that was set. null means unlimited. */
    limit: number | null;
  }

  /** Where an adjustment left a balance. */
  interface RxBalanceAdjustment {
    /** The balance after the adjustment. */
    balanceAfter: number;
  }

  /** Where a test user's clock now stands. */
  interface RxClock {
    /** Milliseconds ahead of real time. Negative is in the past. */
    offsetMs: number;
  }

  /**
   * The application's configuration.
   *
   * Read from here rather than hard-coding a key: a suite that assumes a plan
   * named "pro" breaks the day somebody renames it. Check for an empty list and
   * return early when the thing under test does not exist yet.
   */
  interface RxConfig {
    /** Active plans. */
    plans(): Promise<RxCatalogPlan[]>;
    /** Active topup packs. */
    topups(): Promise<RxCatalogTopup[]>;
    /** Subscription roles. */
    roles(): Promise<RxRole[]>;
    /** Balance units. */
    units(): Promise<RxUnit[]>;
    /** Metered usage items. */
    usageItems(): Promise<RxUsageItem[]>;
  }

  /** Reading and reporting metered usage. */
  interface RxUsageApi {
    /**
     * Current usage for every metered item.
     * @param rxlabUserId The user to read.
     */
    get(rxlabUserId: string): Promise<RxUsageSnapshot>;

    /**
     * Report metered usage, as the application would.
     *
     * Does not throw when the item blocks — it returns 'allowed: false', so
     * assert on that rather than expecting a rejection.
     *
     * @param rxlabUserId The user consuming the item.
     * @param item The usage item's key.
     * @param amount Units to report. Defaults to 1.
     * @param options Idempotency and metadata.
     *
     * @example
     * const result = await rx.usage.record(user.rxlabUserId, "api_calls", 1);
     * expect(result.allowed).toBe(true);
     */
    record(
      rxlabUserId: string,
      item: string,
      amount?: number,
      options?: RxUsageOptions,
    ): Promise<RxUsageResult>;
  }

  /** Reading and moving balances. */
  interface RxBalancesApi {
    /**
     * Every balance the user holds.
     * @param rxlabUserId The user to read.
     */
    get(rxlabUserId: string): Promise<RxBalanceSnapshot>;

    /**
     * Add units.
     *
     * An idempotency key is generated per call unless you pass one, so a
     * repeated call credits again — pass a fixed key to test that it does not.
     *
     * @param rxlabUserId The user to credit.
     * @param unit The balance unit's key.
     * @param amount Units to add. Must be positive.
     * @param options Idempotency and the ledger description.
     */
    credit(
      rxlabUserId: string,
      unit: string,
      amount: number,
      options?: RxBalanceOptions,
    ): Promise<RxBalanceResult>;

    /**
     * Remove units.
     *
     * Rejects rather than overdrawing, so assert a refusal with
     * 'await expect(...).toReject()'.
     *
     * @param rxlabUserId The user to debit.
     * @param unit The balance unit's key.
     * @param amount Units to remove. Must be positive.
     * @param options Idempotency and the ledger description.
     */
    debit(
      rxlabUserId: string,
      unit: string,
      amount: number,
      options?: RxBalanceOptions,
    ): Promise<RxBalanceResult>;
  }

  /**
   * Disposable users.
   *
   * These are the only users a suite can touch. Naming a real subscriber is
   * refused by the server, so a test must create the users it needs. Every user
   * created during a run is deleted when it ends, unless the suite calls
   * 'rx.keepTestUsers()' — do not write cleanup code.
   */
  interface RxTestUsersApi {
    /**
     * Create a user, optionally already subscribed and holding a balance.
     *
     * @param input The starting state. Omit it for a bare user.
     *
     * @example
     * const user = await rx.testUsers.create({
     *   displayName: "Pro subscriber",
     *   planKey: "pro",
     *   unitKey: "points",
     *   amount: 500,
     * });
     */
    create(input?: RxTestUserInput): Promise<RxTestUser>;

    /** Every test user on this application, including ones from earlier runs. */
    list(): Promise<RxTestUser[]>;

    /**
     * Delete a user and its subscriptions, balances, and ledger history.
     * @param rxlabUserId The user to remove.
     */
    delete(rxlabUserId: string): Promise<RxDeletion>;

    /**
     * Subscribe without payment.
     *
     * The subscription gets the same frozen entitlement snapshot and period
     * balance grants a real purchase would produce, so what you assert
     * afterwards is what a paying subscriber would get.
     *
     * @param rxlabUserId The user to subscribe.
     * @param planKey From 'rx.config.plans()'.
     */
    grantPlan(rxlabUserId: string, planKey: string): Promise<RxPlanGrant>;

    /**
     * Cancel an active subscription.
     *
     * @param rxlabUserId The subscriber.
     * @param planKey Which subscription to end.
     * @param options Immediately by default.
     */
    cancelPlan(
      rxlabUserId: string,
      planKey: string,
      options?: RxCancelOptions,
    ): Promise<RxCancellation>;

    /**
     * Replace the roles held directly, ignoring anything a plan granted.
     *
     * The way to reach a permission-gated screen without buying anything.
     *
     * @param rxlabUserId The user to change.
     * @param roleKeys Every role the user should end up holding directly.
     */
    setRoles(rxlabUserId: string, roleKeys: string[]): Promise<RxRoleAssignment>;

    /**
     * Override this user's allowance for one usage item, up or down.
     *
     * Wins over the plan allowance in both directions, so a limit can be
     * lowered to the edge of the cap without touching the plan every other
     * subscriber is on.
     *
     * @param rxlabUserId The user to change.
     * @param itemKey From 'rx.config.usageItems()'.
     * @param limit The new allowance. null means unlimited.
     */
    setUsageLimit(
      rxlabUserId: string,
      itemKey: string,
      limit: number | null,
    ): Promise<RxUsageLimit>;

    /**
     * Move a balance by a signed amount.
     *
     * Goes through the ordinary ledger, so history looks real.
     *
     * @param rxlabUserId The user to change.
     * @param unitKey From 'rx.config.units()'.
     * @param delta Units to add. Negative removes. Must not be zero.
     * @param reason What the ledger entry says.
     */
    adjustBalance(
      rxlabUserId: string,
      unitKey: string,
      delta: number,
      reason?: string,
    ): Promise<RxBalanceAdjustment>;

    /**
     * Buy a topup without Stripe.
     *
     * The eligibility gate is evaluated exactly as checkout evaluates it, and
     * the units land only if it passes — so this asserts the gate and the
     * fulfillment together. A refusal is returned, not thrown.
     *
     * @param rxlabUserId The buyer.
     * @param topupKey From 'rx.config.topups()'.
     *
     * @example
     * const purchase = await rx.testUsers.buyTopup(user.rxlabUserId, "pro_pack");
     * expect(purchase.eligible).toBe(false);
     */
    buyTopup(rxlabUserId: string, topupKey: string): Promise<RxTopupPurchase>;

    /**
     * Set this user's clock, in milliseconds relative to real time.
     *
     * Only which period 'now' falls in changes; subscription dates and ledger
     * rows stay on the real timeline. This is how you cross a usage reset.
     *
     * @param rxlabUserId The user whose clock moves.
     * @param offsetMs Milliseconds ahead of real time. Negative is in the past.
     */
    setClock(rxlabUserId: string, offsetMs: number): Promise<RxClock>;

    /**
     * Jump the clock forward from wherever it is. Negative goes back.
     *
     * @param rxlabUserId The user whose clock moves.
     * @param ms How far to jump.
     *
     * @example
     * await rx.testUsers.advanceClock(user.rxlabUserId, 25 * 60 * 60 * 1000);
     */
    advanceClock(rxlabUserId: string, ms: number): Promise<RxClock>;
  }

  /**
   * The application under test, reached over its own public API.
   *
   * Every call is a real HTTP request to this deployment, authenticated with a
   * key that exists only for this run — the same surface a customer's backend
   * uses. There is no in-process shortcut, which is the point: a suite that
   * passes here is evidence about the API, not about the database.
   */
  interface RxClient {
    /**
     * Plans, roles, permissions, balances, and usage for one user, in one call.
     *
     * @param rxlabUserId From 'rx.testUsers.create()'.
     *
     * @example
     * const entitlements = await rx.entitlements(user.rxlabUserId);
     * expect(entitlements.roles).toContain("pro");
     */
    entitlements(rxlabUserId: string): Promise<RxEntitlements>;

    /**
     * The purchasable catalog.
     *
     * Pass a user and every topup carries its eligibility verdict, which is how
     * you assert that a gate holds without attempting a purchase.
     *
     * @param rxlabUserId Omit for the catalog with no eligibility verdicts.
     */
    catalog(rxlabUserId?: string): Promise<RxCatalog>;

    /** Reading and reporting metered usage. */
    usage: RxUsageApi;

    /** Reading and moving balances. */
    balances: RxBalancesApi;

    /** What this application is configured with. */
    config: RxConfig;

    /** Disposable users, and everything you can do to one. */
    testUsers: RxTestUsersApi;

    /**
     * Leave this run's test users in place for inspection on the Test tab.
     *
     * Off by default, and worth leaving off: a suite that keeps its users makes
     * the tab unusable within a day.
     */
    keepTestUsers(): void;
  }

  /** The application under test. See 'RxClient'. */
  const rx: RxClient;
}

export {};
`;

/** The suite a newly created file starts from. */
export const STARTER_SUITE = `suite("Subscription lifecycle", () => {
  test("a new user has no plan, no roles and no balance", async () => {
    const user = await rx.testUsers.create({ displayName: "Fresh signup" });

    const entitlements = await rx.entitlements(user.rxlabUserId);

    expect(entitlements.plans).toHaveLength(0);
    expect(entitlements.roles).toEqual([]);
  });

  test("granting a plan applies its entitlements", async () => {
    const plans = await rx.config.plans();
    if (plans.length === 0) {
      // Nothing to exercise yet — create a plan on the Plans tab first.
      return;
    }

    const user = await step("create a subscriber", () =>
      rx.testUsers.create({ displayName: "Subscriber" }),
    );

    await step("grant the plan", () =>
      rx.testUsers.grantPlan(user.rxlabUserId, plans[0].key),
    );

    const entitlements = await step("read entitlements", () =>
      rx.entitlements(user.rxlabUserId),
    );

    expect(entitlements.plans).toHaveLength(1);
    expect(entitlements.plans[0].key).toBe(plans[0].key);
  });
});
`;
