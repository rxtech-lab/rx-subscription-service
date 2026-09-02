import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
  resolveRequestUser,
} from "@/lib/api/context";
import { listPaymentHistory } from "@/lib/stripe/invoices";

const querySchema = z
  .object({
    rxlabUserId: z.string().min(1),
    after: z.string().min(1).max(255).optional(),
    before: z.string().min(1).max(255).optional(),
  })
  .refine((value) => !(value.after && value.before), {
    message: "after and before cannot be used together",
  });

/** Stripe-authoritative invoice history, including subscription renewals. */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "invoices.read");
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      rxlabUserId: url.searchParams.get("rxlabUserId") ?? undefined,
      after: url.searchParams.get("after") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid invoice query",
      );
    }

    const user = await resolveRequestUser(context, {
      rxlabUserId: parsed.data.rxlabUserId,
    });
    const history = await listPaymentHistory({
      appUserId: user.id,
      mode: context.environment === "sandbox" ? "sandbox" : "live",
      after: parsed.data.after,
      before: parsed.data.before,
    });
    const first = history.payments[0];
    const last = history.payments.at(-1);

    return Response.json(
      {
        invoices: history.payments.map((payment) => ({
          id: payment.id,
          number: payment.number,
          description: payment.description,
          status: payment.status,
          amountCents: payment.amountCents,
          currency: payment.currency,
          createdAt: payment.createdAt,
          hostedInvoiceUrl: payment.hostedInvoiceUrl,
          invoicePdfUrl: payment.invoicePdfUrl,
        })),
        pagination: {
          hasMore: history.hasMore,
          firstCursor: first?.id ?? null,
          lastCursor: last?.id ?? null,
        },
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
