import {
  createCouponAction,
  deleteCouponAction,
  setCouponStatusAction,
  updateCouponAction,
} from "@/app/actions/coupons";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import {
  CouponFields,
  EMPTY_COUPON,
  type CouponDefaults,
  type CouponFieldOption,
} from "@/components/forms/coupon-fields";
import { ActionMenu, ActionMenuDivider } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import type { Coupon } from "@/lib/db/schema";
import { describeCoupon } from "@/lib/subscription/coupon-rules";
import {
  couponTerms,
  couponUsage,
  listCoupons,
  listCouponTargets,
  listCouponUsers,
} from "@/lib/subscription/coupons";
import { listPlans } from "@/lib/subscription/plans";
import { listTopupProducts } from "@/lib/subscription/topups";
import { listAppUserOptions } from "@/lib/subscription/users";
import { formatDate, formatMoney } from "@/lib/utils";

function toDefaults(
  coupon: Coupon,
  planIds: string[],
  topupProductIds: string[],
  appUserIds: string[],
): CouponDefaults {
  return {
    name: coupon.name,
    description: coupon.description ?? "",
    discountType: coupon.discountType,
    percentOff:
      coupon.percentBasisPoints === null ? "" : String(coupon.percentBasisPoints / 100),
    amountOff:
      coupon.amountOffCents === null ? "" : (coupon.amountOffCents / 100).toFixed(2),
    currency: coupon.currency,
    maxDiscount:
      coupon.maxDiscountCents === null ? "" : (coupon.maxDiscountCents / 100).toFixed(2),
    duration: coupon.duration,
    durationInMonths: String(coupon.durationInMonths ?? 3),
    appliesTo: coupon.appliesTo,
    planIds,
    topupProductIds,
    restrictToUsers: coupon.restrictToUsers,
    appUserIds,
    maxRedemptions: coupon.maxRedemptions === null ? "" : String(coupon.maxRedemptions),
    maxRedemptionsPerUser:
      coupon.maxRedemptionsPerUser === null ? "" : String(coupon.maxRedemptionsPerUser),
    minimumAmount:
      coupon.minimumAmountCents === null
        ? ""
        : (coupon.minimumAmountCents / 100).toFixed(2),
    firstTimeOnly: coupon.firstTimeOnly,
    startsAt: coupon.startsAt?.toISOString() ?? "",
    redeemBy: coupon.redeemBy?.toISOString() ?? "",
  };
}

