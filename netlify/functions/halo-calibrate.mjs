// SIGNL Halo recalibration trigger (Build -45).
//
// Halo (lib/router.js) estimates the visits a creator's post
// brought in that no code caught, at a modeled intent rate.
// That rate recalibrates from real register data as the
// platform grows; this scheduled function is its clock: once
// a week it POSTs to the app's own calibration endpoint, which
// runs runHaloCalibration() and logs the outcome either way
// (an adjustment, a no-change check, or a skip with its
// reason). Modeled exactly on square-sync.mjs.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify
// environment, the call carries it as the x-signl-sweep-token
// header and the endpoint accepts it in place of an admin
// session. Netlify scheduled functions can only be invoked by
// the schedule; they are not reachable over HTTP.
export const config = { schedule: "37 5 * * 1" };

export default async () => {
  const base = process.env.APP_URL || "https://app.joinsignl.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/halo/calibrate`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`SIGNL halo calibration: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("SIGNL halo calibration call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
