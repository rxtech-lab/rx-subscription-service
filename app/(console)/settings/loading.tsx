import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading settings">
      <main className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <div className="mb-8">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-3 h-9 w-36" />
          <Skeleton className="mt-3 h-5 w-full max-w-lg" />
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Skeleton className="h-12 w-full rounded-xl" />
          <div className="space-y-8">
            <Card className="overflow-hidden">
              <div className="flex gap-5 border-b border-slate-100 p-6 sm:p-7">
                <Skeleton className="size-12 shrink-0 rounded-2xl" />
                <div className="flex-1"><Skeleton className="h-5 w-40 max-w-full" /><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-2 h-4 w-2/3" /></div>
              </div>
              <div className="space-y-3 p-6 sm:p-7">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-12 w-full rounded-xl" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <div className="bg-[#edf2fc] px-6 py-4"><Skeleton className="h-4 w-3/4" /></div>
            </Card>
            <div><Skeleton className="h-5 w-40" /><Skeleton className="mt-2 h-4 w-64 max-w-full" /></div>
            <Card className="space-y-4 p-6"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-3/4" /></Card>
          </div>
        </div>
      </main>
    </SkeletonScreen>
  );
}
