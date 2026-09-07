import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import Link from "next/link";
import type { AuditLog } from "@/lib/db/schema";

export function ApplicationLogTable({ logs }: { logs: AuditLog[] }) {
  return (logs.length === 0 ? <EmptyState title="No matching app logs" /> : <div className="overflow-x-auto"><Table>
        <thead><tr><Th>Time (UTC)</Th><Th>Entity / environment</Th><Th>Event / error</Th><Th>Token ID</Th><Th>Transaction ID</Th><Th>Info</Th></tr></thead>
        <tbody>{logs.map(log => { const data = log.after ?? {}; return <tr key={log.id}>
          <Td><time dateTime={log.createdAt.toISOString()}>{log.createdAt.toISOString()}</time></Td>
          <Td>{log.entityId && log.applicationId && ["apple_iap", "app_user"].includes(log.entityType) ? <Link className="text-blue-700 underline" href={`/apps/${encodeURIComponent(log.applicationId)}/users/${encodeURIComponent(log.entityId)}`}>{log.entityId}</Link> : log.entityId ?? "App event"}<p>{log.entityType}</p><p>{String(data.environment ?? log.before?.environment ?? "—")}</p></Td>
          <Td><span className={data.level === "error" ? "text-red-700" : ""}>{log.action}</span><p className="text-xs">{String(data.level ?? "info")}</p>{data.error ? <p>{String(data.error)}</p> : null}</Td>
          <Td><code className="break-all text-xs">{String(data.accountToken ?? log.before?.accountToken ?? "—")}</code></Td>
          <Td><code className="break-all text-xs">{String(data.transactionId ?? "—")}</code><p className="text-xs">Original: {String(data.originalTransactionId ?? "—")}</p></Td>
          <Td><FormDialog triggerLabel="Details" title="Log details" description={`${log.action} · ${log.createdAt.toISOString()}`} icon="details" triggerVariant="ghost" triggerSize="sm" size="lg">
            <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(log, null, 2)}</pre>
          </FormDialog></Td>
        </tr>; })}</tbody>
      </Table></div>);
}
