// Magpie Admin Home summary refresh trigger (Build -212).
//
// The summary behind GET /admin/home-summary is PRECOMPUTED:
// the six aggregate builds Admin Home used to wait on run in
// the admin-home-refresh-background function (15-minute
// budget) and store one record at config:adminHomeSummary.
// The GET serves that record in one fetch and never builds —
// the per-endpoint in-process memos were effectively always
// cold on Netlify's ephemeral instances, so every Home load
// paid six cold computes (live: ~13s to settle). This
// schedule just fires the background function every 5
// minutes; the compute fits the background budget with room
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
    const res = await fetch(`${base}/.netlify/functions/admin-home-refresh-background`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`Magpie admin home summary refresh: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Magpie admin home summary refresh call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
