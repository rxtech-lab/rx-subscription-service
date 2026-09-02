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
import { releaseBalanceReservation } from "@/lib/subscription/balance-reservations";

const schema = z.object({
  idempotencyKey: z.string().min(1).max(180),
  reason: z.string().min(1).max(200).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "balances.reservations.release");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid release request",
      );
    }
    const { id } = await params;
    await requireApiReservation(context, id);
    const result = await releaseBalanceReservation({
      applicationId: context.application.id,
      reservationId: id,
      reason: parsed.data.reason,
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
