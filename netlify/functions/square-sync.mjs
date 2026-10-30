// SIGNL Square read-back trigger (Build -44).
//
// The Square Connect read-back (lib/square.js) turns register
// orders carrying SIGNL codes into counted events. This
// scheduled function is its clock: it POSTs to the app's own
// sweep endpoint every two hours, which runs syncAllSquare()
// and answers with the per-business summary. Modeled exactly on
// metrics-sync.mjs.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify
// environment, the call carries it as the x-signl-sweep-token
// header and the endpoint accepts it in place of an admin
// session. Netlify scheduled functions can only be invoked by
// the schedule; they are not reachable over HTTP.
export const config = { schedule: "13 */2 * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.joinsignl.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/square/sync`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`SIGNL square sync: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("SIGNL square sync call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
