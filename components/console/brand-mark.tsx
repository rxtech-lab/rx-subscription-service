import { Layers3 } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-sky-500 to-cyan-400 text-white shadow-[0_8px_24px_-10px_rgba(2,132,199,0.75)]",
        className,
      )}
      aria-hidden="true"
    >
      <Layers3 className="size-4.5" strokeWidth={2.2} />
    </span>
  );
}
