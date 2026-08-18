import { createServer } from "node:http";
import { E2E_STRIPE_URL } from "./fixtures";

const port = Number(new URL(E2E_STRIPE_URL).port);
let sequence = 0;

const invoices = Array.from({ length: 12 }, (_, index) => {
  const ordinal = index + 1;
  const padded = String(ordinal).padStart(2, "0");
  return {
    id: `in_e2e_${padded}`,
    object: "invoice",
    number: `TEST-${padded}`,
    status: "paid",
    total: 1_000 + index * 100,
    currency: "usd",
    created: 1_787_000_000 - index * 86_400,
    hosted_invoice_url: `https://invoice.stripe.test/in_e2e_${padded}`,
    invoice_pdf: `https://invoice.stripe.test/in_e2e_${padded}.pdf`,
    description: null,
    lines: {
      object: "list",
      data: [
        {
          id: `il_e2e_${padded}`,
          object: "line_item",
          description: `Test payment ${ordinal}`,
        },
      ],
      has_more: false,
      url: `/v1/invoices/in_e2e_${padded}/lines`,
    },
  };
});

function invoicePage(url: URL) {
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(100, Math.max(1, requestedLimit))
    : 10;
  const after = url.searchParams.get("starting_after");
  const before = url.searchParams.get("ending_before");

  if (before) {
    const end = Math.max(0, invoices.findIndex((invoice) => invoice.id === before));
    const start = Math.max(0, end - limit);
    return {
      object: "list",
      data: invoices.slice(start, end),
      has_more: end < invoices.length,
      url: "/v1/invoices",
    };
  }

  const start = after
    ? Math.max(0, invoices.findIndex((invoice) => invoice.id === after) + 1)
    : 0;
  const end = Math.min(invoices.length, start + limit);
  return {
    object: "list",
    data: invoices.slice(start, end),
    has_more: end < invoices.length,
    url: "/v1/invoices",
  };
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200).end("ok");
    return;
  }

  request.resume();

  sequence += 1;
  const url = new URL(request.url ?? "/", E2E_STRIPE_URL);
  const path = url.pathname;
  const payload =
    request.method === "GET" && path === "/v1/invoices"
      ? invoicePage(url)
      : request.method === "POST" && path === "/v1/products"
      ? { id: `prod_e2e_${sequence}`, object: "product" }
      : request.method === "POST" && path === "/v1/prices"
        ? { id: `price_e2e_${sequence}`, object: "price" }
        : request.method === "POST" && path === "/v1/customers"
          ? { id: `cus_e2e_${sequence}`, object: "customer" }
        : request.method === "POST" && path === "/v1/checkout/sessions"
          ? {
              id: `cs_test_e2e_${sequence}`,
              object: "checkout.session",
              mode: "payment",
              payment_status: "unpaid",
              status: "open",
              url: `https://checkout.stripe.test/session/${sequence}`,
            }
          : null;

  if (!payload) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Unhandled E2E Stripe route" } }));
    return;
  }

  response.writeHead(200, {
    "content-type": "application/json",
    "request-id": `req_e2e_${sequence}`,
  });
  response.end(JSON.stringify(payload));
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
