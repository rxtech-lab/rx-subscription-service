import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
} from "@/lib/api/context";
import { apiReservationKey } from "@/lib/api/idempotency";
import { getBalanceReservationByIdempotencyKey } from "@/lib/subscription/balance-reservations";

const querySchema = z.object({
  idempotencyKey: z.string().min(1).max(180),
});

/** Recover a reservation when the caller retained its operation key, not its id. */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "balances.reservations.read");
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      idempotencyKey: url.searchParams.get("idempotencyKey") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "idempotencyKey is required",
      );
    }

    const reservation = await getBalanceReservationByIdempotencyKey(
      context.application.id,
      apiReservationKey(
        context.application.id,
        context.environment,
        parsed.data.idempotencyKey,
      ),
    );
    return Response.json({ reservation }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
