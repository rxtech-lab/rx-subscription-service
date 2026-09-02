/**
 * Lives apart from `context.ts` so modules that context itself depends on —
 * user-token verification, key scoping — can raise API errors without pulling
 * the database and `server-only` in behind them.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
