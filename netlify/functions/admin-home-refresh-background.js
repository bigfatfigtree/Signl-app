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
//
// Build -244: the same run also builds the Admin Stats
// Overview record (runAdminStatsSummary244, stored at
// config:adminStatsSummary), so the */5 schedule, the trigger
// endpoint and the read-path nudges keep both summaries fresh
// together. Each compute is guarded on its own: one failing
// never blocks the other, and the answer reports both.
const { runAdminHomeRefresh212, runAdminStatsSummary244, runApprovalFanout246, runSignupFanout249 } = require("./lib/router");

exports.handler = async (event) => {
  const token = process.env.SIGNL_SWEEP_TOKEN || "";
  const headers = event.headers || {};
  const given = headers["x-signl-sweep-token"] || headers["X-Signl-Sweep-Token"] || "";
  if (!token || given !== token) {
    return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "forbidden" }) };
  }
  let force = false;
  try { force = !!(event.body && JSON.parse(event.body).force); } catch (e) { /* empty body is fine */ }
  let out = null;
  let statsOut = null;
  let firstError = null;
  try {
    out = await runAdminHomeRefresh212({ force });
    console.log("Magpie admin home summary refresh:", JSON.stringify(out));
  } catch (e) {
    firstError = e;
    console.error("Magpie admin home summary refresh failed:", e);
  }
  try {
    statsOut = await runAdminStatsSummary244({ force });
    console.log("Magpie admin stats overview refresh:", JSON.stringify(statsOut));
  } catch (e) {
    if (!firstError) firstError = e;
    console.error("Magpie admin stats overview refresh failed:", e);
  }
  // Build -246: the approval fan-out drain rides this same
  // background run (the */5 schedule plus the review routes'
  // nudge), so approval emails, recruiter credit, and roster
  // drops queued by the review decision path are delivered
  // here, off the request path. Its own try/catch, like the
  // two runs above: a drain failure never fails the refresh.
  let fanoutOut = null;
  try {
    fanoutOut = await runApprovalFanout246();
    console.log("Magpie approval fan-out drain:", JSON.stringify(fanoutOut));
  } catch (e) {
    if (!firstError) firstError = e;
    console.error("Magpie approval fan-out drain failed:", e);
  }
  // Build -249: the signup fan-out drain rides the same run:
  // register now queues its downstream work (recruiter credit,
  // auto-decision, completion events, wishlist/roster moments,
  // and the exactly-once confirmation email) instead of running
  // it on the request path. Its own try/catch, same discipline.
  let signupFanoutOut = null;
  try {
    signupFanoutOut = await runSignupFanout249();
    console.log("Magpie signup fan-out drain:", JSON.stringify(signupFanoutOut));
  } catch (e) {
    if (!firstError) firstError = e;
    console.error("Magpie signup fan-out drain failed:", e);
  }
  if (firstError && !out && !statsOut && !fanoutOut && !signupFanoutOut) {
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: String((firstError && firstError.message) || firstError) }) };
  }
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, refresh: out, statsRefresh: statsOut, approvalFanout: fanoutOut, signupFanout: signupFanoutOut }) };
};
