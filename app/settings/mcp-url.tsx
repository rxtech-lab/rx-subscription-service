"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "@/components/forms/action-form";
import { Button } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

export function McpUrl({ url }: { url: string }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 select-all break-all px-1 text-sm text-slate-700">{url}</code>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        aria-label="Copy MCP URL"
        onClick={async () => {
          setPending(true);
          try {
            await copyText(url);
            toast.success("MCP URL copied.", { position: "top-right" });
          } catch {
            toast.error("Could not copy. Select the URL and copy it manually.", { position: "top-right" });
          } finally {
            setPending(false);
          }
        }}
      >
        <Copy className="size-4" aria-hidden="true" />
        {pending ? "Copying…" : "Copy URL"}
      </Button>
    </div>
  );
}
