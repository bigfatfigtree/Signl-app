// Match Engine v1 (Jeff, 2026-11-07): the BUSINESS-side match
// score. Where fit.js answers "does this creator fit my kind of
// business" from the business's own profile, the match score
// answers "who is best for THIS brief" — a campaign (an offer),
// or a Find search carrying a market, a category and a budget.
// It is computed per brief, never stored, and never a gate: it
// ranks and explains, it does not hide anyone.
//
// CREATOR-SIDE INVARIANT: this module only READS creator data.
// Momentum points are an input exactly as the creator earned
// them; nothing here changes how points are earned, shown, or
// spent on any creator surface.
//
// Every component follows the fit.js discipline: a component
// earns a plain-words reason only when it carries real signal,
// and a component with no signal scores a stated neutral instead
// of quietly zeroing a creator out (a new creator with no track
// record yet is unknown, not bad).
//
// WEIGHTS (components are 0-100, the weighted base is 0-100):
//   Local fit    35  the creator's audience share in the brief's
//                    market (audienceShareInMarket). Unreported
//                    share scores 0: the number Magpie sells is
//                    the number it ranks by, and an unreported
//                    share is not a share.
//   Category     20  brief category vs the creator's categories.
//                    Exact match 100. Business-vocabulary briefs
//                    (campaigns) read through fit.js CATEGORY_FIT:
//                    adjacent 55, comp acceptance 35. Creator-
//                    vocabulary briefs (Find filters): a category
//                    adjacent via a shared CATEGORY_FIT cluster
//                    scores 50, comp acceptance for the brief
//                    category's trade scores 30. No category on
//                    the brief: neutral 70, silent.
//   Budget       15  paid briefs only: creator paidRate against
//                    the brief budget (bands in budgetScore).
//                    Comped briefs (kind comp / coupon, or no
//                    budget stated) take the neutral 70: a comp
//                    has no rate to fit, so the component cannot
//                    separate anyone and says nothing.
//   Reliability  15  the real record once the creator has 3+
//                    delivered posts: (on-time + 0.5 x late) /
//                    redeemed visits, the applicant stack's own
//                    formula. Under 3 deliveries: neutral 70 —
//                    new creators are not buried for being new.
//   Momentum     15  min(100, total points): Momentum points +
//                    Your Line points, the same total the card
//                    and the applicant stack already use. READ
//                    ONLY: the score consumes the total, it never
//                    feeds back into it.
//   Track bonus  +8 max, added after the weighted base (the
//                    total caps at 100): delivered outcomes IN
//                    THE BRIEF'S MARKET — the loop closing. Local
//                    reach actually delivered there (bands below);
//                    a creator who has delivered posts there but
//                    has no reach figure on file still earns the
//                    floor of 2. Cold-start creators stay within
//                    reach of proven ones: the whole bonus is
//                    worth less than the local-fit gap between a
//                    strong and a middling local share.

const { CATEGORY_FIT, COMP_FIT } = require("./fit");

const WEIGHTS = { local: 0.35, category: 0.2, budget: 0.15, reliability: 0.15, momentum: 0.15 };
const NEUTRAL = 70;
const TRACK_CAP = 8;
const RELIABILITY_MIN_DELIVERIES = 3;

// Creator-category adjacency for creator-vocabulary briefs: two
// creator categories are adjacent when one business trade claims
// one as primary and the other as adjacent (or vice versa) in
// fit.js CATEGORY_FIT — the platform's own map of which beats
// sit next to each other, reused rather than re-invented.
const CREATOR_ADJACENT = (() => {
  const map = new Map();
  const link = (a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };
  for (const fit of Object.values(CATEGORY_FIT)) {
    for (const p of fit.primary || []) {
      for (const a of fit.adjacent || []) { link(p, a); link(a, p); }
    }
  }
  return map;
})();

// For a creator-vocabulary brief category, the comp categories
// that mean "open to that trade": the comp fits of every
// business category whose primary creator category IS the
// brief's category.
function compCatsForCreatorCategory(cat) {
  const out = new Set();
  for (const [bizCat, fit] of Object.entries(CATEGORY_FIT)) {
    if ((fit.primary || []).includes(cat)) {
      for (const cc of COMP_FIT[bizCat] || []) out.add(cc);
    }
  }
  return out;
}

