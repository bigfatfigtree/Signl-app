// Magpie suggestion board refresh — BACKGROUND function
// (Build -211). Netlify runs *-background functions with a
// 15-minute budget and answers the caller 202 immediately.
//
// The board compute (refreshSuggestionBoard211 in lib/router.js)
// lives here and ONLY here: at production scale it measured
// 98s for the first convergence and 32s steady-state under the
// calibrated 35ms/get model — beyond the synchronous function
// budget, so the admin endpoint, the 5-minute schedule and the
// read-path nudge all just fire this function and return. The
// board is stored at config:suggestionBoard when the compute
// completes; GET /api/admin/suggestions serves that record and
// never builds.
//
// Auth: the caller must carry the SIGNL_SWEEP_TOKEN as the
// x-signl-sweep-token header (fail closed when unset). Body may
// be JSON { force: true } to bypass the freshness skip.
const { runSuggestionBoardRefresh211 } = require("./lib/router");

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
    const out = await runSuggestionBoardRefresh211({ force });
    console.log("Magpie suggestions board refresh:", JSON.stringify(out));
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, refresh: out }) };
  } catch (e) {
    console.error("Magpie suggestions board refresh failed:", e);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
