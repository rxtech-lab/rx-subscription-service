import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { sandboxConfigured } from "@/lib/stripe/client";
import { listPaymentHistory } from "@/lib/stripe/invoices";
import { readTestSessionFor } from "@/lib/test-session";
import { formatDate, formatMoney } from "@/lib/utils";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cursor(value: string | string[] | undefined) {
  const candidate = firstValue(value)?.trim();
  return candidate && candidate.length <= 255 ? candidate : undefined;
}

function pageNumber(value: string | string[] | undefined, hasCursor: boolean) {
  if (!hasCursor) return 1;
  const candidate = Number(firstValue(value));
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : 1;
}

function paymentHistoryHref(
  appId: string,
  input: { page: number; after?: string; before?: string },
) {
  const query = new URLSearchParams({ page: String(input.page) });
  if (input.after) query.set("after", input.after);
  if (input.before) query.set("before", input.before);
  return `/test/${encodeURIComponent(appId)}/payments?${query}`;
}

function invoiceStatusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "draft" || status === "open") return "amber" as const;
  if (status === "uncollectible") return "red" as const;
  return "neutral" as const;
}

export default async function TestPaymentsPage({
  params,
  searchParams,
}: PageProps<"/test/[appId]/payments">) {
  const { appId } = await params;
  const query = await searchParams;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  const after = cursor(query.after);
  const before = after ? undefined : cursor(query.before);
  const currentPage = pageNumber(query.page, Boolean(after || before));
  const ready = sandboxConfigured();
  const history = ready
    ? await listPaymentHistory({
        appUserId: session.user.id,
        mode: "sandbox",
        after,
        before,
      })
    : { payments: [], hasMore: false };
  const baseHref = `/test/${encodeURIComponent(appId)}/payments`;

  if (history.payments.length === 0 && (after || before)) {
    redirect(baseHref);
  }

  const firstPayment = history.payments[0];
  const lastPayment = history.payments.at(-1);
  // A backwards request necessarily came from a later page, even if Stripe's
  // `has_more` flag describes only the older direction of the returned list.
  const hasNext = Boolean(before) || history.hasMore;
  const hasPrevious = currentPage > 1;

  return (
    <Card>
      <CardHeader
        title="Payment history"
        description="Invoices from the Stripe sandbox, including subscription renewals and one-time purchases."
      />
      {!ready ? (
        <EmptyState
          title="Stripe sandbox is not configured"
          description="Configure the sandbox account to load invoice history."
        />
      ) : history.payments.length === 0 ? (
        <EmptyState
          title="No payments yet"
          description="Completed subscriptions and one-time purchases will appear here."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Description</Th>
                <Th>Status</Th>
                <Th>Amount</Th>
                <Th>Date</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {history.payments.map((payment) => (
                <tr key={payment.id}>
                  <Td>
                    <span className="font-mono text-xs text-slate-600">
                      {payment.number ?? payment.id}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-medium text-slate-900">
                      {payment.description}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={invoiceStatusTone(payment.status)}>
                      {payment.status}
                    </Badge>
                  </Td>
                  <Td>{formatMoney(payment.amountCents, payment.currency)}</Td>
                  <Td>
                    <span className="text-xs text-slate-500">
                      {formatDate(payment.createdAt)}
                    </span>
                  </Td>
                  <Td>
                    {payment.invoiceUrl ? (
                      <a
                        href={payment.invoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                      >
                        View invoice
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">Unavailable</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {hasPrevious || hasNext ? (
            <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-500">
              <span>Page {currentPage}</span>
              <div className="flex gap-3">
                {hasPrevious && firstPayment ? (
                  <Link
                    href={paymentHistoryHref(appId, {
                      page: currentPage - 1,
                      before: firstPayment.id,
                    })}
                    className="underline hover:text-slate-900"
                  >
                    Previous
                  </Link>
                ) : null}
                {hasNext && lastPayment ? (
                  <Link
                    href={paymentHistoryHref(appId, {
                      page: currentPage + 1,
                      after: lastPayment.id,
                    })}
                    className="underline hover:text-slate-900"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
