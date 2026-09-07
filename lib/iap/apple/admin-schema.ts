import { z } from "zod";

export const appleTokenActionSchema = z.object({
  appUserId: z.string().min(1),
  environment: z.enum(["xcode", "sandbox", "production"]),
  operation: z.enum(["create", "bind", "remove", "repair"]),
  // Optimistic concurrency: empty means the console showed no mapping.
  expectedToken: z.union([z.uuid(), z.literal("")]),
  token: z.uuid().optional(),
  originalTransactionId: z.string().regex(/^\d{1,32}$/).optional(),
  acknowledged: z.literal(true),
}).superRefine((value, ctx) => {
  if (value.operation === "bind" && !value.token) ctx.addIssue({ code: "custom", message: "Enter the token UUID to bind", path: ["token"] });
  if (value.operation === "repair" && (!value.originalTransactionId || value.environment === "xcode")) ctx.addIssue({ code: "custom", message: "Apple repair requires an original transaction ID and sandbox or production", path: ["originalTransactionId"] });
});
