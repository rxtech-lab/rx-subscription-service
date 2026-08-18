import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading applications" className="min-h-full bg-[#f7f8fc]">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          </div>
          <Skeleton className="size-9 rounded-full" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <section className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-slate-950 px-6 py-9 sm:px-10 sm:py-11">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full max-w-2xl space-y-5">
              <Skeleton className="h-7 w-48 rounded-full bg-white/10" />
              <Skeleton className="h-9 w-full max-w-xl bg-white/10" />
              <Skeleton className="h-4 w-full max-w-lg bg-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:flex">
              <Skeleton className="h-20 min-w-32 rounded-2xl bg-white/10" />
              <Skeleton className="h-20 min-w-32 rounded-2xl bg-white/10" />
            </div>
          </div>
        </section>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, application) => (
            <Card key={application} className="p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
              <Skeleton className="mt-5 h-3.5 w-full" />
              <Skeleton className="mt-2 h-3.5 w-2/3" />
            </Card>
          ))}
        </div>
      </main>
    </SkeletonScreen>
  );
}
