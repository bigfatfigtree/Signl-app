// Training pairs for the learned match ranker (Build -149,
// Phase 3 readiness; data program step 5 of 5).
//
// The match engine's score is a hand-weighted formula
// (lib/match.js). Its eventual successor — a ranker whose
// weights are LEARNED from what businesses actually picked and
// what those picks delivered — trains on the rows built here:
// one row per creator SHOWN in one match impression, carrying
// the exact feature vector the formula scored (the impression
// capture stores `match.parts` verbatim), the brief it answered,
// and the joined outcome:
//
//   picked    the business picked this creator for that brief:
//             they applied to the campaign offer, were selected,
//             were booked on it, or received the direct offer
//             that a briefed Find produced (sourceBrief join).
//   delivery  where a booking exists and its post record (or
//             its no-show marks) settles it: on_time | late |
//             no_show. Null while the outcome is still open —
//             an unfinished visit is not a label.
//
// THE ACTIVATION RULE (hard, Jeff's ruling 2026-11-08): learned
// weights ship only when scripts/eval-ranker.mjs — run offline
// on REAL exported pairs — beats the hand formula on held-out
// picks AND Jeff approves. Nothing in this module, and nothing
// that reads its output, touches the live formula, any ranking,
// or any score. This module only READS records and events.
//
// The builder is a pure function of plain record arrays so the
// proof suite can drive it directly and the router can feed it
// the store's contents unchanged. It is deterministic (stable
// sort) and re-runnable: the same inputs always produce the
// same rows, deduped on impression id + creator id, so an
// export can be re-taken any time without double-counting.

// The feature fields of computeMatchScore's `parts`, in the
// order the eval harness reads them. Kept explicit so a parts
// shape change upstream surfaces here instead of silently
// training on a shifted vector.
const FEATURE_FIELDS = [
  "localPct",        // creator's audience share in the brief's market (null = unreported)
  "category",        // category component, 0-100
  "categorySignal",  // direct | adjacent | comp | none | neutral
  "budget",          // budget component, 0-100
  "budgetSignal",    // fits | ... | neutral | norate
  "reliability",     // reliability component, 0-100
  "reliabilityBasis",// real | neutral
  "deliveries",      // delivered posts behind the reliability read
  "onTimePct",       // on-time share where basis is real
  "momentum",        // Momentum + Line points total (read-only input)
  "trackBonus",      // 0-8, delivered outcomes in the brief's market
  "trackReach",      // local reach delivered in that market
  "trackPosts",      // posts delivered in that market
  "trackRedemptions",// visits redeemed in that market
];

function featuresOf(parts) {
  const p = parts || {};
  const out = {};
  for (const f of FEATURE_FIELDS) out[f] = p[f] === undefined ? null : p[f];
  return out;
}

// The delivery label of one booking, from its post record and
// its own no-show marks. A booking that has not settled yet
// (booked, post due, overdue inside the ladder) labels null:
// the visit's story is not finished, and an unfinished visit
// must never train as a failure.
function deliveryLabelFor(booking, post) {
  if (!booking) return null;
  if (post) return post.onTime ? "on_time" : "late";
  // Redemption window passed unused: the compliance ladder's
  // own no-show (booking.status "expired", never redeemed).
  if (booking.status === "expired" && !booking.redeemedAt) return "no_show";
  // Redeemed, then silence: the strike the compliance sweep
  // counted (or the extremely-late mark after the ban fuse) is
  // the platform's own settled no-show read.
  if (booking.compliance && booking.compliance.silentStrikeCounted) return "no_show";
  return null;
}

