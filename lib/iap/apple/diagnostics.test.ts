import { describe, expect, it } from "vitest";
import { appleDiagnosticFingerprint, appleTransactionDiagnostic, appleUserDiagnostic } from "./diagnostics";

describe("Apple account diagnostics", () => {
  it("correlates tokens without exposing tokens, transaction IDs or extra payload fields", () => {
    const token = "ABCDEF00-1234-4567-89AB-ABCDEF012345";
    const payload = {
      appAccountToken: token,
      transactionId: "2000000000000001",
      originalTransactionId: "2000000000000000",
      environment: "Sandbox",
      signedTransaction: "secret-signed-payload",
      email: "private@example.com",
    };
    const diagnostic = appleTransactionDiagnostic(payload);
    expect(diagnostic.accountTokenFingerprint).toBe(appleDiagnosticFingerprint(token.toLowerCase()));
    expect(diagnostic.environment).toBe("Sandbox");
    for (const value of [token, payload.transactionId, payload.originalTransactionId, payload.signedTransaction, payload.email]) {
      expect(JSON.stringify(diagnostic)).not.toContain(value);
    }
    expect(appleTransactionDiagnostic({}).accountTokenFingerprint).toBeNull();
  });

  it("distinguishes environment-specific rows for the same login without exposing the identity", () => {
    const user = { id: "sandbox-row", applicationId: "app", environment: "sandbox" as const, rxlabUserId: "private-login-identity", email: "private@example.com" };
    const sandbox = appleUserDiagnostic(user)!;
    const production = appleUserDiagnostic({ ...user, id: "production-row", environment: "production" })!;
    expect(sandbox.identityFingerprint).toBe(production.identityFingerprint);
    expect(sandbox.appUserId).not.toBe(production.appUserId);
    expect(sandbox.environment).not.toBe(production.environment);
    expect(JSON.stringify(sandbox)).not.toContain(user.rxlabUserId);
    expect(JSON.stringify(sandbox)).not.toContain(user.email);
    expect(appleUserDiagnostic(undefined)).toBeNull();
  });
});
