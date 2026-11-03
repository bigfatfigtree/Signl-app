// SIGNL notification rail sweep trigger (Build -87).
// The ~12-hour post-clock alert needs a clock: this scheduled
// function POSTs hourly to the notify sweep endpoint, which
// fires post_clock_12h exactly once per redeemed, unposted
// booking whose 48h deadline is within 12 hours (the booking
// is stamped notify12hAt, so re-runs never double-fire).
// Auth mirrors compliance-sweep.mjs: the x-signl-sweep-token
// header when SIGNL_SWEEP_TOKEN is set. Netlify scheduled
// functions can only be invoked by the schedule.
export const config = { schedule: "17 * * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.joinsignl.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/notify/sweep`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`SIGNL notify sweep: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("SIGNL notify sweep call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
