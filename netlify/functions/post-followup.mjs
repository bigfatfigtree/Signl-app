// Magpie post-followup sweep trigger (Build -226, item 14).
//
// Drives POST /api/admin/post-followup/sweep on a daily clock:
// the 48 hour post-confirmation closure, the submitted-link
// re-check (rotted links get flagged for follow-up, never
// un-verified silently), and the two-business-day review promise
// backstop. Modeled exactly on metrics-sync.mjs. The work itself
// lives in lib/router.js (runPostFollowupSweep226) and runs only
// here and on the admin trigger, never on the request path.
//
// Auth: when SIGNL_SWEEP_TOKEN is set in the Netlify environment,
// the call carries it as the x-signl-sweep-token header and the
// endpoint accepts it in place of an admin session. Netlify
// scheduled functions can only be invoked by the schedule; they
// are not reachable over HTTP.
export const config = { schedule: "23 10 * * *" };

export default async () => {
  const base = process.env.APP_URL || "https://app.magpielocal.com";
  const headers = { "Content-Type": "application/json" };
  if (process.env.SIGNL_SWEEP_TOKEN) headers["x-signl-sweep-token"] = process.env.SIGNL_SWEEP_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/post-followup/sweep`, { method: "POST", headers, body: "{}" });
    const text = await res.text();
    console.log(`Magpie post followup: HTTP ${res.status} ${text.slice(0, 300)}`);
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Magpie post followup call failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
