export interface AnalyticsSubscription {
  id: string;
  appUserId: string;
  planGroup: string;
  autoSubscribe: boolean;
  planPriceAmountCents: number;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
}

/** An ended row is churn only when access in its plan group stops or falls
 * back to an automatic free tier. Use historical coverage, not today's status,
 * so a later cancellation does not turn an earlier upgrade into churn.
 */
export function cancellationSubscriptions<T extends AnalyticsSubscription>(rows: T[]): T[] {
  const byUserAndGroup = new Map<string, T[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.appUserId, row.planGroup]);
    const group = byUserAndGroup.get(key) ?? [];
    group.push(row);
    byUserAndGroup.set(key, group);
  }
  return rows.filter((row) => {
    const end = row.endedAt;
    if (!end || !["canceled", "expired"].includes(row.status)) return false;
    const group = byUserAndGroup.get(JSON.stringify([row.appUserId, row.planGroup]))!;
    return !group.some((other) =>
      other.id !== row.id && other.status !== "incomplete" &&
      !(other.autoSubscribe && other.planPriceAmountCents === 0) &&
      other.startedAt <= end && (other.endedAt === null || other.endedAt > end),
    );
  });
}
