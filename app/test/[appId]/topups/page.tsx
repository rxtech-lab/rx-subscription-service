import { notFound } from "next/navigation";
import { startTestTopupCheckoutAction } from "@/app/actions/test-checkout";
import { ActionForm } from "@/components/forms/action-form";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { sandboxConfigured } from "@/lib/stripe/client";
import {
  checkTopupEligibility,
  listTopupProducts,
  type EligibilityResult,
} from "@/lib/subscription/topups";
import { listBalanceUnits } from "@/lib/subscription/units";
import { readTestSessionFor } from "@/lib/test-session";
import { formatMoney } from "@/lib/utils";

/** Turn a failed gate into something a subscriber would understand. */
function blockedReason(failed: EligibilityResult["failed"]): string {
  const reasons = failed.map((rule) => {
    if (rule.ruleType === "requires_any_plan") return "an active subscription";
    if (rule.ruleType === "requires_active_plan") return "a specific plan";
    return "a subscription role";
  });
  return `Requires ${[...new Set(reasons)].join(" and ")}.`;
}

export default async function TestTopupsPage({
  params,
}: PageProps<"/test/[appId]/topups">) {
  const { appId } = await params;
  const session = await readTestSessionFor(appId);
  if (!session) notFound();

  const [products, units] = await Promise.all([
    listTopupProducts(appId),
    listBalanceUnits(appId),
  ]);
  const active = products.filter((product) => product.status === "active");
  const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));

  // Eligibility is evaluated per pack, exactly as checkout will evaluate it, so
  // the badge and the purchase outcome can never disagree.
  const eligibility = await Promise.all(
    active.map((product) =>
      checkTopupEligibility({
        applicationId: appId,
        topupId: product.id,
        appUserId: session.user.id,
      }),
    ),
  );
  const ready = sandboxConfigured();

  return (
    <Card>
      <CardHeader
        title="Topups"
        description="One-time packs of balance units. Gated packs unlock when you hold the plan or role they require."
      />
      {active.length === 0 ? (
        <EmptyState
          title="No topups available"
          description="Activate a topup pack in the console to see it here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {active.map((product, index) => {
            const result = eligibility[index];
            return (
              <li
                key={product.id}
                className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-slate-900">
                    {product.name}
                    {result.eligible ? null : <Badge tone="amber">Locked</Badge>}
                  </p>
                  {product.description ? (
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {product.description}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-slate-700">
                    {formatMoney(product.priceAmountCents, product.currency)}{" "}
                    <span className="text-slate-500">
                      for {product.amount.toLocaleString()}{" "}
                      {unitNames.get(product.unitId) ?? "units"}
                    </span>
                  </p>
                  {result.eligible ? null : (
                    <p className="mt-1 text-xs text-amber-700">
                      {blockedReason(result.failed)}
                    </p>
                  )}
                </div>

                {!result.eligible ? null : !ready ? (
                  <p className="text-xs text-slate-500">
                    Stripe sandbox is not configured.
                  </p>
                ) : (
                  <ActionForm
                    action={startTestTopupCheckoutAction}
                    submitLabel="Buy"
                    pendingLabel="Opening Stripe…"
                    className="shrink-0"
                  >
                    <input type="hidden" name="topupId" value={product.id} />
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
