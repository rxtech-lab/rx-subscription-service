import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stripeCustomers } from "@/lib/db/schema";
import { stripe, type StripeMode } from "./client";

export const PAYMENT_HISTORY_PAGE_SIZE = 10;

export interface PaymentHistoryItem {
  id: string;
  number: string | null;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: Date;
  invoiceUrl: string | null;
}

function invoiceDescription(invoice: {
  description: string | null;
  lines: { data: { description: string | null }[] };
}) {
  if (invoice.description) return invoice.description;

  const descriptions = invoice.lines.data
    .map((line) => line.description?.trim())
    .filter((description): description is string => Boolean(description));
  if (descriptions.length === 0) return "Payment";
  if (descriptions.length === 1) return descriptions[0];
  return `${descriptions[0]} + ${descriptions.length - 1} more`;
}

/**
 * Read a user's invoices from the Stripe account that actually processed them.
 *
 * Subscription renewals do not have local purchase rows, so Stripe is the
 * authoritative source for this customer-facing history. Cursors are passed
 * through from Stripe to keep pagination stable as new invoices arrive.
 */
export async function listPaymentHistory(input: {
  appUserId: string;
  mode: StripeMode;
  after?: string;
  before?: string;
}) {
  const [customer] = await db
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.appUserId, input.appUserId))
    .limit(1);

  if (!customer) {
    return { payments: [] as PaymentHistoryItem[], hasMore: false };
  }

  const invoices = await stripe(input.mode).invoices.list({
    customer: customer.stripeCustomerId,
    limit: PAYMENT_HISTORY_PAGE_SIZE,
    ...(input.after
      ? { starting_after: input.after }
      : input.before
        ? { ending_before: input.before }
        : {}),
  });

  return {
    payments: invoices.data.map((invoice): PaymentHistoryItem => ({
      id: invoice.id,
      number: invoice.number,
      description: invoiceDescription(invoice),
      amountCents: invoice.total,
      currency: invoice.currency,
      status: invoice.status ?? "unknown",
      createdAt: new Date(invoice.created * 1_000),
      invoiceUrl: invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? null,
    })),
    hasMore: invoices.has_more,
  };
}