function categoryScore(brief, creator) {
  const want = brief.category || null;
  if (!want) return { value: NEUTRAL, signal: "neutral", label: null };
  const cats = Array.isArray(creator.categories) ? creator.categories : [];
  const compCats = Array.isArray(creator.compCategories) ? creator.compCategories : [];
  if (brief.categoryKind === "business") {
    const fit = CATEGORY_FIT[want] || { primary: [], adjacent: [] };
    const direct = (fit.primary || []).find((x) => cats.includes(x));
    if (direct) return { value: 100, signal: "direct", label: direct };
    const adjacent = (fit.adjacent || []).find((x) => cats.includes(x));
    if (adjacent) return { value: 55, signal: "adjacent", label: adjacent };
    const compHit = (COMP_FIT[want] || []).find((x) => compCats.includes(x));
    if (compHit) return { value: 35, signal: "comp", label: compHit };
    return { value: 0, signal: "none", label: null };
  }
  // Creator vocabulary (Find filters carry creator categories).
  if (cats.includes(want)) return { value: 100, signal: "direct", label: want };
  const adj = CREATOR_ADJACENT.get(want);
  if (adj) {
    const hit = cats.find((x) => adj.has(x));
    if (hit) return { value: 50, signal: "adjacent", label: hit };
  }
  const compHit = [...compCatsForCreatorCategory(want)].find((x) => compCats.includes(x));
  if (compHit) return { value: 30, signal: "comp", label: compHit };
  return { value: 0, signal: "none", label: null };
}

// Paid-brief budget bands: at or under budget is a clean fit;
// the bands step down as the rate climbs past it. A creator with
// no listed rate cannot take a paid booking at any price, so
// the component is 0 and silent (the card already says they
// have no rate).
function budgetScore(brief, creator) {
  const budget = Number(brief.budget);
  if (brief.kind !== "paid" || !Number.isFinite(budget) || budget <= 0) {
    return { value: NEUTRAL, signal: "neutral" };
  }
  const rate = Number(creator.paidRate);
  if (!Number.isFinite(rate) || rate <= 0) return { value: 0, signal: "norate" };
  if (rate <= budget) return { value: 100, signal: "fits" };
  if (rate <= budget * 1.15) return { value: 80, signal: "over" };
  if (rate <= budget * 1.35) return { value: 55, signal: "over" };
  if (rate <= budget * 1.6) return { value: 30, signal: "over" };
  return { value: 10, signal: "over" };
}

function reliabilityScore(creator) {
  const onTime = Number(creator.postsOnTime) || 0;
  const late = Number(creator.postsLate) || 0;
  const redeemed = Number(creator.redeemed) || 0;
  const deliveries = onTime + late;
  if (deliveries < RELIABILITY_MIN_DELIVERIES) {
    return { value: NEUTRAL, basis: "neutral", deliveries, onTimePct: null };
  }
  const denom = Math.max(redeemed, deliveries);
  const value = Math.round((100 * (onTime + 0.5 * late)) / denom);
  return {
    value: Math.max(0, Math.min(100, value)),
    basis: "real",
    deliveries,
    onTimePct: deliveries ? Math.round((100 * onTime) / deliveries) : null,
  };
}

// Delivered local reach in the brief's market -> bonus points.
// Bands, not a curve: a business can be told exactly why a
// proven local deliverer earned the bump.
function trackBonusFor(track) {
  const reach = Number(track && track.reach) || 0;
  const posts = Number(track && track.posts) || 0;
  if (reach >= 20000) return 8;
  if (reach >= 5000) return 6;
  if (reach >= 1000) return 4;
  if (reach > 0) return 2;
  if (posts > 0) return 2;
  return 0;
}

function fmtReach(reach) {
  if (reach >= 1000) {
    const k = Math.round(reach / 100) / 10;
    return `${Number.isInteger(k) ? k.toFixed(0) : k}k`;
  }
  return String(Math.round(reach));
}

