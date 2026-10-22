import type { ReactNode } from "react";
import { ConsoleHeader } from "@/components/console/console-header";
import { getConsoleUser } from "@/lib/console/session";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await getConsoleUser();

  return (
    <div className="min-h-full bg-[#f7f8fc]">
      {user && (
        <ConsoleHeader
          displayName={user.name || user.email || "Admin"}
          email={user.email}
        />
      )}
      {children}
    </div>
  );
}
