// Local Impact Score, computed ONLY from values actually stored on the
// creator profile and their real booking/post history. No invented
// inputs, no external data. Returns null when there is not enough
// stored data (no local audience figure yet).
//
// Formula (0 to 100):
//   55%  local audience share (self-reported until Meta verification)
//   25%  reliability: share of redeemed visits that produced a post,
//        weighted toward on-time posts, from real booking history.
//        A creator with no redeemed visits yet scores the neutral 50
//        on this component only, and the profile says so.
//   20%  engagement: average views as a share of followers, capped.
//        0 when the creator has not provided average views.
function computeLocalImpactScore(creator, history) {
  const localPct = creator.localAudiencePct;
  if (localPct === null || localPct === undefined || Number.isNaN(Number(localPct))) {
    return null;
  }
  const localComponent = Math.max(0, Math.min(100, Number(localPct)));

  let reliabilityComponent = 50; // neutral, no redeemed visits yet
  let reliabilityBasis = "No redeemed visits yet";
  if (history && history.redeemed > 0) {
    const onTime = history.postsOnTime || 0;
    const late = history.postsLate || 0;
    const missed = Math.max(0, history.redeemed - onTime - late);
    const raw = ((onTime * 1 + late * 0.5) / history.redeemed) * 100;
    reliabilityComponent = Math.round(raw);
    reliabilityBasis = `${history.redeemed} redeemed visit(s): ${onTime} on time, ${late} late, ${missed} missed`;
  }

  let engagementComponent = 0;
  if (creator.followerCount > 0 && creator.avgViews > 0) {
    const ratio = creator.avgViews / creator.followerCount; // typical 0.2 to 1.5
    engagementComponent = Math.round(Math.max(0, Math.min(100, ratio * 60)));
  }

  const score = Math.round(
    0.55 * localComponent + 0.25 * reliabilityComponent + 0.2 * engagementComponent
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    components: {
      localAudiencePct: Number(localPct),
      localAudienceSource: creator.localAudienceSource || "Self-reported",
      reliability: reliabilityComponent,
      reliabilityBasis,
      engagement: engagementComponent,
    },
  };
}

// Reliability summary from a creator's bookings + posts, used by the
// profile and the score. All counts come from stored records.
function summarizeHistory(bookings, posts) {
  const mine = bookings;
  const redeemed = mine.filter((b) => b.redeemedAt).length;
  let postsOnTime = 0;
  let postsLate = 0;
  for (const b of mine) {
    const post = posts.find((p) => p.bookingId === b.id);
    if (post) {
      if (post.onTime) postsOnTime += 1;
      else postsLate += 1;
    }
  }
  return { redeemed, postsOnTime, postsLate };
}

module.exports = { computeLocalImpactScore, summarizeHistory };
