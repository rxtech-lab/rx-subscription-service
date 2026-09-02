import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading the paywall editor" className="flex h-screen flex-col bg-[#f7f8fc]">
      <div className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-4 w-40" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_22rem]">
        <div className="space-y-2 border-r border-slate-200 bg-white p-3">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-6" style={{ marginLeft: (index % 3) * 14 }} />
          ))}
        </div>
        <div className="flex items-center justify-center">
          <Skeleton className="h-[720px] w-[340px] rounded-[40px]" />
        </div>
        <div className="space-y-3 border-l border-slate-200 bg-white p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
