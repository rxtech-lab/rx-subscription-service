import { z } from "zod";

/** A grant always names the data plane explicitly; production is never a default. */
export const complimentaryGrantSchema = z.object({
  appUserId: z.string().min(1),
  environment: z.enum(["sandbox", "production"]),
  planId: z.string().min(1),
  periodDays: z.number().int().min(1).max(3650)
    .describe("Days per complimentary access period starting when approved."),
  autoRenew: z.boolean().default(false)
    .describe("Renew complimentary access for another periodDays without charging, until canceled. Defaults to false."),
  reason: z.string().trim().min(1).max(500)
    .describe("Why this user is receiving complimentary access; recorded in the audit log."),
});
