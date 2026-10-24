// SIGNL post-metrics sync trigger (UX redesign section 3, 2026-10-24).
//
// The metrics auto-sync seam (lib/metrics-sync.js) is feature-flagged
// OFF until Meta App Review approves instagram_business_manage_insights
// and the creator Instagram connection flow lands. This scheduled
// function is the daily clock that will drive it: it POSTs to the
// app's own sync endpoint, which answers with the runMetricsSync()
// summary (today: { enabled: false, reason: "METRICS_AUTOSYNC is
// off" }). Modeled exactly on compliance-sweep.mjs.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify environment, the
// call carries it as the x-signl-sweep-token header and the endpoint
// accepts it in place of an admin session. Netlify scheduled
// functions can only be invoked by the schedule; they are not
// reachable over HTTP.
export const config = { schedule: "17 9 * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.joinsignl.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/metrics/sync`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`SIGNL metrics sync: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("SIGNL metrics sync call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
