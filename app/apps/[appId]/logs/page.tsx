import { ApplicationLogTable } from "@/components/console/application-log-table";
import Link from "next/link";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { applicationLogFilters, logCategories, listApplicationLogs } from "@/lib/application-logs";

export default async function ApplicationLogsPage({ params, searchParams }: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { appId } = await params;
  await requireApplicationAccess(appId);
  const query = await searchParams;
  const categoryResult = applicationLogFilters.shape.category.safeParse(query.category);
  const category = categoryResult.success ? categoryResult.data : undefined;
  const environment = query.environment === "sandbox" || query.environment === "production" || query.environment === "xcode" ? query.environment : undefined;
  const level = query.level === "info" || query.level === "error" || query.level === "warn" ? query.level : undefined;
  const transactionId = typeof query.transactionId === "string" ? query.transactionId.trim().slice(0, 128) : undefined;
  const textFilter = (name: string) => typeof query[name] === "string" ? query[name].trim().slice(0, 128) || undefined : undefined;
  const action = textFilter("action"), entityType = textFilter("entityType"), entityId = textFilter("entityId");
  const parsedOffset = Number(query.offset ?? 0);
  const offset = Number.isInteger(parsedOffset) && parsedOffset >= 0 && parsedOffset <= 100000 ? parsedOffset : 0;
  const { logs, nextOffset } = await listApplicationLogs(appId, { category, environment, level, transactionId: transactionId || undefined, action, entityType, entityId, offset });
  const pageLink = (next: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ category, environment, level, transactionId, action, entityType, entityId })) if (value) params.set(key, value);
    params.set("offset", String(next));
    return `?${params}`;
  };
  return <Card>
    <CardHeader title="App logs" />
    <div className="space-y-5 p-5">
      <p className="text-sm text-neutral-600">Recorded activity across this app, including subscriptions, usage, configuration, administrator changes and Apple IAP diagnostics. Shows 100 events per page. Events without a recorded level appear as info. Hosting console output is not included.</p>
      <form className="flex flex-wrap items-end gap-3">
        <Field label="Event type"><Select name="category" defaultValue={category ?? ""}><option value="">All event types</option>{Object.entries(logCategories).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</Select></Field>
        <Field label="Environment"><Select name="environment" defaultValue={environment ?? ""}><option value="">All environments</option><option value="sandbox">Sandbox</option><option value="production">Production</option><option value="xcode">Xcode</option></Select></Field>
        <Field label="Level"><Select name="level" defaultValue={level ?? ""}><option value="">All levels</option><option value="error">Errors</option><option value="warn">Warnings</option><option value="info">Info</option></Select></Field>
        <Field label="Transaction or original transaction ID"><Input name="transactionId" defaultValue={transactionId} /></Field>
        <Field label="Event (exact)"><Input name="action" defaultValue={action} /></Field>
        <Field label="Entity type (exact)"><Input name="entityType" defaultValue={entityType} /></Field>
        <Field label="Entity / user ID"><Input name="entityId" defaultValue={entityId} /></Field>
        <Button type="submit">Filter / refresh</Button>
      </form>
      <ApplicationLogTable logs={logs} />
      <nav className="flex gap-4 text-sm text-blue-700 underline" aria-label="Log pages">
        {offset > 0 && <Link href={pageLink(Math.max(0, offset - 100))}>Newer events</Link>}
        {nextOffset !== null && nextOffset <= 100000 && <Link href={pageLink(nextOffset)}>Older events</Link>}
      </nav>
    </div>
  </Card>;
}
