import { z } from "zod";
import { apiError, authenticateApiRequest } from "@/lib/api/context";
import { e2eNotFound, isAuthorizedE2ERequest } from "@/lib/e2e/request";
import { mintTestSession } from "@/lib/test-session";
import {
  createTestUser,
  setTestUserRoles,
  setTestUserUsageLimit,
} from "@/lib/subscription/test-users";

const schema = z.object({
  displayName: z.string().min(1),
  roleIds: z.array(z.string().min(1)).optional(),
  usageLimit: z
    .object({
      usageItemId: z.string().min(1),
      limitValue: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});

/**
 * Stand in for the console Test tab in Playwright tests: create a test user
 * with the roles and allowances a console admin would give it, and hand back a
 * storefront session token so the browser can act as that user.
 */
export async function POST(request: Request) {
  if (!isAuthorizedE2ERequest(request)) return e2eNotFound();

  try {
    const context = await authenticateApiRequest(request);
    const input = schema.parse(await request.json());
    const actor = { type: "system" as const, id: null };

    const user = await createTestUser({
      applicationId: context.application.id,
      displayName: input.displayName,
      actor,
    });

    if (input.roleIds?.length) {
      await setTestUserRoles({
        applicationId: context.application.id,
        appUserId: user.id,
        roleIds: input.roleIds,
        actor,
      });
    }

    if (input.usageLimit) {
      await setTestUserUsageLimit({
        applicationId: context.application.id,
        appUserId: user.id,
        usageItemId: input.usageLimit.usageItemId,
        limitValue: input.usageLimit.limitValue,
        actor,
      });
    }

    return Response.json({
      appUserId: user.id,
      rxlabUserId: user.rxlabUserId,
      sessionToken: await mintTestSession({
        applicationId: context.application.id,
        appUserId: user.id,
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
