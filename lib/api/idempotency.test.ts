import { describe, expect, it } from "vitest";
import {
  apiBalanceKey,
  apiReservationKey,
  apiReservationOperationKey,
  apiUsageKey,
  scopedApiUsageKey,
} from "./idempotency";

describe("API environment idempotency namespaces", () => {
  it("preserves existing production keys", () => {
    expect(apiBalanceKey("app-a", "production", " operation-1 ")).toBe(
      "api:app-a:operation-1",
    );
    expect(apiReservationKey("app-a", "production", "reserve-1")).toBe(
      "api:app-a:balance-reservation:reserve-1",
    );
    expect(
      apiReservationOperationKey("app-a", "production", "settle-1"),
    ).toBe("api:app-a:balance-reservation-operation:settle-1");
    expect(apiUsageKey("app-a", "production", "usage-1")).toBe("usage-1");
    expect(
      scopedApiUsageKey("app-a", "production", "user-a", "item-a", "usage-1"),
    ).toBe("api:app-a:usage:user-a:item-a:usage-1");
  });

  it("isolates sandbox keys from production", () => {
    expect(apiBalanceKey("app-a", "sandbox", "operation-1")).toBe(
      "api:app-a:sandbox:operation-1",
    );
    expect(apiReservationKey("app-a", "sandbox", "reserve-1")).toBe(
      "api:app-a:sandbox:balance-reservation:reserve-1",
    );
    expect(
      apiReservationOperationKey("app-a", "sandbox", "settle-1"),
    ).toBe("api:app-a:sandbox:balance-reservation-operation:settle-1");
    expect(apiUsageKey("app-a", "sandbox", "usage-1")).toBe(
      "api:app-a:sandbox:usage:usage-1",
    );
    expect(
      scopedApiUsageKey("app-a", "sandbox", "user-a", "item-a", "usage-1"),
    ).toBe("api:app-a:sandbox:usage:user-a:item-a:usage-1");
  });
});
