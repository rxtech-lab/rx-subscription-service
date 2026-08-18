import { processStripeWebhook } from "@/lib/stripe/webhook";

/**
 * The sandbox account's endpoint. It is a separate Stripe account with its own
 * signing secret, so it needs its own URL — the live endpoint would reject these
 * signatures, and accepting them there would let sandbox events mutate live data.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const result = await processStripeWebhook(rawBody, signature, "sandbox");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // A 400 tells Stripe to retry; the dedupe table makes that safe.
    console.error("Stripe sandbox webhook error:", error);
    return Response.json(
      { error: "webhook_failed" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
