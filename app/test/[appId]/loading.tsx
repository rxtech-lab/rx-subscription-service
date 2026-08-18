import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading" className="space-y-4">
      {Array.from({ length: 2 }, (_, card) => (
        <Card key={card}>
          <div className="border-b border-slate-100 px-5 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2.5 h-3 w-64 max-w-full" />
          </div>
          <div className="space-y-3 px-5 py-5">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-10 w-36 rounded-lg" />
          </div>
        </Card>
      ))}
    </SkeletonScreen>
  );
}
