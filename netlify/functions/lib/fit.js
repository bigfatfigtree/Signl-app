// Matching fit layer (Jeff, 2026-10-23): FIT + EXPLAIN.
// Pre-launch matching for SIGNL. Given one business and one
// creator profile, it answers two questions in plain language:
// how well do they fit (0-100), and why. Every point comes from a
// signal actually stored on the two records, and every point is
// paired with the reason string that explains it: no reason, no
// points. There is NO machine learning here and nothing learned:
// the weights below are hand-set, documented, and visible. A
// learned re-ranker has a seam at the bottom of this file for when
// visit-outcome data exists to learn from; today it is the
// identity function.
//
// What fit deliberately does NOT score: audience size, tier, and
// Momentum. Fit is about MATCH, not popularity: a 550-follower
// neighbor who posts the right content in the right city out-fits
// a 90k account in the wrong category and the wrong town. (The
// discovery default order stays founding priority / Momentum-led
// exactly as before; fit is an explicit sort a business opts into,
// plus an explanation line on the card.)
//
// WEIGHTS (max 100):
//   Category   36  direct map hit 36 / adjacent category 20 /
//                  creator accepts the matching comp category 16.
//                  Only the strongest category signal scores.
//   Geography  28  creator home city == business city 24 /
//                  creator home city inside the business market's
//                  published town list 14 / +4 when the creator's
//                  neighborhood (or a realtor's coverage area)
//                  matches the business's neighborhood. Cap 28.
//   Local      18  local audience %: >=60 -> 18, >=40 -> 13,
//                  >=25 -> 8, >0 -> 4, unreported -> 0.
//   Profession  8  the creator's day job is the business's trade
//                  (see PROFESSION_FIT).
//   Ratings    10  ONLY at 3+ business ratings (the public
//                  threshold): avg >=4.5 -> 10, >=4.0 -> 7,
//                  >=3.5 -> 4. Below 3 ratings, ratings say
//                  nothing at all, exactly like the /c/ page.
//
// Category vocabulary is the app's own (markets.js
// CREATOR_CATEGORIES / BUSINESS_CATEGORIES / COMP_CATEGORIES);
// the maps below translate between them, they do not invent a
// new taxonomy.

const { MARKETS, normalizeMarketName } = require("./markets");

const WEIGHTS = {
  categoryDirect: 36,
  categoryAdjacent: 20,
  categoryComp: 16,
  geoSameCity: 24,
  geoSameMarket: 14,
  geoNeighborhood: 4,
  geoCap: 28,
  localBands: [
    { min: 60, points: 18 },
    { min: 40, points: 13 },
    { min: 25, points: 8 },
    { min: 1, points: 4 },
  ],
  profession: 8,
  ratingBands: [
    { min: 4.5, points: 10 },
    { min: 4.0, points: 7 },
    { min: 3.5, points: 4 },
  ],
  ratingMinCount: 3,
};

// Business category -> the creator content categories that fit
// it. "primary" is the creator category that IS the business's
// trade (a restaurant lives on Food & Drink content); "adjacent"
// is a neighboring beat that still fits (a restaurant also fits a
// Nightlife creator: drinks, evenings out).
const CATEGORY_FIT = {
  "Restaurant": { primary: ["Food & Drink"], adjacent: ["Nightlife"] },
  "Bar": { primary: ["Nightlife"], adjacent: ["Food & Drink"] },
  "Coffee & Bakery": { primary: ["Food & Drink"], adjacent: [] },
  "Salon & Barbershop": { primary: ["Beauty & Grooming"], adjacent: [] },
  "Fitness Studio": { primary: ["Fitness & Wellness"], adjacent: ["Health & Wellness"] },
  "Retail": { primary: ["Retail & Shopping"], adjacent: [] },
  "Attraction": { primary: ["Attractions & Events"], adjacent: ["Nightlife"] },
  "Local Services": { primary: ["Local Services"], adjacent: [] },
  "Other": { primary: [], adjacent: [] },
};

// Business category -> the comp categories (what a creator says
// they would accept) that mean the creator is open to this kind
// of business's comp.
const COMP_FIT = {
  "Restaurant": ["Restaurant meals"],
  "Bar": ["Drinks & nightlife"],
  "Coffee & Bakery": ["Restaurant meals"],
  "Salon & Barbershop": ["Beauty services"],
  "Fitness Studio": ["Fitness classes & passes", "Health & wellness services"],
  "Retail": ["Retail products"],
  "Attraction": ["Attractions & experiences"],
  "Local Services": ["Local services"],
  "Other": ["Other"],
};

