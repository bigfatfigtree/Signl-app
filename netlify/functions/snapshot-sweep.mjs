// Magpie daily platform snapshot trigger (Build -145, Data
// Audit 2026-11-07 item 5).
//
// The snapshot writer (runSnapshotSweep() in lib/router.js)
// freezes one day of platform aggregates — totals, the market
// x category supply/demand matrix, benchmarks, reliability, the
// typed-city backlog, page views — into an append-only
// snapshot:{yyyy-mm-dd} record, so benchmark trends exist from
// the day this shipped. This scheduled function is the clock:
// once a day it POSTs to the snapshot sweep endpoint. The
// endpoint is idempotent per day (a second call is a no-op),
// and an opportunistic pass on ordinary API traffic covers a
// missed tick, exactly like the other sweeps.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify
// environment, the call carries it as the x-signl-sweep-token
// header and the endpoint accepts it in place of an admin
// session (same pattern as campaign-sweep.mjs). Netlify
// scheduled functions can only be invoked by the schedule; they
// are not reachable over HTTP.
export const config = { schedule: "20 6 * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.magpielocal.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/snapshot/sweep`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`Magpie snapshot sweep: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Magpie snapshot sweep call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
