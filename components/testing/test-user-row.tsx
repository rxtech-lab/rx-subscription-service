"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import {
  adjustTestBalanceAction,
  cancelTestSubscriptionAction,
  deleteTestUserAction,
  grantTestSubscriptionAction,
  setTestUserUsageLimitAction,
  updateTestUserAction,
} from "@/app/actions/test-users";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu, ActionMenuDivider } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Badge,
  Field,
  Input,
  Select,
  Td,
  statusTone,
} from "@/components/ui/primitives";
import {
  planOption,
  TestUserFields,
  type Plan,
  type Role,
  type Unit,
  type UsageItem,
} from "@/components/testing/test-user-fields";
import type { ApiEnvironment } from "@/lib/db/schema";
import { describeClockOffset } from "@/lib/subscription/test-clock";
import type { TestUserIdentity } from "@/lib/subscription/test-users";
import { formatDate } from "@/lib/utils";

const ENVIRONMENT_LABELS: Record<ApiEnvironment, string> = {
  sandbox: "Sandbox",
  xcode: "Xcode",
  production: "Production",
};

/** Left to right, least to most production-like. */
const ENVIRONMENT_ORDER: ApiEnvironment[] = ["sandbox", "xcode", "production"];

/**
 * One rxlab identity, with its per-environment records behind a switcher.
 *
 * Every cell and every action below reads from the selected record: the
 * environments are separate data planes, so a balance, a subscription or a
 * deletion belongs to exactly one of them and must never be shown, or applied,
 * as if it covered both.
 */