// Creator profession (markets.js PROFESSIONS) -> the business
// categories where that day job is directly on-topic. A real
// estate agent registers as a business under Local Services in
// this taxonomy, and a realtor creator's content is homes and
// neighborhoods, which is a local service's whole story.
const PROFESSION_FIT = {
  "Real estate agent": { categories: ["Local Services"], reason: "Real estate agent: posts homes and neighborhoods for a living" },
  "Food & drink": { categories: ["Restaurant", "Coffee & Bakery", "Bar"], reason: "Works in food & drink" },
  "Beauty & style": { categories: ["Salon & Barbershop"], reason: "Works in beauty & style" },
  "Fitness & wellness": { categories: ["Fitness Studio"], reason: "Works in fitness & wellness" },
  "Photographer / videographer": { categories: ["Attraction", "Retail"], reason: "Photographer / videographer: shoots places and products for a living" },
};

// Short labels for the creator-side fit note ("Strong fit: your
// food content, Raleigh").
const CATEGORY_SHORT = {
  "Food & Drink": "food",
  "Nightlife": "nightlife",
  "Beauty & Grooming": "beauty",
  "Fitness & Wellness": "fitness",
  "Health & Wellness": "wellness",
  "Retail & Shopping": "shopping",
  "Attractions & Events": "events",
  "Local Services": "local services",
};

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function marketCities(marketName) {
  if (!marketName) return [];
  const m = MARKETS.find((x) => x.name === normalizeMarketName(marketName));
  return m ? m.cities || [] : [];
}

