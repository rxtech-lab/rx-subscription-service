import { createServer } from "node:http";
import { E2E_STRIPE_URL } from "./fixtures";

const port = Number(new URL(E2E_STRIPE_URL).port);
let sequence = 0;

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200).end("ok");
    return;
  }

  request.resume();

  sequence += 1;
  const path = request.url?.split("?")[0];
  const payload =
    request.method === "POST" && path === "/v1/products"
      ? { id: `prod_e2e_${sequence}`, object: "product" }
      : request.method === "POST" && path === "/v1/prices"
        ? { id: `price_e2e_${sequence}`, object: "price" }
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
