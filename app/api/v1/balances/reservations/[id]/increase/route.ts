import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
} from "@/lib/api/context";
import { apiReservationOperationKey } from "@/lib/api/idempotency";
import { increaseBalanceReservation } from "@/lib/subscription/balance-reservations";

const schema = z.object({
  amount: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(180),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await authenticateApiRequest(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid increase request",
      );
    }
    const { id } = await params;
    const result = await increaseBalanceReservation({
      applicationId: context.application.id,
      reservationId: id,
      amount: parsed.data.amount,
      idempotencyKey: apiReservationOperationKey(
        context.application.id,
        parsed.data.idempotencyKey,
      ),
    });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
