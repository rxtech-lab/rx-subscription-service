import { startBalanceExpirySweep } from "@/lib/workflows/schedule";

const noStore = { "Cache-Control": "no-store" };

/**
 * Kick off the balance expiry sweep.
 *
 * Vercel Cron calls this with `CRON_SECRET` as a bearer token. The check is
 * mandatory rather than best-effort: without it any caller on the internet
 * could enqueue unbounded sweep runs. An unset secret fails closed for the same
 * reason — an unauthenticated public endpoint is worse than a sweep that does
 * not run, since the lazy expiry path already keeps balances correct.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }

  try {
    const runId = await startBalanceExpirySweep();
    return Response.json({ runId }, { headers: noStore });
  } catch (error) {
    console.error("Could not start balance expiry sweep:", error);
    return Response.json(
      { error: "sweep_failed" },
      { status: 500, headers: noStore },
    );
  }
}
