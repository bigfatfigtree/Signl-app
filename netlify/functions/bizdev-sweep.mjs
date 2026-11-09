// Magpie biz dev sweep trigger (Build -157).
// The field-seller system needs a clock: this scheduled function
// POSTs daily to the biz dev sweep endpoint, which writes one
// alarm record per rep with overdue follow-ups (same-day re-runs
// overwrite, never duplicate) and, on Mondays, generates each
// rep's scoreboard for the week just ended.
// Auth mirrors notify-sweep.mjs: the x-signl-sweep-token header
// when SIGNL_SWEEP_TOKEN is set. Netlify scheduled functions can
// only be invoked by the schedule.
export const config = { schedule: "13 12 * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.magpielocal.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/bdev/sweep`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`Magpie bizdev sweep: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Magpie bizdev sweep call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
