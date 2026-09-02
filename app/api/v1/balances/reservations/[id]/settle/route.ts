import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  requireApiReservation,
  requireKeyScope,
} from "@/lib/api/context";
import { apiReservationOperationKey } from "@/lib/api/idempotency";
import { settleBalanceReservation } from "@/lib/subscription/balance-reservations";

const schema = z.object({
  amount: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(180),
  final: z.boolean().default(false),
  description: z.string().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "balances.reservations.settle");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid settle request",
      );
    }
    const { id } = await params;
    await requireApiReservation(context, id);
    const result = await settleBalanceReservation({
      applicationId: context.application.id,
      reservationId: id,
      amount: parsed.data.amount,
      final: parsed.data.final,
      description: parsed.data.description,
      metadata: parsed.data.metadata ?? null,
      idempotencyKey: apiReservationOperationKey(
        context.application.id,
        context.environment,
        parsed.data.idempotencyKey,
      ),
    });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
