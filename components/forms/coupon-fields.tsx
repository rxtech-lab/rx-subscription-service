"use client";

import { useEffect, useRef, useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";

export interface CouponFieldOption {
  id: string;
  label: string;
}

export interface CouponDefaults {
  name: string;
  description: string;
  discountType: "percent" | "amount";
  /** A percentage as a person writes it — 25.5, not 2550. */
  percentOff: string;
  amountOff: string;
  currency: string;
  maxDiscount: string;
  duration: "once" | "repeating" | "forever";
  durationInMonths: string;
  appliesTo: "all" | "selected";
  planIds: string[];
  topupProductIds: string[];
  restrictToUsers: boolean;
  appUserIds: string[];
  maxRedemptions: string;
  maxRedemptionsPerUser: string;
  minimumAmount: string;
  firstTimeOnly: boolean;
  startsAt: string;
  redeemBy: string;
}

export const EMPTY_COUPON: CouponDefaults = {
  name: "",
  description: "",
  discountType: "percent",
  percentOff: "",
  amountOff: "",
  currency: "usd",
  maxDiscount: "",
  duration: "once",
  durationInMonths: "3",
  appliesTo: "all",
  planIds: [],
  topupProductIds: [],
  restrictToUsers: false,
  appUserIds: [],
  maxRedemptions: "",
  maxRedemptionsPerUser: "",
  minimumAmount: "",
  firstTimeOnly: false,
  startsAt: "",
  redeemBy: "",
};

/**
 * The coupon form.
 *
 * Three fields only make sense in one shape — the percentage, the flat amount,
 * and the repeating month count — so they appear and disappear with the choice
 * above them rather than sitting greyed out. The discount type is fixed after
 * creation because a Stripe coupon cannot change between percentage and amount.
 */
export function CouponFields({
  defaults,
  plans,
  topups,
  users,
  lockDiscountType = false,
}: {
  defaults: CouponDefaults;
  plans: CouponFieldOption[];
  topups: CouponFieldOption[];
  users: CouponFieldOption[];
  lockDiscountType?: boolean;
}) {
  const [discountType, setDiscountType] = useState(defaults.discountType);
  const [duration, setDuration] = useState(defaults.duration);
  const [appliesTo, setAppliesTo] = useState(defaults.appliesTo);
  const [restrictUsers, setRestrictUsers] = useState(defaults.restrictToUsers);
  const startsAtRef = useRef<HTMLInputElement>(null);
  const redeemByRef = useRef<HTMLInputElement>(null);
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);

  // `datetime-local` deliberately carries no zone. Populate it only after the
  // browser is known, and submit that browser's offset alongside it so a UTC
  // deployment stores the same instant the person picked.
  useEffect(() => {
    const toLocalInput = (value: string) => {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const offset = date.getTimezoneOffset() * 60_000;
      return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    };

    if (startsAtRef.current) startsAtRef.current.value = toLocalInput(defaults.startsAt);
    if (redeemByRef.current) redeemByRef.current.value = toLocalInput(defaults.redeemBy);
    if (timezoneOffsetRef.current) {
      timezoneOffsetRef.current.value = String(new Date().getTimezoneOffset());
    }
  }, [defaults.redeemBy, defaults.startsAt]);

  return (
    <div className="mt-4 space-y-3">
      <input
        type="hidden"
        name="timezoneOffsetMinutes"
        defaultValue=""
        ref={timezoneOffsetRef}
      />
      <Field label="Name">
        <Input name="name" defaultValue={defaults.name} required placeholder="Launch week" />
      </Field>
      <Field label="Description">
        <Textarea name="description" rows={2} defaultValue={defaults.description} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Discount type">
          <Select
            name="discountType"
            value={discountType}
            disabled={lockDiscountType}
            onChange={(event) =>
              setDiscountType(event.target.value as "percent" | "amount")
            }
          >
            <option value="percent">Percentage off</option>
            <option value="amount">Fixed amount off</option>
          </Select>
        </Field>
        {discountType === "percent" ? (
          <Field label="Percent off" hint="Up to two decimals, e.g. 25.5">
            <Input
              name="percentOff"
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              defaultValue={defaults.percentOff}
              required
            />
          </Field>
        ) : (
          <Field label="Amount off">
            <Input
              name="amountOff"
              type="number"
              step="0.01"
              min="0.01"
              defaultValue={defaults.amountOff}
              required
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Currency">
          <Input
            name="currency"
            defaultValue={defaults.currency}
            maxLength={3}
            disabled={lockDiscountType}
          />
        </Field>
        <Field
          label="Max discount"
          hint={
            discountType === "percent"
              ? "Caps what one charge can be discounted by."
              : "Rarely needed for a fixed amount."
          }
        >
          <Input
            name="maxDiscount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={defaults.maxDiscount}
          />
        </Field>
        <Field label="Minimum order" hint="Below this, the code will not apply.">
          <Input
            name="minimumAmount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaults.minimumAmount}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Lasts for">
          <Select
            name="duration"
            value={duration}
            onChange={(event) =>
              setDuration(event.target.value as "once" | "repeating" | "forever")
            }
          >
            <option value="once">The first charge only</option>
            <option value="repeating">A number of months</option>
            <option value="forever">Every charge, forever</option>
          </Select>
        </Field>
        {duration === "repeating" ? (
          <Field label="Months" hint="Counted from the first charge.">
            <Input
              name="durationInMonths"
              type="number"
              min="1"
              defaultValue={defaults.durationInMonths}
              required
            />
          </Field>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Total redemptions" hint="Leave empty for unlimited.">
          <Input
            name="maxRedemptions"
            type="number"
            min="1"
            defaultValue={defaults.maxRedemptions}
          />
        </Field>
        <Field label="Redemptions per user" hint="Leave empty for unlimited.">
          <Input
            name="maxRedemptionsPerUser"
            type="number"
            min="1"
            defaultValue={defaults.maxRedemptionsPerUser}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts" hint="Optional.">
          <Input
            name="startsAt"
            type="datetime-local"
            defaultValue=""
            ref={startsAtRef}
          />
        </Field>
        <Field label="Expires" hint="Optional.">
          <Input
            name="redeemBy"
            type="datetime-local"
            defaultValue=""
            ref={redeemByRef}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="firstTimeOnly"
          defaultChecked={defaults.firstTimeOnly}
          className="size-4 rounded border-slate-300"
        />
        First purchase only
      </label>

      <Field label="Applies to">
        <Select
          name="appliesTo"
          value={appliesTo}
          onChange={(event) => setAppliesTo(event.target.value as "all" | "selected")}
        >
          <option value="all">Everything in this app</option>
          <option value="selected">Only the plans and topups I pick</option>
        </Select>
      </Field>

      {appliesTo === "selected" ? (
        <div className="grid grid-cols-2 gap-3">
          <CheckboxGroup
            legend="Plans"
            name="planIds"
            options={plans}
            selected={defaults.planIds}
            empty="No plans yet."
          />
          <CheckboxGroup
            legend="Topups"
            name="topupProductIds"
            options={topups}
            selected={defaults.topupProductIds}
            empty="No topups yet."
          />
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="restrictToUsers"
          checked={restrictUsers}
          onChange={(event) => setRestrictUsers(event.target.checked)}
          className="size-4 rounded border-slate-300"
        />
        Only specific users may redeem it
      </label>

      {restrictUsers ? (
        <CheckboxGroup
          legend="Allowed users"
          name="appUserIds"
          options={users}
          selected={defaults.appUserIds}
          empty="No users yet."
        />
      ) : null}
    </div>
  );
}

function CheckboxGroup({
  legend,
  name,
  options,
  selected,
  empty,
}: {
  legend: string;
  name: string;
  options: CouponFieldOption[];
  selected: string[];
  empty: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-semibold text-slate-700">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-slate-500">{empty}</p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {options.map((option) => (
            <label
              key={option.id}
              className="flex items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                name={name}
                value={option.id}
                defaultChecked={selected.includes(option.id)}
                className="size-4 rounded border-slate-300"
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
