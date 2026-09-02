import {
  apiError,
  authenticateApiRequest,
  noStore,
  requireApiReservation,
  requireKeyScope,
} from "@/lib/api/context";
import { getBalanceReservation } from "@/lib/subscription/balance-reservations";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "balances.reservations.read");
    const { id } = await params;
    await requireApiReservation(context, id);
    const reservation = await getBalanceReservation(context.application.id, id);
    return Response.json({ reservation }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
