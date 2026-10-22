import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading paywalls" className="min-h-full bg-transparent">
      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-4 sm:px-8 sm:pt-6">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="mt-4 h-9 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-xl" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-8 h-5 w-24 rounded-full" />
            </Card>
          ))}
        </div>
      </main>
    </SkeletonScreen>
  );
}