function buildTrainingRows({ impressions = [], applications = [], bookings = [], posts = [], offers = [] } = {}) {
  const appsByOffer = new Map();
  for (const a of applications) {
    if (!a || !a.offerId || !a.creatorId || a.status === "withdrawn") continue;
    if (!appsByOffer.has(a.offerId)) appsByOffer.set(a.offerId, []);
    appsByOffer.get(a.offerId).push(a);
  }
  const bookingByOfferCreator = new Map();
  for (const b of bookings) {
    if (!b || !b.offerId || !b.creatorId) continue;
    const key = `${b.offerId}:${b.creatorId}`;
    const prev = bookingByOfferCreator.get(key);
    // One booking per (offer, creator) is the product rule;
    // if history ever holds two, the earliest is the pick's.
    if (!prev || String(b.createdAt || "") < String(prev.createdAt || "")) bookingByOfferCreator.set(key, b);
  }
  const postByBooking = new Map();
  for (const p of posts) {
    if (!p || !p.bookingId) continue;
    const prev = postByBooking.get(p.bookingId);
    if (!prev || String(p.submittedAt || p.createdAt || "") < String(prev.submittedAt || prev.createdAt || "")) postByBooking.set(p.bookingId, p);
  }
  const offersById = new Map();
  for (const o of offers) if (o && o.id) offersById.set(o.id, o);

  // The pick set of one offer: creatorId -> strongest stage.
  // applied < selected < booked; a direct offer's target is a
  // pick the moment the offer exists (stage "direct").
  const picksForOffer = (offer) => {
    const picks = new Map();
    const raise = (creatorId, stage) => {
      const rank = { applied: 1, direct: 1, selected: 2, booked: 3 };
      const cur = picks.get(creatorId);
      if (!cur || rank[stage] > rank[cur]) picks.set(creatorId, stage);
    };
    if (!offer) return picks;
    for (const a of appsByOffer.get(offer.id) || []) raise(a.creatorId, a.status === "selected" ? "selected" : "applied");
    for (const b of bookings) if (b && b.offerId === offer.id && b.creatorId) raise(b.creatorId, "booked");
    if (offer.creatorId) raise(offer.creatorId, "direct");
    return picks;
  };

  const rows = [];
  const seen = new Set();
  let impressionsUsed = 0;
  const labeledBriefs = new Set();
  for (const e of impressions) {
    if (!e || e.type !== "match_impression" || !e.data) continue;
    const shown = Array.isArray(e.data.shown) ? e.data.shown : [];
    if (!shown.length) continue;
    impressionsUsed += 1;
    const brief = e.data.brief || {};
    const campaignId = e.subjectId || brief.campaignId || null;
    const tsMs = Date.parse(e.ts || "") || 0;

    // Resolve the pick-bearing offers for this impression.
    // Campaign briefs join on the campaign offer itself (the
    // codebase's established evidence join). Briefs with no
    // campaign (a Find search) join through the offers the
    // SAME business composed from that brief within 7 days —
    // the sourceBrief threading (-144/-145/-146) is the only
    // bridge, and it is never inferred from offer content.
    const joined = []; // [{ offer, via }]
    if (campaignId && offersById.has(campaignId)) {
      joined.push({ offer: offersById.get(campaignId), via: "campaign" });
    } else if (!campaignId && e.actorId) {
      for (const o of offers) {
        const sb = o && o.sourceBrief;
        if (!sb || o.businessId !== e.actorId) continue;
        if ((sb.market || null) !== (brief.market || null)) continue;
        if ((sb.category || null) !== (brief.category || null)) continue;
        const created = Date.parse(o.createdAt || "") || 0;
        if (created < tsMs || created > tsMs + 7 * 86400000) continue;
        joined.push({ offer: o, via: "source_brief" });
      }
      joined.sort((a, b) => String(a.offer.createdAt || "").localeCompare(String(b.offer.createdAt || "")));
    }
    // creatorId -> { stage, offerId, via } across joined offers
    const pickByCreator = new Map();
    for (const { offer, via } of joined) {
      for (const [creatorId, stage] of picksForOffer(offer)) {
        const rank = { applied: 1, direct: 1, selected: 2, booked: 3 };
        const cur = pickByCreator.get(creatorId);
        if (!cur || rank[stage] > rank[cur.stage]) pickByCreator.set(creatorId, { stage, offerId: offer.id, via });
      }
    }

    let rankPos = 0;
    for (const s of shown) {
      rankPos += 1;
      if (!s || !s.creatorId) continue;
      const dedupeKey = `${e.id}:${s.creatorId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const pick = pickByCreator.get(s.creatorId) || null;
      let delivery = null;
      if (pick) {
        const bk = bookingByOfferCreator.get(`${pick.offerId}:${s.creatorId}`);
        if (bk) delivery = deliveryLabelFor(bk, postByBooking.get(bk.id));
      }
      if (pick) labeledBriefs.add(e.id);
      rows.push({
        impressionId: e.id,
        creatorId: s.creatorId,
        ts: e.ts || null,
        actorId: e.actorId || null,
        briefSource: brief.source || null,
        campaignId,
        via: e.data.via || null,
        joinVia: pick ? pick.via : (joined.length ? joined[0].via : null),
        market: brief.market || e.market || null,
        category: brief.category || null,
        kind: brief.kind || null,
        budget: brief.budget != null ? brief.budget : null,
        rank: rankPos,
        shownCount: shown.length,
        score: typeof s.score === "number" ? s.score : null,
        features: featuresOf(s.parts),
        picked: pick ? 1 : 0,
        pickStage: pick ? pick.stage : null,
        offerId: pick ? pick.offerId : null,
        delivery,
      });
    }
  }
  rows.sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")) || String(a.impressionId).localeCompare(String(b.impressionId)) || a.rank - b.rank);
  const pickedRows = rows.filter((r) => r.picked).length;
  const summary = {
    impressions: impressionsUsed,
    rows: rows.length,
    pickedRows,
    labeledBriefs: labeledBriefs.size,
    deliveredRows: rows.filter((r) => r.delivery).length,
    onTimeRows: rows.filter((r) => r.delivery === "on_time").length,
    lateRows: rows.filter((r) => r.delivery === "late").length,
    noShowRows: rows.filter((r) => r.delivery === "no_show").length,
  };
  return { rows, summary };
}

module.exports = { buildTrainingRows, deliveryLabelFor, featuresOf, FEATURE_FIELDS };
