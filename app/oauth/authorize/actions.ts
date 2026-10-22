"use server";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import {
  getManagedApplications,
  requireConsoleUser,
} from "@/lib/console/session";
import { authorize, origin, validateAuthorization } from "@/lib/mcp/oauth";
import { scopesSchema } from "@/lib/mcp/scopes";
export async function loginForMcp(query: string) {
  await validateAuthorization(new URLSearchParams(query));
  await signIn("rxlab", { redirectTo: `/oauth/authorize?${query}` });
}
export async function decide(query: string, form: FormData) {
  const user = await requireConsoleUser();
  const params = new URLSearchParams(query);
  const request = await validateAuthorization(params);
  const target = new URL(request.redirectUri);
  if (request.state !== null) target.searchParams.set("state", request.state);
  target.searchParams.set("iss", origin());
  if (form.get("decision") === "deny")
    target.searchParams.set("error", "access_denied");
  else {
    const scopes = scopesSchema.parse(form.getAll("scopes"));
    const ids = form.getAll("applicationIds").map(String);
    const managed = await getManagedApplications();
    if (ids.some((id) => !managed.some((app) => app.id === id)))
      throw new Error("Project access denied");
    const code = await authorize(params, user.id, user.accessToken, scopes, [
      ...new Set(ids),
    ]);
    target.searchParams.set("code", code);
  }
  redirect(target.toString());
}
