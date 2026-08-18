import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * A single shimmering placeholder block. Purely decorative — the surrounding
 * loading view carries the `role="status"` announcement, so each block stays
 * hidden from assistive tech.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-slate-200/70", className)}
      {...props}
    />
  );
}

export function SkeletonScreen({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ComponentProps<"div">["children"];
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
