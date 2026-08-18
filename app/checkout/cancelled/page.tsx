/** The default `cancel_url` counterpart to `/checkout/success`. */
export default function CheckoutCancelledPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 text-center">
      <h1 className="text-base font-semibold text-slate-950">Checkout cancelled</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Nothing was charged. You can close this tab and return to the app.
      </p>
    </div>
  );
}
