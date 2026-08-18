import { processStripeWebhook } from "@/lib/stripe/webhook";

/**
 * Stripe needs the raw body to verify the signature, so this stays a route
 * handler rather than a server action.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const result = await processStripeWebhook(rawBody, signature);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // A 400 tells Stripe to retry; the dedupe table makes that safe.
    console.error("Stripe webhook error:", error);
    return Response.json(
      { error: "webhook_failed" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
