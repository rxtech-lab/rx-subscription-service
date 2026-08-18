import { ConsoleTableSkeleton } from "@/components/console/page-skeleton";

export default function Loading() {
  return <ConsoleTableSkeleton columns={4} rows={8} actions={1} />;
}
