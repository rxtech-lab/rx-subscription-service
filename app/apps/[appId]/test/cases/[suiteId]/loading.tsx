import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading the suite" className="space-y-3">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-[calc(100vh-12rem)] min-h-[540px] rounded-2xl" />
    </SkeletonScreen>
  );
}
