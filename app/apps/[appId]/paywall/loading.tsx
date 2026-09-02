import { ConsoleTableSkeleton } from "@/components/console/page-skeleton";

export default function Loading() {
  return <ConsoleTableSkeleton rows={2} columns={2} actions={1} />;
}