export function TestUserRow({
  appId,
  identity,
  plans,
  units,
  roles,
  usageItems,
}: {
  appId: string;
  identity: TestUserIdentity;
  plans: Plan[];
  units: Unit[];
  roles: Role[];
  usageItems: UsageItem[];
}) {
  // `records` is newest-first, so the row opens on whichever environment was
  // touched most recently.
  const [selectedId, setSelectedId] = useState(identity.records[0].user.id);
  const summary =
    identity.records.find((record) => record.user.id === selectedId) ??
    identity.records[0];
  const { user, subscriptions, balances, usageLimits } = summary;
  const heldRoles = summary.roles;
  const active = subscriptions.filter((subscription) =>
    ["active", "trialing", "past_due"].includes(subscription.status),
  );
  const tabs = [...identity.records].sort(
    (a, b) =>
      ENVIRONMENT_ORDER.indexOf(a.user.environment) -
      ENVIRONMENT_ORDER.indexOf(b.user.environment),
  );

  return (
    <tr>
      <Td>
        <p className="font-medium text-neutral-900">{user.displayName || "Unnamed"}</p>
        {user.testNote ? (
          <p className="text-xs text-neutral-500">{user.testNote}</p>
        ) : null}
        <p className="font-mono text-xs text-neutral-400">{identity.rxlabUserId}</p>
        {tabs.length === 1 ? (
          <Badge className="mt-1.5" tone={user.environment === "xcode" ? "blue" : "neutral"}>
            {ENVIRONMENT_LABELS[user.environment]}
          </Badge>
        ) : (
          <div
            role="group"
            aria-label={`Environment for ${user.displayName || identity.rxlabUserId}`}
            className="mt-1.5 inline-flex rounded-lg bg-slate-100 p-0.5"
          >
            {tabs.map((record) => {
              const selected = record.user.id === user.id;
              return (
                <button
                  key={record.user.id}
                  type="button"
                  onClick={() => setSelectedId(record.user.id)}
                  aria-pressed={selected}
                  className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                    selected
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {ENVIRONMENT_LABELS[record.user.environment]}
                </button>
              );
            })}
          </div>
        )}
      </Td>
      <Td>
        {subscriptions.length === 0 ? (
          <span className="text-xs text-neutral-400">None</span>
        ) : (
          <div className="space-y-1">
            {subscriptions.map((subscription) => (
              <div key={subscription.id} className="flex items-center gap-2">
                <Badge tone={statusTone(subscription.status)}>
                  {subscription.status}
                </Badge>
                <span className="text-xs text-neutral-600">
                  {subscription.planName}
                </span>
              </div>
            ))}
          </div>
        )}
      </Td>
      <Td>
        {heldRoles.length === 0 &&
        usageLimits.length === 0 &&
        user.testClockOffsetMs === 0 ? (
          <span className="text-xs text-neutral-400">None</span>
        ) : (
          <div className="space-y-1">
            {heldRoles.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {heldRoles.map((role) => (
                  <Badge key={role.roleId} tone="blue">
                    {role.key}
                  </Badge>
                ))}
              </div>
            ) : null}
            {usageLimits.map((limit) => (
              <p key={limit.usageItemId} className="text-xs text-neutral-600">
                {limit.itemName}:{" "}
                {limit.limitValue === null
                  ? "unlimited"
                  : limit.limitValue.toLocaleString()}
              </p>
            ))}
            {user.testClockOffsetMs === 0 ? null : (
              // Worth surfacing: usage on this row is being read against a
              // clock that is not the wall clock.
              <p className="text-xs text-amber-700">
                Clock {describeClockOffset(user.testClockOffsetMs)}
              </p>
            )}
          </div>
        )}
      </Td>
      <Td>
        {balances.length === 0 ? (
          <span className="text-xs text-neutral-400">None</span>
        ) : (
          <div className="space-y-0.5">
            {balances.map((balance) => (
              <p key={balance.unitKey} className="text-xs text-neutral-600">
                {balance.amount.toLocaleString()} {balance.unitName}
              </p>
            ))}
          </div>
        )}
      </Td>
      <Td>
        {user.level}
        {user.levelKey ? (
          <span className="ml-1 text-xs text-neutral-500">({user.levelKey})</span>
        ) : null}
      </Td>
      <Td>
        <span className="text-xs text-neutral-500">{formatDate(user.createdAt)}</span>
      </Td>
      <Td>
        <ActionMenu
          label={`Actions for ${user.displayName || "test user"} in ${ENVIRONMENT_LABELS[user.environment]}`}
        >
          <Link
            href={`/apps/${encodeURIComponent(appId)}/users/${encodeURIComponent(user.id)}?environment=${encodeURIComponent(user.environment)}`}
            className="flex w-full items-center justify-start gap-2 rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
          >
            View {user.environment === "xcode" ? "Xcode" : "sandbox"} data
          </Link>
          <a
            href={`/apps/${appId}/users/${user.id}/test-session`}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-start gap-2 rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Test user
          </a>

          <ActionMenuDivider />

          <FormDialog
            triggerLabel="Edit"
            title={`Edit ${user.displayName || "test user"}`}
            icon="edit"
            triggerVariant="menu"
            triggerSize="sm"
          >
            <ActionForm
              action={updateTestUserAction}
              submitLabel="Save"
              autoComplete="off"
            >
              <input type="hidden" name="applicationId" value={appId} />
              <input type="hidden" name="appUserId" value={user.id} />
              <TestUserFields
                plans={plans}
                units={units}
                roles={roles}
                usageItems={usageItems}
                user={user}
                roleIds={heldRoles.map((role) => role.roleId)}
              />
            </ActionForm>
          </FormDialog>

          {plans.length > 0 ? (
            <FormDialog
              triggerLabel="Grant subscription"
              title="Grant a subscription"
              description="Creates the subscription directly, with no payment."
              icon="plus"
              triggerVariant="menu"
              triggerSize="sm"
              size="sm"
            >
              <ActionForm action={grantTestSubscriptionAction} submitLabel="Grant">
                <input type="hidden" name="applicationId" value={appId} />
                <input type="hidden" name="appUserId" value={user.id} />
                <Field label="Plan">
                  <Select name="planId" required>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {planOption(plan)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
            </FormDialog>
          ) : null}

          {usageItems.length > 0 ? (
            <FormDialog
              triggerLabel="Usage limit"
              title="Set a usage limit"
              description="Overrides the plan allowance for this user only, up or down."
              icon="edit"
              triggerVariant="menu"
              triggerSize="sm"
              size="sm"
            >
              <ActionForm action={setTestUserUsageLimitAction} submitLabel="Save limit">
                <input type="hidden" name="applicationId" value={appId} />
                <input type="hidden" name="appUserId" value={user.id} />
                <div className="space-y-4">
                  <Field label="Usage item">
                    <Select name="usageItemId" required>
                      {usageItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.defaultLimit === null
                            ? " · default unlimited"
                            : ` · default ${item.defaultLimit}`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Allowance">
                    <Select name="limitMode" defaultValue="limited">
                      <option value="limited">Set a limit</option>
                      <option value="unlimited">Unlimited</option>
                      <option value="default">Remove override (use the plan)</option>
                    </Select>
                  </Field>
                  <Field label="Limit" hint="Used when the allowance is a set limit.">
                    <Input
                      name="limitValue"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue={0}
                    />
                  </Field>
                </div>
              </ActionForm>
            </FormDialog>
          ) : null}

          {units.length > 0 ? (
            <FormDialog
              triggerLabel="Adjust balance"
              title="Adjust balance"
              icon="edit"
              triggerVariant="menu"
              triggerSize="sm"
              size="sm"
            >
              <ActionForm action={adjustTestBalanceAction} submitLabel="Apply">
                <input type="hidden" name="applicationId" value={appId} />
                <input type="hidden" name="appUserId" value={user.id} />
                <div className="space-y-4">
                  <Field label="Unit">
                    <Select name="unitId" required>
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Delta" hint="Negative to debit. Must be non-zero.">
                    <Input name="delta" type="number" step="1" required />
                  </Field>
                  <Field label="Reason">
                    <Input name="reason" defaultValue="Test adjustment" />
                  </Field>
                </div>
              </ActionForm>
            </FormDialog>
          ) : null}

          {active.map((subscription) => (
            <InlineActionButton
              key={subscription.id}
              action={cancelTestSubscriptionAction}
              label={`Cancel ${subscription.planName}`}
              variant="menu"
            >
              <input type="hidden" name="applicationId" value={appId} />
              <input type="hidden" name="appUserId" value={user.id} />
              <input type="hidden" name="subscriptionId" value={subscription.id} />
              <input type="hidden" name="immediately" value="true" />
            </InlineActionButton>
          ))}

          <ActionMenuDivider />

          <InlineActionButton
            action={deleteTestUserAction}
            label={
              tabs.length === 1
                ? "Delete test user"
                : `Delete ${ENVIRONMENT_LABELS[user.environment]} test user`
            }
            variant="menuDanger"
            confirmMessage={
              tabs.length === 1
                ? "Delete this test user? Its subscriptions, balances and ledger history are removed."
                : `Delete this test user's ${ENVIRONMENT_LABELS[user.environment]} data? Its subscriptions, balances and ledger history are removed, and its other environments are left alone.`
            }
          >
            <input type="hidden" name="applicationId" value={appId} />
            <input type="hidden" name="appUserId" value={user.id} />
          </InlineActionButton>
        </ActionMenu>
      </Td>
    </tr>
  );
}
