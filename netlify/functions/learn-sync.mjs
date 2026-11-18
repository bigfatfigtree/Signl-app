// Magpie Learn sync trigger (Build -202). Daily: POSTs to the app's
// internal Learn sync endpoint, which fetches the site's published
// articles-meta.json and upserts learnarticle:{slug} records.
// Modeled on metrics-sync.mjs. Auth: SIGNL_SWEEP_TOKEN header.
export const config = { schedule: "23 8 * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.magpielocal.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/internal/learn-sync`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`Magpie learn sync: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Magpie learn sync call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
