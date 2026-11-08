// Magpie suggestion outcome sweep trigger (Build -149,
// Phase 3 readiness).
//
// The matcher (runSuggestionOutcomeSweep() in lib/router.js)
// closes the loop on suggestions Jeff acted on: within 7 days
// of the door tap it looks for the downstream fact each kind
// pointed at and stamps the record achieved / not_yet /
// window_expired, logging suggestion_outcome on terminal
// stamps. It also runs opportunistically on ordinary API
// traffic (throttled to one pass per 6 hours); this scheduled
// function is the daily guarantee, exactly like
// snapshot-sweep.mjs.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify
// environment, the call carries it as the x-signl-sweep-token
// header and the endpoint accepts it in place of an admin
// session. Netlify scheduled functions can only be invoked by
// the schedule; they are not reachable over HTTP.
export const config = { schedule: "40 6 * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.magpielocal.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/suggestions/outcomes/sweep`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`Magpie suggestion outcome sweep: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Magpie suggestion outcome sweep call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
