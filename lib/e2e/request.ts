import "server-only";

export function isAuthorizedE2ERequest(request: Request): boolean {
  const secret = process.env.E2E_SECRET?.trim();
  return (
    process.env.IS_E2E === "true" &&
    Boolean(secret) &&
    request.headers.get("x-e2e-secret") === secret
  );
}

export function e2eNotFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}
