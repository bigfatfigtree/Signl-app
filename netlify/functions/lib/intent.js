// Intent & Return math (Build -83, Jeff 2026-11-02, from the
// Chelsea call: "she watches shares and saves as intent... build
// that into our return score now, show them on their side, the
// creators side and business side, those numbers exactly, and
// then on the business side how that funnels to their roas").
//
// HONESTY CLASSES, kept apart everywhere this module feeds:
//   - RECORDED: post numbers the creator reported (views, likes,
//     shares, saves). Self-reported, labeled recorded, never
//     presented as counted. A field a creator never reported is
//     ABSENT (null), never zero-filled; a reported 0 is a real 0.
//   - COUNTED: register/code redemptions (customers + dollars).
//   - This module never produces a modeled figure: the funnel
//     and the Return score read recorded + counted inputs only.
//
// RETURN SCORE (0-100, business-facing), per the refinement
// Jeff ordered the same day: saves and shares dominate, likes
// count second, views count least (they are the base), and
// counted customers may lift a score but never fabricate one.
// Per post (then rolled up per creator / per campaign from the
// summed totals, so big posts weigh more than small ones):
//   intentRate = (shares + saves) / views * 1000
//   likeRate   = likes / views * 1000
//   intentComponent = min(100, intentRate / 50 * 100)
//     (50 saves+shares per 1,000 views = a 5% intent rate maxes it)
//   likeComponent   = min(100, likeRate / 100 * 100)
//     (100 likes per 1,000 views = a 10% like rate maxes it)
//   base  = round(0.7 * intentComponent + 0.3 * likeComponent)
//   lift  = countedCustomers > 0 ? min(10, countedCustomers) : 0
//     (one point per counted customer, capped at +10)
//   score = min(100, base + lift)
// A scope with no reported views has NO score (null): the UI
// shows "Not enough data yet" instead of a number. The score
// NEVER feeds Discover ranking or ordering (standing boundary,
// Jeff 2026-11-02): it is a reporting figure only.

const INTENT_RATE_CAP = 50;
const LIKE_RATE_CAP = 100;
const COUNTED_LIFT_CAP = 10;

function numOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}
function numOr0(v) {
  const n = numOrNull(v);
  return n === null ? 0 : n;
}

// One post's recorded numbers, nulls preserved, with intent
// derived. `reported` follows the post's own report stamp: a
// post that exists but was never reported carries no numbers.
function postIntent(post) {
  if (!post) return { reported: false, views: null, likes: null, shares: null, saves: null, intent: null, intentRatePer1k: null, likeRatePer1k: null };
  const views = numOrNull(post.views);
  const likes = numOrNull(post.likes);
  const shares = numOrNull(post.shares);
  const saves = numOrNull(post.saves);
  const intent = shares === null && saves === null ? null : numOr0(shares) + numOr0(saves);
  return {
    reported: !!post.reportedAt,
    views, likes, shares, saves, intent,
    intentRatePer1k: views && intent !== null ? Math.round((intent / views) * 1000 * 10) / 10 : null,
    likeRatePer1k: views && likes !== null ? Math.round((likes / views) * 1000 * 10) / 10 : null,
  };
}

function returnScoreFor(scope) {
  const s = scope || {};
  const views = numOrNull(s.views);
  if (!views) return null; // no reported views: not enough data, never a fabricated score
  const likes = numOr0(s.likes);
  const intent = numOr0(s.shares) + numOr0(s.saves);
  const intentRate = (intent / views) * 1000;
  const likeRate = (likes / views) * 1000;
  const intentComponent = Math.min(100, (intentRate / INTENT_RATE_CAP) * 100);
  const likeComponent = Math.min(100, (likeRate / LIKE_RATE_CAP) * 100);
  const base = Math.round(0.7 * intentComponent + 0.3 * likeComponent);
  const countedCustomers = Math.max(0, Math.floor(Number(s.countedCustomers) || 0));
  const lift = countedCustomers > 0 ? Math.min(COUNTED_LIFT_CAP, countedCustomers) : 0;
  return {
    score: Math.min(100, base + lift),
    base,
    countedLift: lift,
    intentRatePer1k: Math.round(intentRate * 10) / 10,
    likeRatePer1k: Math.round(likeRate * 10) / 10,
  };
}

