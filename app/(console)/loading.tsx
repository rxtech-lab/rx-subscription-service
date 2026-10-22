import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading applications" className="min-h-full bg-transparent">

      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <section className="relative overflow-hidden rounded-[32px] bg-[#dce7ff] px-6 py-9 sm:px-10 sm:py-11">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full max-w-2xl space-y-5">
              <Skeleton className="h-7 w-48 rounded-full bg-blue-200/70" />
              <Skeleton className="h-9 w-full max-w-xl bg-blue-200/70" />
              <Skeleton className="h-4 w-full max-w-lg bg-blue-200/70" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:flex">
              <Skeleton className="h-20 min-w-32 rounded-2xl bg-blue-200/70" />
              <Skeleton className="h-20 min-w-32 rounded-2xl bg-blue-200/70" />
            </div>
          </div>
        </section>

        <div className="mt-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div><Skeleton className="h-4 w-32" /><Skeleton className="mt-2 h-4 w-72 max-w-full" /></div>
          <Skeleton className="h-12 w-full sm:w-72" />
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, application) => (
            <Card key={application} className="min-h-56 p-6">
              <div className="flex justify-between">
                <Skeleton className="size-11 rounded-2xl" />
                <Skeleton className="size-8" />
              </div>
              <Skeleton className="mt-7 h-5 w-32" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <div className="mt-5 border-t border-slate-100 pt-4"><Skeleton className="h-3 w-40 max-w-full" /></div>
            </Card>
          ))}
        </div>
      </main>
    </SkeletonScreen>
  );
}
