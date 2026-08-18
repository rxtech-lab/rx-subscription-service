import { notFound } from "next/navigation";
import { startTestPlanCheckoutAction } from "@/app/actions/test-checkout";
import { ActionForm } from "@/components/forms/action-form";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { sandboxConfigured } from "@/lib/stripe/client";
import { resolveEntitlements } from "@/lib/subscription/entitlements";
import { listPurchasablePlans } from "@/lib/subscription/subscriptions";
import { readTestSessionFor } from "@/lib/test-session";
import { formatInterval, formatMoney } from "@/lib/utils";

export default async function TestPlansPage({
  params,
}: PageProps<"/test/[appId]/plans">) {
  const { appId } = await params;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  const [plans, entitlements] = await Promise.all([
    listPurchasablePlans(appId),
    resolveEntitlements({ applicationId: appId, appUserId: session.user.id }),
  ]);
  const subscribedPlanIds = new Set(entitlements.plans.map((plan) => plan.planId));
  const ready = sandboxConfigured();

  return (
    <Card>
      <CardHeader
        title="Plans"
        description="Checkout runs against the Stripe sandbox. Pay with test card 4242 4242 4242 4242, any future expiry, any CVC."
      />
      {plans.length === 0 ? (
        <EmptyState
          title="No plans available"
          description="Activate a plan in the console to see it here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {plans.map((plan) => {
            const subscribed = subscribedPlanIds.has(plan.id);
            return (
              <li
                key={plan.id}
                className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-slate-900">
                    {plan.name}
                    {subscribed ? <Badge tone="green">Subscribed</Badge> : null}
                  </p>
                  {plan.description ? (
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {plan.description}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-slate-700">
                    {formatMoney(plan.priceAmountCents, plan.currency)}{" "}
                    <span className="text-slate-500">
                      {formatInterval(plan.billingInterval, plan.intervalCount)}
                    </span>
                    {plan.trialDays > 0 ? (
                      <span className="ml-2 text-xs text-slate-500">
                        {plan.trialDays}-day trial
                      </span>
                    ) : null}
                  </p>
                </div>

                {subscribed || !ready ? (
                  <p className="text-xs text-slate-500">
                    {subscribed
                      ? "Already active"
                      : "Stripe sandbox is not configured."}
                  </p>
                ) : (
                  <ActionForm
                    action={startTestPlanCheckoutAction}
                    submitLabel="Subscribe"
                    pendingLabel="Opening Stripe…"
                    className="shrink-0"
                  >
                    <input type="hidden" name="planId" value={plan.id} />
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