// Engagement roll-up over a creator's posts (profile strip):
// totals + per-post averages across the posts WITH reported
// metrics, and the count it rests on. Null when no post has
// reported metrics: thin data means the strip is absent,
// never a row of zeros.
function engagementOf(posts) {
  const reported = (posts || []).filter((p) => p && p.reportedAt);
  if (!reported.length) return null;
  const totals = { views: 0, likes: 0, shares: 0, saves: 0, intent: 0 };
  for (const p of reported) {
    totals.views += numOr0(p.views);
    totals.likes += numOr0(p.likes);
    totals.shares += numOr0(p.shares);
    totals.saves += numOr0(p.saves);
  }
  totals.intent = totals.shares + totals.saves;
  const n = reported.length;
  const avg = (v) => Math.round((v / n) * 10) / 10;
  return {
    postsWithMetrics: n,
    totals,
    averages: { views: avg(totals.views), likes: avg(totals.likes), shares: avg(totals.shares), saves: avg(totals.saves), intent: avg(totals.intent) },
    intentRatePer1k: totals.views ? Math.round((totals.intent / totals.views) * 1000 * 10) / 10 : null,
  };
}

// The intent block for a set of posts (readout aggregates):
// recorded-only sums (unreported posts contribute nothing, so
// the block can never zero-fill a creator who never reported).
function intentOfPosts(posts) {
  const reported = (posts || []).filter((p) => p && p.reportedAt);
  const totals = { views: 0, likes: 0, shares: 0, saves: 0 };
  for (const p of reported) {
    totals.views += numOr0(p.views);
    totals.likes += numOr0(p.likes);
    totals.shares += numOr0(p.shares);
    totals.saves += numOr0(p.saves);
  }
  const intent = totals.shares + totals.saves;
  return {
    reportedPosts: reported.length,
    views: totals.views,
    likes: totals.likes,
    shares: totals.shares,
    saves: totals.saves,
    intent,
    intentRatePer1k: totals.views ? Math.round((intent / totals.views) * 1000 * 10) / 10 : null,
  };
}

// The business funnel: Local reach (recorded views) -> Intent
// (recorded shares + saves) -> Visits counted (counted) ->
// Register revenue (counted). Each step carries its class on
// its face; a step with no data says so (reported: false)
// instead of borrowing a modeled substitute. Conversions are
// computed only where both steps have data.
function funnelOf(input) {
  const i = input || {};
  const reach = Math.max(0, Math.floor(Number(i.views) || 0));
  const intent = Math.max(0, Math.floor(Number(i.intent) || 0));
  const countedCustomers = Math.max(0, Math.floor(Number(i.countedCustomers) || 0));
  const registerRevenue = Math.max(0, Number(i.registerRevenue) || 0);
  const pct = (a, b) => (a > 0 && b > 0 ? Math.round((b / a) * 1000) / 10 : null);
  return {
    steps: [
      { key: "reach", label: "Local reach", value: reach, cls: "recorded", reported: (i.reportedPosts || 0) > 0 },
      { key: "intent", label: "Intent (saves + shares)", value: intent, cls: "recorded", reported: (i.reportedPosts || 0) > 0 },
      { key: "visits", label: "Visits counted", value: countedCustomers, cls: "counted", reported: countedCustomers > 0 },
      { key: "revenue", label: "Register revenue", value: Math.round(registerRevenue * 100) / 100, cls: "counted", reported: registerRevenue > 0 },
    ],
    conversions: {
      intentPerReachPct: pct(reach, intent),
      visitsPerIntentPct: pct(intent, countedCustomers),
      revenuePerVisit: countedCustomers > 0 && registerRevenue > 0 ? Math.round((registerRevenue / countedCustomers) * 100) / 100 : null,
    },
  };
}

module.exports = { INTENT_RATE_CAP, LIKE_RATE_CAP, COUNTED_LIFT_CAP, postIntent, returnScoreFor, engagementOf, intentOfPosts, funnelOf };
