// SIGNL post-compliance sweep trigger (Jeff, 2026-10-19).
//
// The compliance timeline (48h reminder, day-5 reminder, day-8 final
// warning + account pause, day-9 ban for a redeemed visit with no
// post) is driven by runComplianceSweep() in lib/router.js. This
// scheduled function is the clock that calls it: every 6 hours it
// POSTs to the app's own sweep endpoint, which performs one
// idempotent pass and reports a summary.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify environment, the
// call carries it as the x-signl-sweep-token header and the endpoint
// accepts it in place of an admin session. The router ALSO runs the
// sweep opportunistically (throttled to roughly hourly) on ordinary
// API requests, so reminders still move on a low-traffic day even if
// this schedule is delayed. Netlify scheduled functions can only be
// invoked by the schedule; they are not reachable over HTTP.
export const config = { schedule: "23 */6 * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.joinsignl.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/compliance/sweep`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`SIGNL compliance sweep: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("SIGNL compliance sweep call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
