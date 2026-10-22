import Image from "next/image";
import { BRAND_MARK_SRC } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 overflow-hidden rounded-xl shadow-[0_8px_24px_-10px_rgba(2,132,199,0.75)]",
        className,
      )}
      aria-hidden="true"
    >
      <Image src={BRAND_MARK_SRC} alt="" width={128} height={128} className="size-full object-cover" unoptimized />
    </span>
  );
}
