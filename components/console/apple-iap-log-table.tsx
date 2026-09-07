import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import Link from "next/link";
import type { AuditLog } from "@/lib/db/schema";

export function AppleIapLogTable({ logs }: { logs: AuditLog[] }) {
  return (logs.length === 0 ? <EmptyState title="No IAP logs yet" /> : <div className="overflow-x-auto"><Table>
        <thead><tr><Th>Time (UTC)</Th><Th>User / environment</Th><Th>Event / error</Th><Th>Token ID</Th><Th>Transaction ID</Th><Th>Info</Th></tr></thead>
        <tbody>{logs.map(log => { const data = log.after ?? {}; return <tr key={log.id}>
          <Td><time dateTime={log.createdAt.toISOString()}>{log.createdAt.toISOString()}</time></Td>
          <Td>{log.entityId && log.applicationId ? <Link className="text-blue-700 underline" href={`/apps/${encodeURIComponent(log.applicationId)}/users/${encodeURIComponent(log.entityId)}`}>{log.entityId}</Link> : "Server event"}<p>{String(data.environment ?? "—")}</p></Td>
          <Td><span className={data.level === "error" ? "text-red-700" : ""}>{log.action}</span>{data.error ? <p>{String(data.error)}</p> : null}</Td>
          <Td><code className="break-all text-xs">{String(data.accountToken ?? log.before?.accountToken ?? "—")}</code></Td>
          <Td><code className="break-all text-xs">{String(data.transactionId ?? "—")}</code><p className="text-xs">Original: {String(data.originalTransactionId ?? "—")}</p></Td>
          <Td><FormDialog triggerLabel="Details" title="Log details" description={`${log.action} · ${log.createdAt.toISOString()}`} icon="details" triggerVariant="ghost" triggerSize="sm" size="lg">
            <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(log, null, 2)}</pre>
          </FormDialog></Td>
        </tr>; })}</tbody>
      </Table></div>);
}
