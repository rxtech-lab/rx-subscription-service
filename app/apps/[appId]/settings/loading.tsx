import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading settings" className="mx-auto max-w-6xl space-y-6">
      <div>
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-2 h-5 w-80 max-w-full" />
      </div>
      <Skeleton className="h-10 w-96 max-w-full rounded-xl" />
      {[0, 1].map((item) => (
        <Card key={item}>
          <div className="space-y-2 border-b border-slate-100 px-5 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="space-y-4 px-5 py-5">
            <Skeleton className="h-6 w-36 rounded-full" />
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-10 w-44 rounded-full" />
          </div>
        </Card>
      ))}
    </SkeletonScreen>
  );
}
