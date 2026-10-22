import type { ReactNode } from "react";
import { ConsoleHeader } from "@/components/console/console-header";
import { getConsoleUser } from "@/lib/console/session";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await getConsoleUser();

  return (
    <div className={user ? "console-shell bg-[var(--md-surface-container)] lg:pl-64" : "min-h-screen"}>
      {user && (
        <ConsoleHeader
          displayName={user.name || user.email || "Admin"}
          email={user.email}
        />
      )}
      <div className={user ? "console-content-surface" : undefined}>
        <div id="console-content" tabIndex={-1} className={user ? "console-content-scroll" : undefined}>{children}</div>
      </div>
    </div>
  );
}
