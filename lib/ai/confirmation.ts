import { z } from "zod";

export const confirmationInputSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(120)
      .describe("Short title for the decision"),
    description: z
      .string()
      .min(1)
      .max(600)
      .describe("Plain-language description of what the user is confirming"),
  })
  .strict();
