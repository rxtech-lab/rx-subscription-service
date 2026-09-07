import { AppleIapLogTable } from "@/components/console/apple-iap-log-table";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { listAppleLogs } from "@/lib/iap/apple/logs";

export default async function AppleLogsPage({ params, searchParams }: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { appId } = await params;
  await requireApplicationAccess(appId);
  const query = await searchParams;
  const environment = query.environment === "sandbox" || query.environment === "production" || query.environment === "xcode" ? query.environment : undefined;
  const level = query.level === "info" || query.level === "error" ? query.level : undefined;
  const transactionId = typeof query.transactionId === "string" ? query.transactionId.trim().slice(0, 128) : undefined;
  const logs = await listAppleLogs(appId, undefined, { environment, level, transactionId: transactionId || undefined });
  return <Card>
    <CardHeader title="Apple IAP logs" />
    <div className="space-y-5 p-5">
      <p className="text-sm text-neutral-600">Latest 100 matching events, including token errors, fulfilled transactions and administrator changes. Logging starts after this version is deployed.</p>
      <form className="flex flex-wrap items-end gap-3">
        <Field label="Environment"><Select name="environment" defaultValue={environment ?? ""}><option value="">All environments</option><option value="sandbox">Sandbox</option><option value="production">Production</option><option value="xcode">Xcode</option></Select></Field>
        <Field label="Level"><Select name="level" defaultValue={level ?? ""}><option value="">All levels</option><option value="error">Errors</option><option value="info">Info</option></Select></Field>
        <Field label="Transaction or original transaction ID"><Input name="transactionId" defaultValue={transactionId} /></Field>
        <Button type="submit">Filter / refresh</Button>
      </form>
      <AppleIapLogTable logs={logs} />
    </div>
  </Card>;
}
