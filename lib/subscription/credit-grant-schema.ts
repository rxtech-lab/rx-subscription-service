import { z } from "zod";

export const userCreditGrantSchema = z.object({
  appUserId: z.string().min(1),
  environment: z.enum(["sandbox", "production"]),
  unitId: z.string().min(1),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    .describe("Amount to add in the unit's smallest stored denomination; scale by 10^precision."),
  reason: z.string().trim().min(1).max(500)
    .describe("Reason for this credit grant, recorded in the ledger and audit log."),
});
