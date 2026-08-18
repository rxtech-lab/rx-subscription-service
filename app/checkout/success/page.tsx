/**
 * The default `success_url` for API-created Checkout sessions.
 *
 * Applications normally pass their own `successUrl`; this exists so the fallback
 * in `redirectUrls()` lands somewhere real rather than on a 404.
 */
export default function CheckoutSuccessPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 text-center">
      <h1 className="text-base font-semibold text-slate-950">Payment complete</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Your purchase was received. You can close this tab and return to the app —
        entitlements update as soon as Stripe confirms the payment.
      </p>
    </div>
  );
}
