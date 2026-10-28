// SIGNL post-metrics auto-sync seam (UX redesign section 3, 2026-10-24).
//
// HONESTY BOUNDARY: per-post Instagram metrics cannot be pulled
// automatically today. Creator-reported numbers are the only numbers
// in the system, and they stay labeled source "creator_report" until
// this provider is live. Nothing scrapes Instagram, nothing calls
// the Instagram or Graph APIs from this module yet, and nothing in
// the app may label a POST metric "synced" while this returns
// disabled or unavailable.
//
// AUDIENCE COUNTS are a separate lane with a separate provider
// (Connect Accounts, 2026-10-28, lib/platform-connect.js): a
// creator's YouTube subscriber count IS fetched for real once they
// connect, and only that fetched number may carry the Synced label.
// The daily clock below drives both lanes: runMetricsSync accepts a
// syncAudience hook from the router (the router owns the creator
// record writes) and runs it regardless of the Meta flag, because
// the YouTube lane is not gated on Meta anything.
//
// ACTIVATION CHECKLIST (all four, in order, before the flag flips):
//   1. Meta App Review approval for the
//      instagram_business_manage_insights permission on the SIGNL
//      Meta app (review not yet filed; Access Verification in
//      review, deadline 2026-12-21).
//   2. Creator Instagram connection flow live: a creator connects
//      their Instagram professional account in the app and grants
//      the insights permission.
//   3. Token storage: per-creator access tokens stored server-side
//      (never on a client payload), with refresh handling.
//   4. Env flag: METRICS_AUTOSYNC=1 set in the Netlify environment.
//
// When those land, implement metaProvider.fetchPostMetrics against
// the Graph API and have runMetricsSync walk posts whose latest
// snapshot source is not fresh, appending snapshots with
// source "meta_sync" through the same post.snapshots[] time series
// the creator-report route writes. The route, schedule, and payload
// shapes do not change.

// Provider stub: reports unavailable, performs no network calls.
const metaProvider = {
  name: "meta",
  async fetchPostMetrics(/* post */) {
    return { status: "unavailable" };
  },
};

async function runMetricsSync(opts) {
  let out;
  if (process.env.METRICS_AUTOSYNC !== "1") {
    out = { enabled: false, reason: "METRICS_AUTOSYNC is off" };
  } else {
    // Flag is on but the provider is not connected yet (see the
    // activation checklist above): iterate nothing, sync nothing,
    // and say so plainly.
    const probe = await metaProvider.fetchPostMetrics(null);
    out = { enabled: true, synced: 0, providerStatus: probe.status, reason: "Meta provider not connected" };
  }
  // Connect Accounts audience sync (YouTube today): a real provider
  // lane that runs on this same daily clock, independent of the
  // Meta post-metrics flag above. The router passes the hook
  // because it owns the creator-record writes (stack, total, tier).
  if (opts && typeof opts.syncAudience === "function") {
    try {
      out.audience = await opts.syncAudience();
    } catch (e) {
      out.audience = { error: String((e && e.message) || e) };
    }
  }
  return out;
}

module.exports = { runMetricsSync, metaProvider };
