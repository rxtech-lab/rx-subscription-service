import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  resolveRequestUser,
} from "@/lib/api/context";
import { apiReservationKey } from "@/lib/api/idempotency";
import {
  DEFAULT_RESERVATION_TTL_SECONDS,
  MAX_RESERVATION_TTL_SECONDS,
  reserveBalance,
} from "@/lib/subscription/balance-reservations";
import { getBalanceUnitByKey } from "@/lib/subscription/units";

const schema = z.object({
  rxlabUserId: z.string().min(1),
  unit: z.string().min(1),
  amount: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(180),
  description: z.string().min(1).max(200).default("Balance reservation"),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresInSeconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_RESERVATION_TTL_SECONDS)
    .default(DEFAULT_RESERVATION_TTL_SECONDS),
});

export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid reservation request",
      );
    }

    const unit = await getBalanceUnitByKey(context.application.id, parsed.data.unit);
    if (!unit) {
      throw new ApiError(404, "unknown_unit", `No balance unit "${parsed.data.unit}"`);
    }
    const user = await resolveRequestUser(context, {
      rxlabUserId: parsed.data.rxlabUserId,
    });

    const result = await reserveBalance({
      applicationId: context.application.id,
      appUserId: user.id,
      unitId: unit.id,
      amount: parsed.data.amount,
      description: parsed.data.description,
      idempotencyKey: apiReservationKey(
        context.application.id,
        parsed.data.idempotencyKey,
      ),
      metadata: parsed.data.metadata ?? null,
      expiresInSeconds: parsed.data.expiresInSeconds,
    });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
