import { Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

function HeaderSkeleton() {
  return (
    <div className="border-b border-slate-100 px-5 py-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-2.5 h-3 w-72 max-w-full" />
    </div>
  );
}

/**
 * The shape almost every console segment settles into: a titled card wrapping a
 * table, with the action buttons underneath.
 */
export function ConsoleTableSkeleton({
  rows = 5,
  columns = 5,
  actions = 2,
}: {
  rows?: number;
  columns?: number;
  actions?: number;
}) {
  return (
    <SkeletonScreen label="Loading" className="space-y-6">
      <Card>
        <HeaderSkeleton />
        <div className="flex gap-5 border-b border-slate-200 bg-slate-50/80 px-5 py-3">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className="h-3 flex-1 bg-slate-200" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div
            key={row}
            className="flex items-center gap-5 border-b border-slate-100 px-5 py-4"
          >
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton
                key={column}
                className={column === 0 ? "h-4 flex-1" : "h-3.5 flex-1"}
              />
            ))}
          </div>
        ))}
      </Card>

      {actions > 0 ? (
        <div className="flex flex-wrap justify-end gap-3">
          {Array.from({ length: actions }, (_, action) => (
            <Skeleton key={action} className="h-10 w-32 rounded-lg" />
          ))}
        </div>
      ) : null}
    </SkeletonScreen>
  );
}

/** Stacked detail cards, for segments that render forms instead of a table. */
export function ConsoleCardsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <SkeletonScreen label="Loading" className="space-y-6">
      {Array.from({ length: cards }, (_, card) => (
        <Card key={card}>
          <HeaderSkeleton />
          <div className="space-y-4 px-5 py-5">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-40 rounded-lg" />
          </div>
        </Card>
      ))}
    </SkeletonScreen>
  );
}

/** The application overview: a stat grid, the analytics panel, then guidance. */
export function ConsoleOverviewSkeleton() {
  return (
    <SkeletonScreen label="Loading" className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }, (_, stat) => (
          <Card key={stat} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-7 w-12" />
          </Card>
        ))}
      </div>

      <Card>
        <HeaderSkeleton />
        <div className="px-5 py-5">
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </Card>

      <Card>
        <HeaderSkeleton />
        <div className="space-y-3 px-5 py-4">
          {Array.from({ length: 6 }, (_, line) => (
            <Skeleton key={line} className="h-3.5 w-full max-w-2xl" />
          ))}
        </div>
      </Card>
    </SkeletonScreen>
  );
}