// computeFit(business, creator) -> { score, reasons, parts }
//   business: { category, market, city, neighborhood }
//   creator:  { categories, compCategories, homeCity,
//               neighborhood, farmAreas, tier, totalAudience,
//               localAudiencePct, profession, ratingAvg,
//               ratingCount, momentumPoints }
// Every field is optional; missing data scores nothing and says
// nothing. tier / totalAudience / momentumPoints are accepted so
// callers can pass the whole profile (and so the learned seam
// below has them in reach); today's weights give them 0 on
// purpose. `parts` exposes which signals fired so callers (the
// creator-side fit note) do not have to re-derive them.
function computeFit(business, creator) {
  const b = business || {};
  const c = creator || {};
  const reasons = [];
  const parts = {
    category: null, // "direct" | "adjacent" | "comp" | null
    categoryLabel: null, // the creator category / comp that matched
    sameCity: false,
    sameMarket: false,
    neighborhood: false,
    profession: false,
    rated: false,
  };
  let score = 0;

  // ---- category ----
  const bizCat = b.category || "";
  const fit = CATEGORY_FIT[bizCat] || { primary: [], adjacent: [] };
  const cats = Array.isArray(c.creatorCategories) ? c.creatorCategories : (Array.isArray(c.categories) ? c.categories : []);
  const direct = fit.primary.find((x) => cats.includes(x));
  const adjacent = !direct ? fit.adjacent.find((x) => cats.includes(x)) : null;
  const compCats = Array.isArray(c.compCategories) ? c.compCategories : [];
  const compHit = !direct && !adjacent ? (COMP_FIT[bizCat] || []).find((x) => compCats.includes(x)) : null;
  if (direct) {
    score += WEIGHTS.categoryDirect;
    parts.category = "direct";
    parts.categoryLabel = direct;
    reasons.push(`Posts ${direct} content`);
  } else if (adjacent) {
    score += WEIGHTS.categoryAdjacent;
    parts.category = "adjacent";
    parts.categoryLabel = adjacent;
    reasons.push(`Also posts ${adjacent} content, a close fit for a ${bizCat}`);
  } else if (compHit) {
    score += WEIGHTS.categoryComp;
    parts.category = "comp";
    parts.categoryLabel = compHit;
    reasons.push(`Open to comp: ${compHit}`);
  }

  // ---- geography ----
  const bizCity = norm(b.city);
  const homeCity = String(c.homeCity || "").trim();
  const homeNorm = norm(homeCity);
  let geo = 0;
  if (bizCity && homeNorm && bizCity === homeNorm) {
    geo += WEIGHTS.geoSameCity;
    parts.sameCity = true;
    reasons.push(`Based in ${homeCity}`);
  } else if (homeNorm && marketCities(b.market).some((x) => norm(x) === homeNorm)) {
    geo += WEIGHTS.geoSameMarket;
    parts.sameMarket = true;
    reasons.push(`Based in ${homeCity}, in the ${normalizeMarketName(b.market) || b.market} market`);
  }
  const bizNb = norm(b.neighborhood);
  if (bizNb) {
    const areas = [
      { value: String(c.neighborhood || "").trim(), realtor: false },
      ...(Array.isArray(c.farmAreas) ? c.farmAreas : []).map((x) => ({ value: String(x || "").trim(), realtor: true })),
    ].filter((a) => a.value);
    const hit = areas.find((a) => {
      const an = norm(a.value);
      return an && (an === bizNb || an.includes(bizNb) || bizNb.includes(an));
    });
    if (hit) {
      geo += WEIGHTS.geoNeighborhood;
      parts.neighborhood = true;
      // A realtor's coverage tag reads as coverage; the creator's
      // own neighborhood reads as where they are.
      reasons.push(hit.realtor ? `Covers ${hit.value}` : `In ${hit.value}, your neighborhood`);
    }
  }
  score += Math.min(geo, WEIGHTS.geoCap);

  // ---- local audience ----
  const pct = c.localAudiencePct === null || c.localAudiencePct === undefined ? NaN : Number(c.localAudiencePct);
  if (Number.isFinite(pct) && pct > 0) {
    const band = WEIGHTS.localBands.find((x) => pct >= x.min);
    if (band) {
      score += band.points;
      reasons.push(`${Math.round(pct)}% local audience`);
    }
  }

  // ---- profession ----
  const prof = PROFESSION_FIT[c.profession || ""];
  if (prof && prof.categories.includes(bizCat)) {
    score += WEIGHTS.profession;
    parts.profession = true;
    reasons.push(prof.reason);
  }

  // ---- ratings (only once they mean something: 3+) ----
  const ratingCount = Number(c.ratingCount) || 0;
  const ratingAvg = c.ratingAvg === null || c.ratingAvg === undefined ? NaN : Number(c.ratingAvg);
  if (ratingCount >= WEIGHTS.ratingMinCount && Number.isFinite(ratingAvg)) {
    const band = WEIGHTS.ratingBands.find((x) => ratingAvg >= x.min);
    if (band) {
      score += band.points;
      parts.rated = true;
      reasons.push(`Rated ${ratingAvg} by ${ratingCount} businesses`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return applyLearnedRerank({ score, reasons, parts }, { business: b, creator: c });
}

// buildFitNote(fit, business, creator) -> string | null
// The creator-side "Strong fit" line for an open offer. It shows
// only on a genuinely strong match: a direct or adjacent category
// overlap, or the creator based in the business's own city. Weak
// or empty matches get silence (null), never a dressed-up nudge.
// Pattern: "Strong fit: your food content, Raleigh".
function buildFitNote(fit, business, creator) {
  if (!fit || !fit.parts) return null;
  const b = business || {};
  const c = creator || {};
  const p = fit.parts;
  const categoryStrong = p.category === "direct" || p.category === "adjacent";
  if (!categoryStrong && !p.sameCity) return null;
  const segments = [];
  if (categoryStrong && p.categoryLabel) {
    segments.push(`your ${CATEGORY_SHORT[p.categoryLabel] || p.categoryLabel.toLowerCase()} content`);
  }
  if (p.sameCity) {
    segments.push(String(c.homeCity || b.city || "").trim());
  } else if (categoryStrong && p.sameMarket) {
    segments.push(normalizeMarketName(b.market) || b.market || "");
  }
  if (!segments.filter(Boolean).length) return null;
  if (!categoryStrong && p.sameCity) {
    return `Strong fit: based in ${segments[0]}`;
  }
  return `Strong fit: ${segments.filter(Boolean).join(", ")}`;
}

// ---------- learned re-ranker seam (NOT BUILT - identity) ----------
// When SIGNL has visit outcomes at scale, a learned model can
// adjust the hand-set score above: which fits actually produced
// an on-time post, a register tally worth having, a rebook. The
// outcome fields it will train on are ALREADY being collected:
//   - bookings: redeemedAt, status (visit happened)
//   - posts: onTime flag on the compliance clock (post vs the
//     48-hour window), post-performance reports
//   - ROAS: per-booking register tallies businesses report
//   - events: rebook_sent / offer_accepted (the repeat signal)
// Contract for whoever builds it: applyLearnedRerank(fit,
// context) receives the rule-based { score, reasons, parts } and
// { business, creator } (creator carries tier, totalAudience and
// momentumPoints precisely so a learned model may use what the
// rules refuse to), and returns the same shape. Two hard rules:
// (1) any adjustment must APPEND its own plain-language reason —
// the "no reason, no points" invariant does not relax for a
// model; (2) fit stays an explanation surface, never a gate: it
// may reorder an opt-in sort, it may not hide a creator.
// Until that model exists and has data worth trusting, this is
// the identity function ON PURPOSE. Do not put weights here
// early; a model trained on zero visits is a costume, not a
// ranking.
function applyLearnedRerank(fit /* , context */) {
  return fit;
}

module.exports = { computeFit, buildFitNote, applyLearnedRerank, WEIGHTS, CATEGORY_FIT, COMP_FIT, PROFESSION_FIT };