// computeMatchScore(brief, creator) -> { score, parts, reasons }
//   brief:   { market, category, categoryKind ("business" |
//              "creator"), kind ("paid" | "comp" | "coupon"),
//              budget (number | null) }
//   creator: { categories, compCategories, paidRate,
//              localPctInMarket (number | null), momentumPoints,
//              redeemed, postsOnTime, postsLate,
//              track: { reach, posts, redemptions } }
// reasons are the top 3 component reasons by weighted
// contribution, plus the track-record reason whenever the bonus
// fired (the example line Jeff approved carries all four).
function computeMatchScore(brief, creator) {
  const b = brief || {};
  const c = creator || {};

  const pctRaw = c.localPctInMarket === null || c.localPctInMarket === undefined ? NaN : Number(c.localPctInMarket);
  const localPct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, Math.round(pctRaw))) : null;
  const local = localPct === null ? 0 : localPct;

  const cat = categoryScore(b, c);
  const bud = budgetScore(b, c);
  const rel = reliabilityScore(c);

  const totalPoints = Math.max(0, Number(c.momentumPoints) || 0);
  const momentum = Math.min(100, totalPoints);

  const track = { reach: 0, posts: 0, redemptions: 0, ...(c.track || {}) };
  const trackBonus = trackBonusFor(track);

  const base = Math.round(
    WEIGHTS.local * local +
    WEIGHTS.category * cat.value +
    WEIGHTS.budget * bud.value +
    WEIGHTS.reliability * rel.value +
    WEIGHTS.momentum * momentum
  );
  const score = Math.max(0, Math.min(100, base + trackBonus));

  // ---- why-line candidates (a reason only where signal fired) ----
  const candidates = [];
  if (localPct !== null && localPct >= 30) {
    candidates.push({ key: "local", text: `${localPct}% local in ${b.market || "your market"}`, by: WEIGHTS.local * local });
  }
  if (cat.signal === "direct") {
    candidates.push({ key: "category", text: `Posts ${cat.label}`, by: WEIGHTS.category * cat.value });
  } else if (cat.signal === "adjacent") {
    candidates.push({ key: "category", text: `Also posts ${cat.label}, a close fit`, by: WEIGHTS.category * cat.value });
  } else if (cat.signal === "comp") {
    candidates.push({ key: "category", text: `Open to comp: ${cat.label}`, by: WEIGHTS.category * cat.value });
  }
  if (bud.signal === "fits") {
    candidates.push({ key: "budget", text: "Rate fits your budget", by: WEIGHTS.budget * bud.value });
  }
  if (rel.basis === "real" && rel.onTimePct !== null) {
    candidates.push({ key: "reliability", text: `${rel.onTimePct}% on-time`, by: WEIGHTS.reliability * rel.value });
  }
  if (totalPoints >= 25) {
    candidates.push({ key: "momentum", text: `Momentum ${totalPoints} pts`, by: WEIGHTS.momentum * momentum });
  }
  candidates.sort((x, y) => y.by - x.by);
  const reasons = candidates.slice(0, 3).map((x) => x.text);
  if (trackBonus > 0) {
    reasons.push(track.reach > 0
      ? `Delivered ${fmtReach(track.reach)} local reach here`
      : `Delivered ${track.posts} visit${track.posts === 1 ? "" : "s"} here`);
  }

  return {
    score,
    reasons,
    parts: {
      localPct,
      category: cat.value,
      categorySignal: cat.signal,
      categoryLabel: cat.label,
      budget: bud.value,
      budgetSignal: bud.signal,
      reliability: rel.value,
      reliabilityBasis: rel.basis,
      deliveries: rel.deliveries,
      onTimePct: rel.onTimePct,
      momentum: totalPoints,
      trackBonus,
      trackReach: track.reach,
      trackPosts: track.posts,
      trackRedemptions: track.redemptions,
    },
  };
}

module.exports = { computeMatchScore, WEIGHTS, NEUTRAL, TRACK_CAP, RELIABILITY_MIN_DELIVERIES, categoryScore, budgetScore, reliabilityScore, trackBonusFor };
