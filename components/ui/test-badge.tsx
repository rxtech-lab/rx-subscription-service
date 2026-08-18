import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/primitives";

/**
 * Marks data belonging to a test user. Test rows are tagged rather than hidden
 * wherever an admin might mistake them for real activity.
 */
export function TestBadge({ className }: { className?: string }) {
  return (
    <Badge tone="amber" className={className}>
      <FlaskConical className="mr-1 size-3" aria-hidden="true" />
      Test
    </Badge>
  );
}
