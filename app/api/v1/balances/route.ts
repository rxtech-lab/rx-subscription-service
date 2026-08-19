import { z } from "zod";
import {
  apiError,
  ApiError,
  authenticateApiRequest,
  noStore,
  resolveRequestUser,
} from "@/lib/api/context";
import { getBalanceUnitByKey } from "@/lib/subscription/units";
import { creditBalance, debitBalance, getBalances } from "@/lib/subscription/users";
import { apiBalanceKey } from "@/lib/api/idempotency";

export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const url = new URL(request.url);
    const user = await resolveRequestUser(context, {
      rxlabUserId: url.searchParams.get("rxlabUserId") ?? undefined,
    });

    const balances = await getBalances(user.id);
    return Response.json(
      {
        balances: balances.map((balance) => ({
          unit: balance.unitKey,
          name: balance.unitName,
          amount: balance.amount,
          available: balance.amount - balance.reserved,
          precision: balance.precision,
        })),
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}

const schema = z.object({
  rxlabUserId: z.string().min(1),
  unit: z.string().min(1),
  amount: z.number().int().positive(),
  operation: z.enum(["credit", "debit"]),
  description: z.string().min(1).max(200).default("API adjustment"),
  idempotencyKey: z.string().min(1).max(180),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Move a user's balance.
 *
 * `idempotencyKey` is mandatory here — unlike metering, a repeated credit or
 * debit is never the intended outcome of a retry.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid balance request",
      );
    }

    const unit = await getBalanceUnitByKey(context.application.id, parsed.data.unit);
    if (!unit) {
      throw new ApiError(404, "unknown_unit", `No balance unit "${parsed.data.unit}"`);
    }

    const user = await resolveRequestUser(context, {
      rxlabUserId: parsed.data.rxlabUserId,
    });

    const mutation = {
      appUserId: user.id,
      unitId: unit.id,
      amount: parsed.data.amount,
      kind: parsed.data.operation === "credit" ? ("adjustment" as const) : ("usage" as const),
      description: parsed.data.description,
      idempotencyKey: apiBalanceKey(
        context.application.id,
        context.environment,
        parsed.data.idempotencyKey,
      ),
      referenceType: "api",
      referenceId: context.keyId,
      metadata: parsed.data.metadata ?? null,
    };

    const result =
      parsed.data.operation === "credit"
        ? await creditBalance(mutation)
        : await debitBalance(mutation);

    return Response.json(
      {
        entryId: result.entry.id,
        duplicate: result.duplicate,
        balanceAfter: result.entry.balanceAfter,
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
