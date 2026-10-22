import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading the paywall editor" className="flex h-dvh flex-col overflow-hidden bg-[var(--md-surface-container)]">
      <div className="flex min-h-18 shrink-0 flex-wrap items-center gap-3 bg-background px-4 py-4 sm:px-6">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-4 w-40" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(20rem,1fr)_22rem] gap-3 overflow-x-auto p-3 pt-0">
        <div className="space-y-2 overflow-hidden rounded-[24px] border border-[#e0e5ef] bg-[var(--md-surface)] px-3 py-5">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-10" style={{ marginLeft: (index % 3) * 14 }} />
          ))}
        </div>
        <div className="flex flex-col overflow-hidden rounded-[24px] border border-[#d5deef] bg-[#e4ebf7]">
          <div className="flex gap-2 bg-[#edf2fc] p-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-9 w-20" />)}</div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6"><Skeleton className="h-full max-h-[720px] w-[340px] max-w-full rounded-[40px]" /></div>
        </div>
        <div className="space-y-3 overflow-hidden rounded-[24px] border border-[#e0e5ef] bg-[var(--md-surface)] p-5">
          <div className="mb-6 flex gap-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 flex-1 rounded-2xl" />)}</div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 rounded-xl" />
          <Skeleton className="h-9 rounded-xl" />
          <Skeleton className="h-9 rounded-xl" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
