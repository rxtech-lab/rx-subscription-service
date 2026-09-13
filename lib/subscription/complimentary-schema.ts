import { z } from "zod";

/** A grant always names the data plane explicitly; production is never a default. */
export const complimentaryGrantSchema = z.object({
  appUserId: z.string().min(1),
  environment: z.enum(["sandbox", "production"]),
  planId: z.string().min(1),
  periodDays: z.number().int().min(1).max(3650)
    .describe("Days of complimentary access starting when approved. No automatic renewal."),
  reason: z.string().trim().min(1).max(500)
    .describe("Why this user is receiving complimentary access; recorded in the audit log."),
});
