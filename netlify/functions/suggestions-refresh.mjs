// Magpie suggestion board refresh trigger (Build -211).
//
// The board behind GET /admin/suggestions is PRECOMPUTED: the
// heavy candidate build (aggregates, funnel, the creator
// last-action digest, lifecycle sync, Maggie phrasing) runs in
// the suggestions-refresh-background function (15-minute
// budget) and stores its payload at config:suggestionBoard.
// The GET serves that record in one fetch and never builds —
// Builds -202 and -210 both "fixed" the in-request build on
// small seeds and both died on the production store, where a
// cold build is ~61k fetches and the function budget kills it
// before anything persists. This schedule just fires the
// background function every 5 minutes; the compute's measured
// production-scale cost (98s first convergence, 32s steady at
// the calibrated model) fits the background budget with room
// to spare and never touches a request path.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify
// environment, the call carries it as the x-signl-sweep-token
// header and the background function requires it. Netlify
// scheduled functions can only be invoked by the schedule;
// they are not reachable over HTTP.
export const config = { schedule: "*/5 * * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.magpielocal.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/.netlify/functions/suggestions-refresh-background`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`Magpie suggestion board refresh: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Magpie suggestion board refresh call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
