// Magpie post-metrics auto-sync seam (UX redesign section 3, 2026-10-24).
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
//      instagram_business_manage_insights permission on the Magpie
//      Meta app (review not yet filed; Access Verification in
//      review, deadline 2026-12-21). STILL OPEN — gate G4.
//   2. Creator Instagram connection flow: BUILT (Build -108) —
//      the creator connects their Instagram professional account
//      in the app and grants the insights permission; the lane
//      ships dark behind the missing Meta app credentials.
//   3. Token storage: BUILT (Build -108) — per-creator tokens in
//      platconn: records server-side only, long-lived with
//      refresh handling in lib/platform-connect.js.
//   4. Env flag: METRICS_AUTOSYNC=1 set in the Netlify environment.
//
// When those land, implement metaProvider.fetchPostMetrics against
// the Graph API and have runMetricsSync walk posts whose latest
// snapshot source is not fresh, appending snapshots with
// source "meta_sync" through the same post.snapshots[] time series
// the creator-report route writes. The route, schedule, and payload
// shapes do not change.

// Build -226 (Jeff, 2026-11-21): the auto-populate pipe is built to
// the stub boundary above, feature-flagged OFF by default
// (METRICS_AUTOSYNC unset or not "1" changes zero behavior: no post
// is read for sync, no snapshot is written, and the return shape is
// exactly the historical one). When the flag is ON, runMetricsSync
// walks submitted posts once (one bounded store list of the post:
// prefix; the store's list() fetches values with bounded
// concurrency, never a serial per-key scan), asks the provider for
// each post's metrics, and applies what comes back through
// applyPulledMetrics. Today the provider is the stub below, which
// returns "unavailable" and performs no network calls, so a flag-on
// run still syncs nothing and says so plainly. The approval that
// unlocks real numbers is item 1 of the checklist: Meta App Review
// for instagram_business_manage_insights, plus the Meta app
// credentials in env for the Build -108 connection lane.
//
// LABELING LAW (Build -226): pulled numbers are labeled "platform",
// creator-reported numbers stay labeled "creator". The two never
// blend silently: post.metricSources carries one source per metric
// ({ views: "creator", likes: "platform", ... }), a pulled value
// replaces the reported value for that same metric only, and the
// source label for that metric flips with it. Metrics a pull does
// not return keep their creator value and their creator label.

const METRIC_KEYS_226 = ["views", "likes", "comments", "shares", "saves"];

function metricsAutosyncEnabled(env) {
  const e = env || process.env;
  return e.METRICS_AUTOSYNC === "1";
}