export default async function CouponsPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [coupons, plans, topups, users] = await Promise.all([
    listCoupons(appId, { includeArchived: true }),
    listPlans(appId, { includeArchived: true }),
    listTopupProducts(appId, { includeArchived: true }),
    listAppUserOptions(appId, { includeTest: true }),
  ]);

  const detail = new Map(
    await Promise.all(
      coupons.map(async (coupon) => {
        const [targets, allowed, usage] = await Promise.all([
          listCouponTargets(coupon.id),
          listCouponUsers(coupon.id),
          couponUsage(coupon.id),
        ]);
        return [
          coupon.id,
          {
            planIds: targets
              .map((target) => target.planId)
              .filter((id): id is string => Boolean(id)),
            topupProductIds: targets
              .map((target) => target.topupProductId)
              .filter((id): id is string => Boolean(id)),
            appUserIds: allowed.map((row) => row.appUserId),
            usage,
          },
        ] as const;
      }),
    ),
  );

  const planOptions: CouponFieldOption[] = plans.map((plan) => ({
    id: plan.id,
    label: plan.name,
  }));
  const topupOptions: CouponFieldOption[] = topups.map((topup) => ({
    id: topup.id,
    label: topup.name,
  }));
  const userOptions: CouponFieldOption[] = users.map((user) => ({
    id: user.id,
    label: user.displayName ?? user.email ?? user.rxlabUserId,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Coupons"
          description="Discount codes belonging to this application. A code is validated against this app's coupons only, and the Stripe coupon it mints is pinned to this app's products — so a code from another app can never be redeemed here."
        />
        {coupons.length === 0 ? (
          <EmptyState
            title="No coupons yet"
            description="Create one below. It starts as a draft; publish it when you are ready for it to be redeemable."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Discount</Th>
                <Th>Applies to</Th>
                <Th>Used</Th>
                <Th>Window</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => {
                const info = detail.get(coupon.id)!;
                const restrictions = [
                  coupon.maxRedemptionsPerUser === null
                    ? null
                    : `${coupon.maxRedemptionsPerUser}/user`,
                  coupon.restrictToUsers
                    ? `${info.appUserIds.length} named user${info.appUserIds.length === 1 ? "" : "s"}`
                    : null,
                  coupon.firstTimeOnly ? "first purchase" : null,
                  coupon.minimumAmountCents === null
                    ? null
                    : `min ${formatMoney(coupon.minimumAmountCents, coupon.currency)}`,
                ].filter(Boolean);

                return (
                  <tr key={coupon.id}>
                    <Td>
                      <p className="font-mono font-medium text-neutral-900">
                        {coupon.code}
                      </p>
                      <p className="text-xs text-neutral-500">{coupon.name}</p>
                    </Td>
                    <Td>
                      <p className="text-sm text-neutral-700">
                        {describeCoupon(couponTerms(coupon))}
                      </p>
                      {restrictions.length > 0 ? (
                        <p className="mt-1 text-xs text-neutral-500">
                          {restrictions.join(" · ")}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      {coupon.appliesTo === "all" ? (
                        <span className="text-xs text-neutral-500">Everything</span>
                      ) : (
                        <span className="text-xs text-neutral-700">
                          {info.planIds.length} plan
                          {info.planIds.length === 1 ? "" : "s"},{" "}
                          {info.topupProductIds.length} topup
                          {info.topupProductIds.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {info.usage.redeemed}
                      {coupon.maxRedemptions === null
                        ? ""
                        : ` / ${coupon.maxRedemptions}`}
                      {info.usage.used > info.usage.redeemed ? (
                        <span className="ml-1 text-xs text-neutral-500">
                          (+{info.usage.used - info.usage.redeemed} held)
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="text-xs text-neutral-600">
                        {coupon.startsAt ? formatDate(coupon.startsAt) : "now"} →{" "}
                        {coupon.redeemBy ? formatDate(coupon.redeemBy) : "no end"}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(coupon.status)}>{coupon.status}</Badge>
                    </Td>
                    <Td>
                      <ActionMenu label={`Actions for ${coupon.code}`}>
                        <FormDialog
                          triggerLabel="Edit"
                          title={`Edit ${coupon.code}`}
                          description="The code, the discount type, and the currency are fixed once a coupon exists — everything else can change, and takes effect on the next redemption."
                          icon="edit"
                          triggerVariant="menu"
                          triggerSize="sm"
                          size="lg"
                        >
                          <ActionForm
                            action={updateCouponAction}
                            submitLabel="Save coupon"
                          >
                            <input type="hidden" name="applicationId" value={appId} />
                            <input type="hidden" name="couponId" value={coupon.id} />
                            <CouponFields
                              defaults={toDefaults(
                                coupon,
                                info.planIds,
                                info.topupProductIds,
                                info.appUserIds,
                              )}
                              plans={planOptions}
                              topups={topupOptions}
                              users={userOptions}
                              lockDiscountType
                            />
                          </ActionForm>
                        </FormDialog>

                        <InlineActionButton
                          action={setCouponStatusAction}
                          label={coupon.status === "active" ? "Unpublish" : "Publish"}
                          variant="menu"
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input type="hidden" name="couponId" value={coupon.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={coupon.status === "active" ? "draft" : "active"}
                          />
                        </InlineActionButton>

                        {coupon.status === "archived" ? null : (
                          <InlineActionButton
                            action={setCouponStatusAction}
                            label="Archive"
                            variant="menu"
                          >
                            <input type="hidden" name="applicationId" value={appId} />
                            <input type="hidden" name="couponId" value={coupon.id} />
                            <input type="hidden" name="status" value="archived" />
                          </InlineActionButton>
                        )}

                        <ActionMenuDivider />

                        <InlineActionButton
                          action={deleteCouponAction}
                          label="Delete"
                          variant="menuDanger"
                          confirmMessage="Delete this coupon?"
                        >
                          <input type="hidden" name="applicationId" value={appId} />
                          <input type="hidden" name="couponId" value={coupon.id} />
                        </InlineActionButton>
                      </ActionMenu>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="flex justify-end">
        <FormDialog
          triggerLabel="New coupon"
          title="Create a coupon"
          description="The code is what a buyer types. It only has to be unique within this application."
          size="lg"
        >
          <ActionForm action={createCouponAction} submitLabel="Create coupon">
            <input type="hidden" name="applicationId" value={appId} />
            <div className="mt-4">
              <Field label="Code" hint="Letters, digits, - and _. Case-insensitive.">
                <Input name="code" required placeholder="LAUNCH25" />
              </Field>
            </div>
            <CouponFields
              defaults={EMPTY_COUPON}
              plans={planOptions}
              topups={topupOptions}
              users={userOptions}
            />
          </ActionForm>
        </FormDialog>
      </div>
    </div>
  );
}
