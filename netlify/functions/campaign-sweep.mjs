// SIGNL creator outreach campaign sweep trigger (Jeff, 2026-10-19).
//
// The campaign engine (runCampaignSweep() in lib/router.js) sends
// the Jeff-approved founding-creator outreach email from inside the
// app, over the app's own SMTP transport, so no per-send approval
// card ever appears. This scheduled function is the clock: every 30
// minutes it POSTs to the campaign sweep endpoint, which sends at
// most one batch (8) per armed campaign, only inside the send
// window (08:00-21:00 America/New_York), and reports a summary.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify environment,
// the call carries it as the x-signl-sweep-token header and the
// endpoint accepts it in place of an admin session (same pattern as
// compliance-sweep.mjs). Netlify scheduled functions can only be
// invoked by the schedule; they are not reachable over HTTP.
export const config = { schedule: "*/30 * * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.joinsignl.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/campaign/sweep`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`SIGNL campaign sweep: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("SIGNL campaign sweep call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
