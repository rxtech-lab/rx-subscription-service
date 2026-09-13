import { z } from "zod";
import { apiError, authenticateApiRequest } from "@/lib/api/context";
import { buildTools } from "@/lib/ai/tools";
import { e2eNotFound, isAuthorizedE2ERequest } from "@/lib/e2e/request";
import { userCreditGrantSchema } from "@/lib/subscription/credit-grant-schema";
import { complimentaryGrantSchema } from "@/lib/subscription/complimentary-schema";

/** Exercise the real registered chat tool, without an external model, only in E2E. */
export async function POST(request: Request) {
  if (!isAuthorizedE2ERequest(request)) return e2eNotFound();
  try {
    const context = await authenticateApiRequest(request);
    const input = z.discriminatedUnion("name", [
      z.object({ name: z.literal("grantComplimentarySubscription"), args: complimentaryGrantSchema, operationId: z.string().min(1) }),
      z.object({ name: z.literal("grantUserCredits"), args: userCreditGrantSchema, operationId: z.string().min(1) }),
    ]).parse(await request.json());
    const tools = buildTools(context.application.id, { type: "ai", id: "e2e-admin" });
    if (tools[input.name].needsApproval !== true) throw new Error("Grant tool must require approval");
    const options = { toolCallId: input.operationId, messages: [] };
    const result = input.name === "grantUserCredits"
      ? await tools.grantUserCredits.execute!(input.args, options)
      : await tools.grantComplimentarySubscription.execute!(input.args, options);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}


export async function GET(request: Request) {
  if (!isAuthorizedE2ERequest(request)) return e2eNotFound();
  try {
    const context = await authenticateApiRequest(request);
    const url = new URL(request.url);
    const environment = complimentaryGrantSchema.shape.environment.parse(url.searchParams.get("environment"));
    const tools = buildTools(context.application.id, { type: "ai", id: "e2e-admin" });
    const options = { toolCallId: "e2e-read", messages: [] };
    const users = await tools.listSubscriptionUsers.execute!({ environment, search: url.searchParams.get("search") ?? undefined }, options);
    const analytics = await tools.getAnalytics.execute!({}, options);
    return Response.json({ users, analytics });
  } catch (error) { return apiError(error); }
}