function cleanMetric226(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

// Apply one pulled metric set to a post record (mutates and
// returns it). Only metrics the pull actually returns are touched:
// each returned metric replaces the stored value, flips its
// per-metric source to "platform", and the new set is appended to
// post.snapshots[] with source "platform" (carrying forward the
// untouched metrics, exactly like a creator snapshot update).
// Returns the list of metric keys that were replaced.
function applyPulledMetrics(post, pulled, at) {
  if (!post || !pulled || typeof pulled !== "object") return [];
  const ts = at || new Date().toISOString();
  if (!post.metricSources || typeof post.metricSources !== "object") post.metricSources = {};
  const replaced = [];
  const snapshot = { at: ts, source: "platform" };
  for (const k of METRIC_KEYS_226) {
    const v = cleanMetric226(pulled[k]);
    if (v !== null) {
      post[k] = v;
      post.metricSources[k] = "platform";
      replaced.push(k);
    }
    snapshot[k] = typeof post[k] === "number" && Number.isFinite(post[k]) ? post[k] : null;
  }
  if (!replaced.length) return [];
  if (!Array.isArray(post.snapshots)) post.snapshots = [];
  post.snapshots.push(snapshot);
  post.lastSnapshotAt = ts;
  post.pulledAt = ts;
  return replaced;
}

// The creator-report twin, used by the router's performance route
// so both lanes write the same per-metric source shape: provided
// metrics take the "creator" label, unprovided ones keep theirs.
function applyCreatorMetrics(post, provided) {
  if (!post || !provided || typeof provided !== "object") return post;
  if (!post.metricSources || typeof post.metricSources !== "object") post.metricSources = {};
  for (const k of METRIC_KEYS_226) {
    if (provided[k] !== null && provided[k] !== undefined) post.metricSources[k] = "creator";
    else if (typeof post[k] === "number" && Number.isFinite(post[k]) && !post.metricSources[k]) post.metricSources[k] = "creator";
  }
  return post;
}

// Provider stub: reports unavailable, performs no network calls.
// This is the exact boundary Meta App Review unlocks: implement
// fetchPostMetrics against the Graph API (using the creator's
// platconn: Instagram connection from lib/platform-connect.js)
// and every caller below lights up unchanged.
const metaProvider = {
  name: "meta",
  async fetchPostMetrics(/* post */) {
    return { status: "unavailable" };
  },
  // Audience geography (Build -108): the real fetch lives in
  // lib/platform-connect.js (the same module that owns the
  // connection and its token). This seam stays the metrics
  // module's door to it; the router's audience pass calls the
  // platform module directly, like the YouTube lane.
  async fetchAudienceCities(conn) {
    const platformConnect = require("./platform-connect");
    return platformConnect.fetchInstagramAudienceCities(conn);
  },
};

async function runMetricsSync(opts) {
  const o = opts || {};
  let out;
  if (!metricsAutosyncEnabled(o.env)) {
    out = { enabled: false, reason: "METRICS_AUTOSYNC is off" };
  } else {
    // Flag on: walk the submitted posts once and ask the provider
    // for each. Tests (and the future real provider) can inject
    // opts.provider / opts.fetchPostMetrics / opts.posts /
    // opts.savePost; production defaults read the store's post:
    // list (one bounded list, values fetched with bounded
    // concurrency by the store adapter, never a serial per-key
    // scan) and write changed posts back one set per changed post.
    const provider = o.provider || (typeof o.fetchPostMetrics === "function" ? { name: "injected", fetchPostMetrics: o.fetchPostMetrics } : metaProvider);
    let posts = Array.isArray(o.posts) ? o.posts : null;
    if (!posts) {
      try {
        const store = require("./store");
        posts = (await store.list("post:")).map((r) => r.value).filter(Boolean);
      } catch (e) {
        posts = [];
      }
    }
    let synced = 0;
    let unavailable = 0;
    let providerStatus = null;
    for (const post of posts) {
      if (!post || !post.url) continue;
      let res = null;
      try { res = await provider.fetchPostMetrics(post); } catch (e) { res = { status: "unavailable" }; }
      if (!res || res.status === "unavailable" || !res.metrics) { unavailable += 1; if (res && res.status) providerStatus = res.status; continue; }
      const replaced = applyPulledMetrics(post, res.metrics, o.now ? new Date(o.now).toISOString() : undefined);
      if (replaced.length) {
        synced += 1;
        if (typeof o.savePost === "function") await o.savePost(post);
        else {
          try { const store = require("./store"); await store.set(`post:${post.id}`, post); } catch (e) { /* a failed write leaves the post as it was */ }
        }
      }
    }
    out = { enabled: true, synced, unavailable, providerStatus: providerStatus || (synced ? "ok" : "unavailable"), reason: synced ? "Platform metrics pulled" : "Meta provider not connected" };
  }
  // Connect Accounts audience sync (YouTube today): a real provider
  // lane that runs on this same daily clock, independent of the
  // Meta post-metrics flag above. The router passes the hook
  // because it owns the creator-record writes (stack, total, tier).
  if (typeof o.syncAudience === "function") {
    try {
      out.audience = await o.syncAudience();
    } catch (e) {
      out.audience = { error: String((e && e.message) || e) };
    }
  }
  return out;
}

module.exports = { runMetricsSync, metaProvider, metricsAutosyncEnabled, applyPulledMetrics, applyCreatorMetrics, METRIC_KEYS_226 };
