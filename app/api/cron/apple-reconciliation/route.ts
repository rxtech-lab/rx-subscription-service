import { startAppleReconciliation } from "@/lib/workflows/schedule";

const noStore = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    const runId = await startAppleReconciliation();
    return Response.json({ runId }, { headers: noStore });
  } catch (error) {
    console.error("Could not start App Store reconciliation:", error);
    return Response.json(
      { error: "apple_reconciliation_failed" },
      { status: 500, headers: noStore },
    );
  }
}
