// Magpie Admin Home summary refresh — BACKGROUND function
// (Build -212). Netlify runs *-background functions with a
// 15-minute budget and answers the caller 202 immediately.
//
// The summary compute (refreshAdminHomeSummary212 in
// lib/router.js) lives here and ONLY here: Admin Home used to
// wait on six aggregate endpoints that each computed on the
// request path behind an in-process memo that is effectively
// always cold on Netlify's ephemeral instances (diagnosis:
// ~/workspace/xmedium-qa/home212/probe212.mjs — instance-
// parallel wall 6.2s at the calibrated model, ~13s live). The
// compute runs here on the */5 schedule, the trigger-only
// admin refresh endpoint, and a throttled read-path nudge; it
// stores one record at config:adminHomeSummary and
// GET /api/admin/home-summary serves that record, never
// builds.
//
// Auth: the caller must carry the SIGNL_SWEEP_TOKEN as the
// x-signl-sweep-token header (fail closed when unset). Body
// may be JSON { force: true } to bypass the freshness skip.
const { runAdminHomeRefresh212 } = require("./lib/router");

exports.handler = async (event) => {
  const token = process.env.SIGNL_SWEEP_TOKEN || "";
  const headers = event.headers || {};
  const given = headers["x-signl-sweep-token"] || headers["X-Signl-Sweep-Token"] || "";
  if (!token || given !== token) {
    return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "forbidden" }) };
  }
  let force = false;
  try { force = !!(event.body && JSON.parse(event.body).force); } catch (e) { /* empty body is fine */ }
  try {
    const out = await runAdminHomeRefresh212({ force });
    console.log("Magpie admin home summary refresh:", JSON.stringify(out));
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, refresh: out }) };
  } catch (e) {
    console.error("Magpie admin home summary refresh failed:", e);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
