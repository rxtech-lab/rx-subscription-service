import "server-only";

export function isAuthorizedE2EHeaders(headers: Pick<Headers, "get">): boolean {
  const secret = process.env.E2E_SECRET?.trim();
  return (
    process.env.IS_E2E === "true" &&
    Boolean(secret) &&
    headers.get("x-e2e-secret") === secret
  );
}

export function isAuthorizedE2ERequest(request: Request): boolean {
  return isAuthorizedE2EHeaders(request.headers);
}

export function e2eNotFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}
