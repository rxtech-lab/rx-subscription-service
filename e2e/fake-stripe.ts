import { createServer } from "node:http";
import { E2E_STRIPE_URL } from "./fixtures";

const port = Number(new URL(E2E_STRIPE_URL).port);
let sequence = 0;
const coupons = new Map<string, Record<string, unknown>>();
const promotionCodes = new Map<string, Record<string, unknown>>();

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

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));

  sequence += 1;
  const url = new URL(request.url ?? "/", E2E_STRIPE_URL);
  const path = url.pathname;
  const couponId = path.startsWith("/v1/coupons/")
    ? decodeURIComponent(path.slice("/v1/coupons/".length))
    : null;
  const promotionCodeId = path.startsWith("/v1/promotion_codes/")
    ? decodeURIComponent(path.slice("/v1/promotion_codes/".length))
    : null;
  const couponMetadata = Object.fromEntries(
    [...form.entries()]
      .filter(([key]) => key.startsWith("metadata[") && key.endsWith("]"))
      .map(([key, value]) => [key.slice(9, -1), value]),
  );
  let couponPayload: Record<string, unknown> | null = null;
  let promotionCodePayload: Record<string, unknown> | null = null;
  if (request.method === "POST" && path === "/v1/coupons") {
    const id = form.get("id") ?? `coupon_e2e_${sequence}`;
    couponPayload = {
      id,
      object: "coupon",
      name: form.get("name"),
      metadata: couponMetadata,
    };
    coupons.set(id, couponPayload);
  } else if (couponId && request.method === "GET") {
    couponPayload = coupons.get(couponId) ?? null;
  } else if (couponId && request.method === "POST") {
    const existing = coupons.get(couponId) ?? {
      id: couponId,
      object: "coupon",
    };
    couponPayload = {
      ...existing,
      ...(form.has("name") ? { name: form.get("name") } : {}),
      ...(Object.keys(couponMetadata).length > 0
        ? { metadata: couponMetadata }
        : {}),
    };
    coupons.set(couponId, couponPayload);
  }
  if (request.method === "GET" && path === "/v1/promotion_codes") {
    const code = url.searchParams.get("code")?.toUpperCase();
    const customer = url.searchParams.get("customer");
    const active = url.searchParams.get("active");
    promotionCodePayload = {
      object: "list",
      data: [...promotionCodes.values()].filter(
        (promotionCode) =>
          (!code || String(promotionCode.code).toUpperCase() === code) &&
          (!customer || promotionCode.customer === customer) &&
          (active === null || String(promotionCode.active) === active),
      ),
      has_more: false,
      url: "/v1/promotion_codes",
    };
  } else if (request.method === "POST" && path === "/v1/promotion_codes") {
    const id = `promo_e2e_${sequence}`;
    promotionCodePayload = {
      id,
      object: "promotion_code",
      active: true,
      code: form.get("code"),
      customer: form.get("customer"),
      max_redemptions: form.has("max_redemptions")
        ? Number(form.get("max_redemptions"))
        : null,
      metadata: couponMetadata,
      promotion: {
        type: "coupon",
        coupon: form.get("promotion[coupon]"),
      },
      restrictions: {
        first_time_transaction:
          form.get("restrictions[first_time_transaction]") === "true",
        minimum_amount: form.has("restrictions[minimum_amount]")
          ? Number(form.get("restrictions[minimum_amount]"))
          : null,
        minimum_amount_currency:
          form.get("restrictions[minimum_amount_currency]") ?? null,
      },
      times_redeemed: 0,
    };
    promotionCodes.set(id, promotionCodePayload);
  } else if (promotionCodeId && request.method === "GET") {
    promotionCodePayload = promotionCodes.get(promotionCodeId) ?? null;
  } else if (promotionCodeId && request.method === "POST") {
    const existing = promotionCodes.get(promotionCodeId);
    if (existing) {
      promotionCodePayload = {
        ...existing,
        ...(form.has("active") ? { active: form.get("active") === "true" } : {}),
      };
      promotionCodes.set(promotionCodeId, promotionCodePayload);
    }
  }
  const payload =
    request.method === "GET" && path === "/v1/invoices"
      ? invoicePage(url)
      : request.method === "POST" && path === "/v1/products"
      ? { id: `prod_e2e_${sequence}`, object: "product" }
      : request.method === "POST" && path === "/v1/prices"
        ? { id: `price_e2e_${sequence}`, object: "price" }
        : request.method === "POST" && path === "/v1/customers"
          ? { id: `cus_e2e_${sequence}`, object: "customer" }
        : request.method === "POST" && path === "/v1/billing_portal/sessions"
          ? {
              id: `bps_e2e_${sequence}`,
              object: "billing_portal.session",
              url: `https://billing.stripe.test/${
                request.headers.authorization?.includes("sandbox")
                  ? "sandbox"
                  : "live"
              }`,
            }
        : couponPayload
          ? couponPayload
        : promotionCodePayload
          ? promotionCodePayload
        : request.method === "POST" && path === "/v1/checkout/sessions"
          ? {
              id: `cs_test_e2e_${sequence}`,
              object: "checkout.session",
              mode: "payment",
              payment_status: "unpaid",
              status: "open",
              url: `https://checkout.stripe.test/session/${sequence}${
                form.get("allow_promotion_codes") === "true"
                  ? `?promotion_codes=1&promotion_code=${
                      [...promotionCodes.values()].find(
                        (promotionCode) =>
                          promotionCode.customer === form.get("customer") &&
                          promotionCode.active === true,
                      )?.id ?? ""
                    }`
                  : ""
              }`,
            }
          : null;

  if (!payload) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: {
          type: "invalid_request_error",
          code: couponId || promotionCodeId ? "resource_missing" : undefined,
          message: "Unhandled E2E Stripe route",
        },
      }),
    );
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
