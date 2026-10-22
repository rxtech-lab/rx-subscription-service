"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { mcpGrants } from "@/lib/db/schema";
import {
  getManagedApplications,
  requireConsoleUser,
} from "@/lib/console/session";
import { scopesSchema } from "@/lib/mcp/scopes";
import { seal } from "@/lib/mcp/oauth";
export async function updateConnection(id: string, form: FormData) {
  try {
    const user = await requireConsoleUser();
    const where = and(
      eq(mcpGrants.id, id),
      eq(mcpGrants.userId, user.id),
      isNull(mcpGrants.revokedAt),
    );
    if (form.get("operation") === "disconnect") {
      const changed = await db
        .update(mcpGrants)
        .set({ revokedAt: new Date() })
        .where(where)
        .returning({ id: mcpGrants.id });
      if (!changed.length) return { error: "Connection not found" };
    } else {
      const scopes = scopesSchema.parse(form.getAll("scopes"));
      const ids = [...new Set(form.getAll("applicationIds").map(String))];
      const apps = await getManagedApplications();
      if (ids.some((id) => !apps.some((app) => app.id === id)))
        return { error: "Project access denied" };
      const changed = await db
        .update(mcpGrants)
        .set({
          scopes,
          applicationIds: ids,
          upstreamToken: seal(user.accessToken),
        })
        .where(where)
        .returning({ id: mcpGrants.id });
      if (!changed.length) return { error: "Connection not found" };
    }
    revalidatePath("/settings");
    return {
      success:
        form.get("operation") === "disconnect"
          ? "Client disconnected"
          : "Client access updated",
    };
  } catch {
    return {
      error:
        "Could not update client access. Select at least one scope and try again.",
    };
  }
}
