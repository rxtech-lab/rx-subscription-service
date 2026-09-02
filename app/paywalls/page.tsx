import Link from "next/link";
import { ArrowUpRight, Smartphone } from "lucide-react";
import {
  createPaywallAction,
  deletePaywallAction,
  duplicatePaywallAction,
  renamePaywallAction,
} from "@/app/actions/paywalls";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ConsoleHeader } from "@/components/console/console-header";
import { ActionMenu, ActionMenuDivider } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { requireConsoleUser } from "@/lib/console/session";
import { listPaywalls } from "@/lib/paywall/paywalls";
import { TEMPLATE_KEYS, TEMPLATES } from "@/lib/paywall/templates";
import { formatDate } from "@/lib/utils";

function CreatePaywallDialog() {
  return (
    <FormDialog
      triggerLabel="New paywall"
      title="Create a paywall"
      description="Start from a template. You can change everything in the editor, or ask the agent to."
    >
      <ActionForm action={createPaywallAction} submitLabel="Create" autoComplete="off">
        <div className="space-y-4">
          <Field label="Name">
            <Input name="name" required maxLength={120} placeholder="Onboarding paywall" />
          </Field>
          <Field label="Description" hint="Optional. Shown in the list.">
            <Input name="description" maxLength={200} />
          </Field>
          <Field label="Template">
            <Select name="template" defaultValue="classic">
              {TEMPLATE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {TEMPLATES[key].name} — {TEMPLATES[key].description}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </ActionForm>
    </FormDialog>
  );
}

export default async function PaywallsPage() {
  const user = await requireConsoleUser();

  const paywalls = await listPaywalls();
  const displayName = user.name || user.email || "Admin";

  return (
    <div className="min-h-full bg-[#f7f8fc]">
      <ConsoleHeader displayName={displayName} email={user.email} />

      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              <Smartphone className="size-3.5 text-blue-600" aria-hidden="true" />
              Shared library
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
              Paywalls
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-base">
              Templates any application can show. Design one here, publish it, then pick it on
              an application&apos;s Paywall page — the app fetches the published version with
              its own plans filled in.
            </p>
          </div>
          <div className="shrink-0">
            <CreatePaywallDialog />
          </div>
        </div>

        <div className="mt-10">
          {paywalls.length === 0 ? (
            <Card className="border-dashed py-8">
              <EmptyState
                title="No paywalls yet"
                description="Create one from a template, then open it in the editor."
              />
            </Card>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paywalls.map((paywall) => {
                const published = Boolean(paywall.publishedSpec && paywall.publishedAt);
                const stale =
                  published &&
                  JSON.stringify(paywall.draftSpec) !== JSON.stringify(paywall.publishedSpec);
                return (
                  <li key={paywall.id}>
                    <Card className="flex h-full flex-col p-5">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={`/paywalls/${paywall.id}`}
                          prefetch={false}
                          className="group min-w-0 flex-1"
                        >
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-950 group-hover:text-blue-700">
                            {paywall.name}
                            <ArrowUpRight
                              className="size-3.5 shrink-0 text-slate-300 transition group-hover:text-blue-600"
                              aria-hidden="true"
                            />
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            {paywall.description || "No description."}
                          </p>
                        </Link>
                        <ActionMenu label={`Actions for ${paywall.name}`}>
                          <FormDialog
                            triggerLabel="Rename"
                            title={`Rename ${paywall.name}`}
                            icon="edit"
                            size="sm"
                            triggerVariant="menu"
                            triggerSize="sm"
                          >
                            <ActionForm action={renamePaywallAction} submitLabel="Save" autoComplete="off">
                              <input type="hidden" name="paywallId" value={paywall.id} />
                              <div className="space-y-4">
                                <Field label="Name">
                                  <Input name="name" required maxLength={120} defaultValue={paywall.name} />
                                </Field>
                                <Field label="Description" hint="Optional.">
                                  <Textarea
                                    name="description"
                                    rows={2}
                                    maxLength={200}
                                    defaultValue={paywall.description ?? ""}
                                  />
                                </Field>
                              </div>
                            </ActionForm>
                          </FormDialog>
                          <InlineActionButton
                            action={duplicatePaywallAction}
                            label="Duplicate"
                            variant="menu"
                            pendingLabel="Duplicating…"
                          >
                            <input type="hidden" name="paywallId" value={paywall.id} />
                          </InlineActionButton>
                          <ActionMenuDivider />
                          <InlineActionButton
                            action={deletePaywallAction}
                            label="Delete"
                            variant="menuDanger"
                            pendingLabel="Deleting…"
                            confirmMessage={
                              paywall.usedBy > 0
                                ? `Delete "${paywall.name}"? ${paywall.usedBy} application${
                                    paywall.usedBy === 1 ? "" : "s"
                                  } will stop showing a paywall.`
                                : `Delete "${paywall.name}"? This cannot be undone.`
                            }
                          >
                            <input type="hidden" name="paywallId" value={paywall.id} />
                          </InlineActionButton>
                        </ActionMenu>
                      </div>

                      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5 text-xs text-slate-500">
                        {published ? (
                          <Badge tone="green">Published</Badge>
                        ) : (
                          <Badge tone="amber">Draft</Badge>
                        )}
                        {stale ? <Badge tone="blue">Unpublished changes</Badge> : null}
                        <span className="ml-auto">
                          {paywall.usedBy === 0
                            ? "Not used yet"
                            : `Used by ${paywall.usedBy} app${paywall.usedBy === 1 ? "" : "s"}`}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        {published
                          ? `Published ${formatDate(paywall.publishedAt)}`
                          : `Updated ${formatDate(paywall.updatedAt)}`}
                      </p>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
