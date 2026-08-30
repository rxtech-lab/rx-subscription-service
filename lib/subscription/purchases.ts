import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { balanceUnits, purchases } from "@/lib/db/schema";

export async function listPurchaseHistory(input: {
  applicationId: string;
  appUserId: string;
  page: number;
  pageSize: number;
}) {
  const where = and(
    eq(purchases.applicationId, input.applicationId),
    eq(purchases.appUserId, input.appUserId),
  );
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(purchases)
    .where(where);
  const rows = await db
    .select({
      id: purchases.id,
      kind: purchases.kind,
      status: purchases.status,
      unit: balanceUnits.key,
      unitsGranted: purchases.unitsGranted,
      amountCents: purchases.amountCents,
      currency: purchases.currency,
      billingProvider: purchases.billingProvider,
      providerTransactionId: purchases.providerTransactionId,
      providerProductId: purchases.providerProductId,
      quantity: purchases.quantity,
      priceMilliunits: purchases.priceMilliunits,
      fulfillmentFailureCode: purchases.fulfillmentFailureCode,
      createdAt: purchases.createdAt,
      hostedInvoiceUrl: purchases.hostedInvoiceUrl,
      invoicePdfUrl: purchases.invoicePdfUrl,
    })
    .from(purchases)
    .leftJoin(balanceUnits, eq(purchases.unitId, balanceUnits.id))
    .where(where)
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  return {
    purchases: rows,
    total: count,
    page: input.page,
    pageSize: input.pageSize,
    pageCount: Math.ceil(count / input.pageSize),
  };
}
