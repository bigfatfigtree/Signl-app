// SIGNL API router. One Netlify Function (api.js) delegates here.
// All routes are under /api/*. Every state change writes an event via
// lib/events.js and stamps updatedAt on the record it touches.
const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { logEvent, listEvents } = require("./events");
const { MARKETS, TIERS, CREATOR_CATEGORIES, COMP_CATEGORIES, BUSINESS_CATEGORIES, PLANS, tierForFollowers, normalizeTierBand } = require("./markets");
const { computeLocalImpactScore, summarizeHistory } = require("./score");
const { emailEnabled, sendEmail } = require("./email");

// ------------------------------------------------------------------
// Launch shape (Jeff, 2026-10-18): creator founding sign-up is the
// only public account type at launch. Business registration is
// disabled (businesses join the founding list on joinsignl.com), and
// the marketplace (discovery, offers, bookings, counter, posts,
// messages) stays inactive in a market until an admin flips that
// market's "live" flag. All 39 markets default to NOT live.
//
// SIGNL_TEST_ALLOW_BUSINESS=1 is a TEST-ONLY override used by the
// verify suites: it re-enables business registration and treats every
// market as live so the gated business flows can still be exercised
// end to end. It must NEVER be set in the deploy environment (it is
// not in netlify.toml and must never be added there).
// ------------------------------------------------------------------
const TEST_MODE = process.env.SIGNL_TEST_ALLOW_BUSINESS === "1";
const LAUNCH_WINDOW_TEXT = "30 to 90 days";
const TERMS_VERSION = "2026-10-19";
// Headliners tier (15k+) only: on top of comps, these creators can also be
// hired for paid cash campaigns when a business runs one (Jeff, 2026-10-18).
const PAID_COMP = "Paid cash campaigns";
// Anyone, anywhere can sign up (Jeff, 2026-10-18): a creator whose city
// is not one of the listed markets registers under this pseudo-market
// with their own typed city + country (state/province optional, kept
// for older records). Their sign-ups are counted per city in admin
// stats, and when a city's count gets big enough it becomes a market.
// Nobody gets left out at the door.
const UNLISTED = "Not listed yet";
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;


const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// ---------- The Standard Visit (Jeff, 2026-10-19) ----------
// One package, identical for every creator and every business, so a
// selection is never a negotiation: the creator posts within 48 hours
// of the visit and the post stays live at least 30 days. What the
// business may DO with the post follows the business's plan (see
// visitRightsForPlan): Self-Service shares natively; Growth and
// Managed also repost on their own feed and may run the post as an
// ad while their account is active. Nobody, on any plan, edits the
// creator's content. Paid creator bookings are a separate lane
// (the creator's own listed rate, a 6% service fee split 3% to the
// business and 3% to the creator) and have nothing
// to do with these usage rights. This object is the single source of
// truth: it ships in bootstrap, on public profiles, on discovery
// cards, in the offer composer, and in the creator's offer checklist.
const STANDARD_VISIT = {
  name: "The Standard Visit",
  postWithinHours: 48,
  deliverables: ["1 post or reel", "2 stories"],
  postStaysLiveDays: 30,
  creatorDoes: "Show up, enjoy the comp, and post within 48 hours of the visit: 1 post or reel + 2 stories. Honest opinion, comp disclosed.",
  businessGets: [
    "The post, tracked and proven in the dashboard",
    "The post stays live on the creator's profile for at least 30 days",
  ],
  summary:
    "Every SIGNL visit includes: 1 post or reel + 2 stories within 48 hours of the visit, honest and disclosed, live at least 30 days, with tracked delivery proof. Content rights follow the business's plan: Self-Service shares the post natively with the creator tagged; Growth and Managed can also repost it on their own feed and run it as an ad while their account is active. Nobody can edit the creator's content.",
};

// ---------- The paid lane (Jeff, 2026-10-19) ----------
// Two lanes, one roster. The comp visit stays the default driver.
// A Paid Visit books a specific creator at HER OWN listed rate for
// the same Standard Visit package. The platform fee is 6% of the
// rate, split evenly: the business pays rate + 3%, the creator
// keeps 97% of her rate, and SIGNL holds the payment in escrow
// until the post is live. The subscription is the business; 6% is
// deliberately the lowest take in the industry, split evenly.
// Comp-only is always fine, forever: paid is an optional
// per-creator upgrade, never a ticket to the roster. Minimum
// listable rate $50 (below that, processing and support cost more
// than the booking returns). Escrow releases when post proof is
// submitted AND a 48 hour hold after proof passes; it refunds on a
// no-show or a creator ban under the compliance ladder. Pre-Stripe
// honesty: every paid booking is recorded with a founding-billing
// style label, no card charged, and nothing anywhere simulates a
// charge.
const PAID_LANE = {
  feePctTotal: 6,
  businessFeePct: 3,
  creatorFeePct: 3,
  minRate: 50,
  escrowHoldHoursAfterProof: 48,
  paymentNote: "Paid visit recorded, no card charged. SIGNL holds the payment until the post is live.",
};
function paidMath(rate) {
  const r = Math.round(Number(rate) * 100) / 100;
  return {
    rate: r,
    businessTotal: Math.round(r * (1 + PAID_LANE.businessFeePct / 100) * 100) / 100,
    creatorNet: Math.round(r * (1 - PAID_LANE.creatorFeePct / 100) * 100) / 100,
    platformFee: Math.round(r * (PAID_LANE.feePctTotal / 100) * 100) / 100,
  };
}
// Managed-plan businesses carry a monthly talent budget: a
// spending cap + authorization the SIGNL coordinator spends on
// paid creator bookings. It is NOT a held deposit; each booking
// escrows on its own. Suggested default $500.
const MANAGED_TALENT_BUDGET_DEFAULT = 500;

// ---------- Refinement bundle (Jeff, 2026-10-20 late) ----------
// Four product rules shipped together:
// 1. COVERS: every comp offer states how many people the comp
//    covers (1 or 2). The entourage problem: a creator showing up
//    with three friends on a comp written for one is a register
//    fight nobody wins, so the number is a required choice in the
//    composer, stamped onto the booking, and shown on every card
//    including the staff redemption card. Records written before
//    this shipped read as 1.
// 2. PAID BRIEF: paid visits (offers and direct bookings) may
//    carry short key points for the creator. Paid buys direction,
//    not a verdict: key points only, never a script, never
//    required praise, never post pre-approval. Comp offers cannot
//    carry a brief; the server refuses one.
// 3. STRIKES: a booked visit whose redemption window expires
//    unused is a strike. Three strikes pause the account pending
//    admin review. Honor-voided and business-cancelled bookings
//    never strike. Reinstatement is admin-only and resets the
//    count to one short of the limit (probation), so one more
//    expired window pauses the account again.
// 4. The creator free line, word for word, everywhere creators
//    meet SIGNL. It is carefully worded to stay true: joining,
//    listing, and comp bookings are free; the only creator-side
//    fee anywhere is the 3% share of the 6% platform fee on PAID
//    bookings, and that math never sits next to the word free.
const CREATOR_FREE_LINE = "SIGNL is free for creators. Always. Businesses pay the platform. You never pay to join, to list, or to get booked.";
const PAID_BRIEF_MAX = 500;
const PAID_BRIEF_GUIDANCE = "Key points only: what to feature, names, dates. Creators post honestly in their own words. No scripts, no required praise, no post pre-approval.";
const STRIKE_LIMIT = 3;
// Reinstatement from a strike pause restarts the count here: one
// short of the limit, so exactly one more expired window pauses
// the account again. The pause email tells the creator this.
const STRIKE_PROBATION_COUNT = STRIKE_LIMIT - 1;
const VISIT_GUARANTEE_LINE = "Visit Guarantee: if a booked creator does not show up or does not post, that visit does not count against your monthly visits. It is replaced.";

function coversOf(record) {
  const n = Number(record && record.covers);
  return n === 2 ? 2 : 1;
}

function coversText(record) {
  return coversOf(record) === 2 ? "Comp covers 2 people" : "Comp covers you";
}

function noShowStrikesOf(user) {
  const n = Number(user && user.noShowStrikes);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function strikePauseReason() {
  return "Three booked visit windows expired unused. The account is paused pending a SIGNL review.";
}

function strikePaused(user) {
  return !!(user && user.standing && user.standing.source === "strikes" && user.standing.state === "paused");
}

// What a business hears when it tries to book a paused creator,
// and what a paused creator hears about their own account. A
// strike pause is NOT lifted by pasting a post link, so the copy
// must never promise that route for it.
function pausedPickMessage(creator) {
  return strikePaused(creator)
    ? "That creator is paused pending a SIGNL review. Pick another creator for now."
    : "That creator is paused until a late post lands. Pick another creator for now.";
}

function pausedSelfMessage(user) {
  return strikePaused(user)
    ? "Your account is paused pending a SIGNL review after three booked visit windows expired unused. The team reviews every pause by hand; questions: hello@joinsignl.com."
    : "Your account is paused until the late post from your last visit is checked off. Paste the post link under My Visits and offers open again.";
}

// The plain-language line a creator sees about their own strikes.
function strikeStatusLine(user) {
  const n = noShowStrikesOf(user);
  if (!n) return null;
  return `Visit strikes: ${n} of ${STRIKE_LIMIT}. Letting a booked visit window expire counts as a strike. Three strikes pauses your account for review.`;
}

// Plan payment stays concierge (Jeff, 2026-10-20): the plan is
// recorded in-app at sign-up, NO card is charged by the app, and
// no payment link is shown in the app. When SIGNL activates a
// business, Jeff sends the payment step by hand.

// ---------- Offer flow v2: open offers, applications, backfill ----------
// (Jeff, 2026-10-20; design: files/signl-offer-flow-design.md.)
// Two lanes, one standardized package. DIRECT offers invite a
// specific creator (the original flow). OPEN offers post terms to
// the market: creators apply with ONE TAP (their profile card
// attaches automatically, never a free-text pitch), the business
// selects from a ranked stack, and nobody is ghosted: every
// applicant ends in a notified terminal state.
//
// Timeline rules, implemented consistently everywhere:
//   - Applications are open for applyWindowDays (default 3) from
//     publish, and never past the redemption window start.
//   - The redemption window starts no earlier than the application
//     window close (windowStartAt is clamped up to it) and runs
//     windowDays (default 7).
//   - SELECTION DEADLINE = the earlier of (applications close +
//     72 hours) and the redemption window start. When it passes
//     with applicants still waiting, the sweep releases them all
//     with a notification and the offer expires: the business can
//     repost, but it cannot hold creators hostage.
//   - Application stack cap: live applications are capped at
//     spots x APPLICATION_STACK_PER_SPOT, so a business always has
//     a backfill bench (2 alternates per spot) and never faces an
//     unbounded pile.
//   - BACKFILL: when a selected creator declines, no-shows, or
//     lets the redemption window expire, the spot offers to the
//     next ranked still-applied applicant, who gets a bounded
//     24 hour accept window; on expiry or decline it moves to the
//     next, then the offer falls back to the open pool.
//   - COACHING NUDGE: an open offer with zero applications 48
//     hours after publish earns the business an in-app attention
//     item and an email with one-tap fixes (raise the comp, widen
//     the window).
// DIGNITY FLOOR: a comp offer may not target a tier whose floor
// its value does not meet. The block is soft and explained (raise
// the value or drop the tier), never silent. Where it applies:
//   - Open lane with target tiers: hard soft-block per tier.
//   - Open lane untargeted: a $25 absolute minimum (the Neighbors
//     floor), and eligibility does the rest: an untargeted comp
//     only reaches creators whose tier floor its value clears, so
//     a $25 coffee flight finds Neighbors and never insults a
//     Headliner. Targeting a tier explicitly is the way to reach
//     it, at that tier's floor or better.
//   - Direct lane (one invited creator who can decline): the
//     composer warns, the server does not block; the invitation
//     is a conversation, not a tier posting.
// Cash offers use the paid-lane floor instead ($50,
// PAID_LANE.minRate).
const COMP_GUIDANCE = {
  Neighbors: { floor: 25, typicalLow: 25, typicalHigh: 75 },
  Locals: { floor: 50, typicalLow: 50, typicalHigh: 150 },
  Headliners: { floor: 100, typicalLow: 100, typicalHigh: 250 },
};
const SELECTION_SLA_HOURS = 72;
const BACKFILL_ACCEPT_HOURS = 24;
const OFFER_NUDGE_HOURS = 48;
const APPLICATION_STACK_PER_SPOT = 3;
const OFFER_TEMPLATES = [
  { id: "grand-opening", label: "Grand Opening", title: "Grand opening: be one of our first guests", spots: 3, windowDays: 7, note: "Opening week: come any time we are open." },
  { id: "new-menu", label: "New Menu", title: "New menu tasting", spots: 2, windowDays: 7, note: "Our new menu just launched." },
  { id: "slow-weekday", label: "Slow Weekday", title: "Weekday visit, bring a friend", spots: 2, windowDays: 5, note: "Monday to Thursday visits help us most." },
  { id: "seasonal", label: "Seasonal", title: "Seasonal special feature", spots: 2, windowDays: 7, note: "Limited-time seasonal special." },
];

async function allApplications() {
  const rows = await store.list("application:");
  return rows.map((r) => r.value);
}

// In-app notification: a small record the dashboards read. This is
// the surface that guarantees "no ghosting": every application
// state change writes one for the creator, and offer events write
// them for the business.
async function notifyUser(userId, kind, text, data = {}) {
  const rec = { id: crypto.randomUUID(), userId, kind, text, data, createdAt: nowIso(), readAt: null };
  await store.set(`note:${userId}:${rec.id}`, rec);
  return rec;
}

function laneOf(offer) {
  if (offer.lane) return offer.lane;
  return offer.creatorId ? "direct" : "open";
}
function kindOf(offer) {
  return offer.kind === "paid" ? "paid" : "comp";
}

// The tiers an offer may target given its comp value. Returns the
// first (highest) tier whose dignity floor the value misses, or
// null when every targeted tier clears its floor.
function dignityBlock(dollarCap, targetTiers) {
  const tiers = targetTiers && targetTiers.length ? targetTiers : Object.keys(COMP_GUIDANCE);
  for (const t of ["Headliners", "Locals", "Neighbors"]) {
    if (tiers.includes(t) && dollarCap < COMP_GUIDANCE[t].floor) return { tier: t, floor: COMP_GUIDANCE[t].floor };
  }
  return null;
}

// Offer strength checklist (the coaching meter): the same four
// signals the composer shows live. Computed from stored fields
// only, so the business home and the composer can never disagree.
function offerStrength(offer) {
  const windowDays = offer.windowEndAt && offer.windowStartAt
    ? Math.max(0, Math.round((Date.parse(offer.windowEndAt) - Date.parse(offer.windowStartAt)) / DAY_MS))
    : offer.windowMode === "thisweek" ? 7 : 7;
  const checks = [
    { key: "value", label: "Comp value (or cash rate) is stated", ok: kindOf(offer) === "paid" ? Number(offer.cashRate) >= PAID_LANE.minRate : Number(offer.dollarCap) > 0 },
    { key: "window", label: "Redemption window is 3+ days", ok: windowDays >= 3 },
    { key: "includes", label: "What is included is written out", ok: String(offer.includes || offer.whatComped || "").trim().length >= 12 },
    { key: "experience", label: "The experience is described", ok: String(offer.experience || "").trim().length >= 12 },
  ];
  return { checks, score: checks.filter((c) => c.ok).length, total: checks.length, windowDays };
}

// The offer timeline, from the rules at the top of this section.
// publishMs is when the offer went (or goes) open.
function offerTimeline({ applyWindowDays = 3, windowDays = 7, windowStartAt = null }, publishMs) {
  const applyDays = Math.min(14, Math.max(1, Math.round(Number(applyWindowDays) || 3)));
  const winDays = Math.min(30, Math.max(1, Math.round(Number(windowDays) || 7)));
  const applicationsCloseMs = publishMs + applyDays * DAY_MS;
  let startMs = windowStartAt ? Date.parse(windowStartAt) : NaN;
  if (Number.isNaN(startMs) || startMs < applicationsCloseMs) startMs = applicationsCloseMs;
  const endMs = startMs + winDays * DAY_MS;
  const deadlineMs = Math.min(applicationsCloseMs + SELECTION_SLA_HOURS * 3600 * 1000, startMs);
  return {
    applyWindowDays: applyDays,
    windowDays: winDays,
    applicationsCloseAt: new Date(applicationsCloseMs).toISOString(),
    windowStartAt: new Date(startMs).toISOString(),
    windowEndAt: new Date(endMs).toISOString(),
    selectionDeadline: new Date(deadlineMs).toISOString(),
  };
}


// ---------- The SIGNL ROAS Score (Jeff, 2026-10-19) ----------
// SIGNL's own return-on-spend model, and the math is published
// wherever the score renders: it is always labeled "SIGNL ROAS
// Score, our own model", with its component lines shown. Two
// honesty rules are baked into the framing strings below and must
// never drift: the register side is TRACKED spend rung up with a
// creator's audience code, which makes it a FLOOR (customers who
// never used a code are not counted), and the media side is
// MODELED at the rates in ROAS_MODEL from creator-reported post
// numbers. Nothing anywhere calls any of this "revenue
// generated": the code measures influenced, tracked spend.
//
// The loop, per booking (comp or paid):
//   - The booking carries a creatorCode: this creator's audience
//     code at this business. The creator shares it in the post,
//     and every use is rung up at the business's own register
//     (SIGNL never integrates with a POS, ever). A code DISCOUNT
//     is the business's choice, never a default (Jeff,
//     2026-10-19): the business turns code discounts on and picks
//     the percentage (discountEnabled / discountPct on the
//     business record); a booking is stamped with the business's
//     percentage when codes are on and 0 when they are off. The
//     code is issued either way: with no discount it is a
//     counting code, and no surface may promise the audience a
//     percentage off the business never offered.
//   - The business reports the tally back on the booking: how
//     many code redemptions, and the total basket value rung with
//     the code (POST /bookings/:id/code-redemptions).
//   - COST = what the visit cost the business: compCostActual
//     (the comp's cost to the business; the business reports its
//     own cost, so a $50 menu comp can be a $15 cost, the markdown
//     is theirs to state, never a percentage we invent) + the
//     discount cost of the code redemptions (basket x discount%).
//     The ALL-IN variant adds the plan allocation: the plan's
//     monthly price divided by its monthly visit allowance.
//   - VALUE = registerValue (tracked basket spend) + mediaValue
//     (the delivered post, priced at the model rates below from
//     the creator's post-performance report; zero with no report).
//   - SCORE = value / cost; ALL-IN = value / (cost + allocation).
// Aggregation sums values and costs first and divides once; scores
// are never averaged. A zero cost basis returns a null score,
// never NaN or Infinity.
// suggestedDiscountPct is only ever a SUGGESTION shown to a
// business when it turns code discounts on; it is never applied
// as a default stamp (see discountSettingOf below).
const ROAS_MODEL = { cpm: 22, like: 0.10, comment: 0.50, share: 1.00, suggestedDiscountPct: 20 };
const ROAS_LABEL = "SIGNL ROAS Score, our own model";
const ROAS_REGISTER_BASIS = "Register value is spend tracked through the creator's audience code, rung up at the business's own register. It is a floor: customers who never used a code are not counted.";
const ROAS_MEDIA_BASIS = `Media value is modeled at SIGNL's published rates ($${ROAS_MODEL.cpm} per 1,000 views, $${ROAS_MODEL.like.toFixed(2)} per like, $${ROAS_MODEL.comment.toFixed(2)} per comment, $${ROAS_MODEL.share.toFixed(2)} per share) on the creator's reported post numbers.`;

function roasRound2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// The audience code a creator shares for one business: their
// handle, uppercased and stripped to letters and numbers, plus a
// short random suffix. Human-readable on purpose (it gets said
// out loud in a post and typed at a register). Uniqueness is
// guarded by the ccode: index, the same discipline as booking
// codes; the code lives on the booking and is shown to the
// creator, never on public profiles.
function creatorCodeBase(handle) {
  const base = String(handle || "CREATOR").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return base || "CREATOR";
}
async function genCreatorCode(handle) {
  const base = creatorCodeBase(handle);
  for (let attempt = 0; attempt < 12; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) suffix += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    const code = `${base}-${suffix}`;
    const taken = await store.get(`ccode:${code}`);
    if (!taken) return code;
  }
  throw new Error("Could not allocate a creator code");
}

// The post-performance numbers a booking's score reads: the post
// record when one is attached (the withPostState shape), else
// numbers carried on the booking object itself (preview and
// fixtures). A post that exists but was never reported counts as
// no report: media value stays zero, never zero-filled fiction.
function roasPerformanceOf(booking) {
  const src = booking.post || booking.performance || booking;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const views = num(src.views);
  const likes = num(src.likes);
  const comments = num(src.comments);
  const shares = num(src.shares);
  const reported = !!(src.reportedAt || views || likes || comments || shares);
  return { views, likes, comments, shares, reported };
}

// One helper for every ROAS surface (Jeff, 2026-10-19). Takes any
// set of booking-shaped objects; each may carry redemptions
// {count, basketTotal, discountPct}, compCostActual (falling back
// to the comp's stated value, dollarCap), a post or performance
// numbers, and a planAllocation (dollars per visit) or a plan
// {priceMonthly, visitsPerMonth}. Returns the summed components
// and the two scores.
function roasFor(bookings) {
  let registerValue = 0;
  let mediaValue = 0;
  let compCost = 0;
  let discountCost = 0;
  let planAllocation = 0;
  let planKnown = bookings.length > 0;
  let redemptionCount = 0;
  let basketTotalAll = 0;
  for (const b of bookings) {
    const red = b.redemptions || null;
    // The discount percent comes from the booking's stamp (the
    // business's opt-in choice at creation) or the tally's
    // snapshot of it. A booking with neither reads as 0: codes
    // are opt-in, so an unstamped booking promised no discount.
    const pct = red && typeof red.discountPct === "number" ? red.discountPct : typeof b.discountPct === "number" ? b.discountPct : 0;
    const basket = red ? Math.max(0, Number(red.basketTotal) || 0) : 0;
    registerValue += basket;
    basketTotalAll += basket;
    redemptionCount += red ? Math.max(0, Math.floor(Number(red.count) || 0)) : 0;
    discountCost += (basket * pct) / 100;
    const perf = roasPerformanceOf(b);
    if (perf.reported) {
      mediaValue += (perf.views * ROAS_MODEL.cpm) / 1000 + perf.likes * ROAS_MODEL.like + perf.comments * ROAS_MODEL.comment + perf.shares * ROAS_MODEL.share;
    }
    const cost = typeof b.compCostActual === "number" && Number.isFinite(b.compCostActual) ? b.compCostActual : typeof b.dollarCap === "number" ? b.dollarCap : 0;
    compCost += Math.max(0, cost);
    let alloc = null;
    if (typeof b.planAllocation === "number" && Number.isFinite(b.planAllocation)) alloc = b.planAllocation;
    else if (b.plan && b.plan.priceMonthly && b.plan.visitsPerMonth) alloc = b.plan.priceMonthly / b.plan.visitsPerMonth;
    if (alloc === null) planKnown = false;
    else planAllocation += alloc;
  }
  registerValue = roasRound2(registerValue);
  mediaValue = roasRound2(mediaValue);
  compCost = roasRound2(compCost);
  discountCost = roasRound2(discountCost);
  planAllocation = roasRound2(planAllocation);
  const value = roasRound2(registerValue + mediaValue);
  const costTotal = roasRound2(compCost + discountCost);
  const score = costTotal > 0 ? roasRound2(value / costTotal) : null;
  const allInScore = planKnown && roasRound2(costTotal + planAllocation) > 0 ? roasRound2(value / (costTotal + planAllocation)) : null;
  return {
    label: ROAS_LABEL,
    value,
    registerValue,
    mediaValue,
    compCost,
    discountCost,
    planAllocation,
    planKnown,
    score,
    allInScore,
    redemptions: { count: redemptionCount, basketTotal: roasRound2(basketTotalAll) },
    registerBasis: ROAS_REGISTER_BASIS,
    mediaBasis: ROAS_MEDIA_BASIS,
    model: { ...ROAS_MODEL },
  };
}

// The rights a business holds over a delivered post, by plan. The
// creator sees exactly this, for the specific business making the
// offer, BEFORE accepting: rights are never a surprise.
function visitRightsForPlan(planId) {
  if (planId === "growth" || planId === "managed") {
    return {
      plan: planId,
      can: ["Share your post with you tagged", "Repost it on their own feed", "Run it as an ad while their SIGNL account is active (the ad right ends if their account ends)"],
      cannot: ["Edit your post"],
      adUse: true,
    };
  }
  return {
    plan: "self-service",
    can: ["Share your post with you tagged"],
    cannot: ["Edit it", "Post it as their own content", "Run it as an ad"],
    adUse: false,
  };
}

// ---------- Audience stacking (Jeff, 2026-10-19) ----------
// A creator's audience lives on more than Instagram. The profile
// carries a self-reported follower count per platform; the server
// sums them into totalAudience, and the tier band derives from that
// total. Local audience % stays Instagram-based (it is the number
// Meta verification will replace). Legacy profiles with no stack
// treat their stored followerCount as the Instagram count, so no
// record loses its audience in the migration.
const AUDIENCE_PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube" },
];
const AUDIENCE_COUNT_CAP = 100000000;

function normalizeAudienceStack(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const p of AUDIENCE_PLATFORMS) {
    const raw = input[p.id];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n <= 0) continue;
    out[p.id] = Math.min(AUDIENCE_COUNT_CAP, n);
  }
  return out;
}

// The stack stored on a creator record, with the legacy fallback:
// no stack yet means followerCount IS the Instagram count.
function audienceStackOf(creator) {
  const c = creator || {};
  const stack = normalizeAudienceStack(c.audienceStack);
  if (!Object.keys(stack).length && (c.followerCount || 0) > 0) {
    stack.instagram = Math.min(AUDIENCE_COUNT_CAP, Math.floor(Number(c.followerCount)) || 0);
  }
  return stack;
}

function audienceTotalOf(creator) {
  const stack = audienceStackOf(creator);
  return Object.values(stack).reduce((s, n) => s + n, 0);
}

// Display/payload shape: total plus the per-platform breakdown,
// biggest first, only platforms the creator actually reported.
function audienceView(creator) {
  const stack = audienceStackOf(creator);
  const platforms = AUDIENCE_PLATFORMS
    .filter((p) => stack[p.id])
    .map((p) => ({ platform: p.id, label: p.label, count: stack[p.id] }))
    .sort((a, b) => b.count - a.count);
  return { total: platforms.reduce((s, p) => s + p.count, 0), platforms };
}

// ---------- Campus identity (Jeff, 2026-10-21) ----------
// A creator may name the university they attend. It is optional
// profile color, never a completion gate: signup and profile edit
// accept free text, the datalist suggests the schools SIGNL is
// actively recruiting around, and the stored value is mirrored on
// the user record and the creator profile so every surface reads
// the same school. Creators from the same school form a campus
// badge, and referrals between students at the same school form a
// campus crew on the referrer's dashboard. No separate campus
// reward exists: the normal +3/+10 referral Momentum and the
// specced milestone badges are the whole incentive system.
const UNIVERSITY_OPTIONS = [
  "VCU",
  "Virginia State University",
  "University of Richmond",
  "Old Dominion University",
  "Norfolk State University",
  "Hampton University",
  "Christopher Newport University",
  "William & Mary",
  "NC State University",
  "Duke University",
  "UNC Chapel Hill",
  "Howard University",
  "George Washington University",
  "American University",
  "George Mason University",
  "Georgetown University",
];
const UNIVERSITY_ALIASES = {
  "virginia commonwealth university": "VCU",
  "virginia commonwealth": "VCU",
  "virginia state": "Virginia State University",
  odu: "Old Dominion University",
  "old dominion": "Old Dominion University",
  "norfolk state": "Norfolk State University",
  "christopher newport": "Christopher Newport University",
  "college of william and mary": "William & Mary",
  "william and mary": "William & Mary",
  "north carolina state university": "NC State University",
  "north carolina state": "NC State University",
  ncsu: "NC State University",
  "university of north carolina at chapel hill": "UNC Chapel Hill",
  "university of north carolina chapel hill": "UNC Chapel Hill",
  unc: "UNC Chapel Hill",
  gw: "George Washington University",
  gwu: "George Washington University",
  "george washington": "George Washington University",
  "american u": "American University",
  gmu: "George Mason University",
  "george mason": "George Mason University",
};

function normalizeUniversity(value) {
  if (typeof value !== "string") return "";
  const clean = value.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!clean) return "";
  const key = clean.toLowerCase().replace(/&/g, " and ").replace(/\./g, "").replace(/\s+/g, " ");
  return UNIVERSITY_ALIASES[key] || clean.slice(0, 120);
}

function universityOfRecord(user) {
  if (!user) return "";
  return normalizeUniversity((user.creator && user.creator.university) || user.university || "");
}

function sameUniversity(a, b) {
  const left = normalizeUniversity(a);
  const right = normalizeUniversity(b);
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function campusBadgeText(value) {
  const university = normalizeUniversity(value);
  return university ? `Campus: ${university}` : null;
}

// ---------- small helpers ----------

function json(statusCode, obj, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, extraHeaders || {}),
    body: JSON.stringify(obj),
  };
}

function err(statusCode, message) {
  return json(statusCode, { error: message });
}

function parseBody(event) {
  if (!event.body) return {};
  let raw = event.body;
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function marketByName(name) {
  return MARKETS.find((m) => m.name === name || m.id === name) || null;
}

function planById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

// Business access state (Jeff, 2026-10-20 correction): approval
// and activation are separate. An approved business stays on the
// founding list (accessState "founding") until an admin activates
// it by hand; only then does it get product access. Records made
// before the field existed have no accessState and read founding,
// so they sit in founding state with no migration.
function businessAccessState(u) {
  return u && u.role === "business" && u.business && u.business.accessState === "active" ? "active" : "founding";
}

function isFoundingBusiness(u) {
  return !!u && u.role === "business" && businessAccessState(u) !== "active";
}

const FOUNDING_BUSINESS_MESSAGE = "Your business is on the founding list, so the creator roster and the product tools are not open yet. Every founding application gets a decision or a clear status within 2 business days. Your Founding Status page shows your plan, your place in line, and what happens next.";

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, passwordSalt, ...rest } = u;
  if (rest.role === "business" && rest.business) {
    rest.business = { ...rest.business, accessState: businessAccessState(rest) };
    delete rest.business.paymentLink;
  }
  return rest;
}

async function allUsers() {
  const rows = await store.list("user:");
  return rows.map((r) => r.value);
}

// ---------- market activation flags ----------
// Stored as one record: config:markets -> { flags: { [marketName]: true } }.
// A market with no entry is NOT live. In TEST_MODE every market reads live.

async function getMarketFlags() {
  const rec = await store.get("config:markets");
  return (rec && rec.flags) || {};
}

async function isMarketLive(marketName) {
  if (TEST_MODE) return true;
  if (!marketName) return false;
  const flags = await getMarketFlags();
  return !!flags[marketName];
}

async function marketLiveMap() {
  const flags = await getMarketFlags();
  const out = {};
  for (const m of MARKETS) out[m.name] = TEST_MODE ? true : !!flags[m.name];
  return out;
}

async function setMarketLive(marketName, live) {
  const rec = (await store.get("config:markets")) || { flags: {} };
  rec.flags = rec.flags || {};
  if (live) rec.flags[marketName] = true;
  else delete rec.flags[marketName];
  rec.updatedAt = nowIso();
  await store.set("config:markets", rec);
  return rec.flags;
}

// ---------- founding priority ----------
// Founding priority is registration order: among a market's creators,
// the earliest sign-up ranks first. Discovery's default sort uses the
// approved-only version of this ranking; the admin queue position uses
// the pending-only version.

function creatorRanks(users) {
  const creators = users.filter((u) => u.role === "creator");
  const byMarket = {};
  for (const c of creators) {
    // Unlisted creators rank inside their own city, not one shared pool:
    // "first 100 in Tulsa" is the standing that matters there. The key
    // is city + country; records from before the country field fall
    // back to their stored state so they keep ranking.
    const key = c.market === UNLISTED ? `${c.city || ""}, ${c.country || c.state || ""}` : c.market;
    (byMarket[key] = byMarket[key] || []).push(c);
  }
  const approvedRank = new Map();
  const pendingRank = new Map();
  for (const list of Object.values(byMarket)) {
    const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    sorted.filter((u) => u.status === "approved" && !isTester(u)).forEach((u, i) => approvedRank.set(u.id, i + 1));
    sorted.filter((u) => u.status === "pending").forEach((u, i) => pendingRank.set(u.id, i + 1));
  }
  return { approvedRank, pendingRank };
}

// ---------- Momentum: one computed currency (Jeff, 2026-10-18/19) ----------
// Creators earn standing for recruiting AND for doing the work well:
// completing their profile, accepting offers, delivering posts on
// time. They lose points for late posts, no-shows, and the worst
// outcome, redeeming a comp and never posting. Points are NEVER a
// stored counter: every total is computed on read from stored facts
// (user records, bookings, posts, reviews), the same philosophy the
// referral points shipped with, so the ledger below always explains
// the total exactly. Totals floor at 0, never negative. Preview and
// simulated actions write no records, so they can never mint points.
// A banned creator's total freezes at the moment the ban landed:
// earn entries dated after the ban do not count while the ban stands
// (paused creators keep earning from profile completion; only offers
// and posts are blocked for them).
const MOMENTUM_POINTS = {
  referralSignup: 3,
  referralApproved: 10,
  profilePhoto: 10,
  profileBio: 5,
  profileNeighborhood: 5,
  profileLocalAudience: 5,
  profileStack: 10,
  profileBestWorkPerLink: 5,
  profileBestWorkMax: 15,
  firstOfferAccepted: 10,
  postOnTime: 20,
  postLateDelivered: 5,
  reviewGiven: 10,
  streakBonus: 25,
  streakEvery: 5,
  adUse: 25,
  performanceReport: 5,
  latePenalty: -10,
  noShowPenalty: -25,
  neverPostedPenalty: -50,
};

// ---------- Referral ladder v2 + SIGNL Elite (Jeff, 2026-10-21) ----------
// Jeff rejected v1's product guarantees ("the guarantees scare me"):
// the ladder pays BADGES and BONUS MOMENTUM POINTS only. Points
// already order the business-facing creator list, so points are
// priority; badges are the visible standing. Nothing is stored and
// nothing is promised: every milestone and the Elite badge are
// computed on read from the same stored facts as Momentum itself.
// A milestone counts APPROVED referrals only (role creator, status
// approved, not a tester, never the referrer themself by id, email
// or handle), and it UNLOCKS only when the referral who tripped it
// (the threshold-th approved referral, in approval order) has
// delivered their first post, so a ladder cannot be climbed on
// paper approvals that never work.
const REFERRAL_MILESTONES = [
  { milestone: 1, id: "connector", name: "Connector", bonus: 25 },
  { milestone: 3, id: "super_connector", name: "Super Connector", bonus: 50 },
  { milestone: 5, id: "roster_builder", name: "Roster Builder", bonus: 75 },
  { milestone: 10, id: "city_lead", name: "City Lead", bonus: 150 },
];
// SIGNL Elite (Jeff, 2026-10-21: "let's make our own elite"): an
// earned status badge for creators who do the work at volume and
// are rated highly for it. Computed, never stored, and lost
// automatically when the inputs drop.
const ELITE_RULE = { minOnTimePosts: 10, minRatingAvg: 4.5, minRatings: 5 };

function referralCounts(users) {
  const counts = new Map(); // lowercased handle -> { signups, approved, signupsList }
  for (const u of users) {
    if (!u.referredBy) continue;
    const key = String(u.referredBy).trim().toLowerCase();
    if (!key) continue;
    const rec = counts.get(key) || { signups: 0, approved: 0, list: [] };
    rec.signups += 1;
    rec.list.push(u);
    if (u.role === "creator" && u.status === "approved" && !isTester(u)) rec.approved += 1;
    counts.set(key, rec);
  }
  return counts;
}

// Builds the per-creator Momentum view from the full dataset. The
// caller loads users/bookings/posts/reviews once per request and
// every surface (own profile, discovery, public profile, admin)
// reads the same numbers from here.
function createMomentum(data) {
  const users = (data && data.users) || [];
  const bookings = (data && data.bookings) || [];
  const posts = (data && data.posts) || [];
  const reviews = (data && data.reviews) || [];
  // Creator reviews OF businesses (bizreview: records), the mirror
  // of the business reviews above. Leaving one after a completed
  // visit earns +10 at ANY star rating (Jeff, 2026-10-19): points
  // for leaving an honest review, never for a positive one.
  const bizReviews = (data && data.bizReviews) || [];
  const referrals = referralCounts(users);
  // The ladder's view of a referrer's credited creators: approved
  // only, testers out, self-referrals out (same id, same email
  // under a second account, or the referrer's own handle), sorted
  // in approval order so the tripping referral of milestone m is
  // element m-1.
  function approvedReferralList(user) {
    if (!user || user.role !== "creator" || !user.creator) return [];
    const handleKey = String(user.creator.handle || "").trim().toLowerCase();
    if (!handleKey) return [];
    const rec = referrals.get(handleKey);
    if (!rec) return [];
    const myEmail = String(user.email || "").trim().toLowerCase();
    return rec.list.filter((s) => {
      if (!s || s.id === user.id) return false;
      if (s.role !== "creator" || s.status !== "approved" || isTester(s)) return false;
      if (myEmail && String(s.email || "").trim().toLowerCase() === myEmail) return false;
      const sh = s.creator && s.creator.handle ? String(s.creator.handle).trim().toLowerCase() : "";
      if (sh && sh === handleKey) return false;
      return true;
    }).slice().sort((a, b) => {
      const ka = a.reviewedAt || a.createdAt || "";
      const kb = b.reviewedAt || b.createdAt || "";
      if (ka !== kb) return ka < kb ? -1 : 1;
      return String(a.createdAt || "") < String(b.createdAt || "") ? -1 : 1;
    });
  }
  function firstPostAt(userId) {
    const list = postsByCreator.get(userId) || [];
    if (!list.length) return null;
    return list.map((p) => p.submittedAt).filter(Boolean).sort()[0] || null;
  }
  // The full ladder view for one creator: milestone states, the
  // badges earned so far, what is next, and the Elite block. Pure
  // computation over the maps above; safe to call on any surface.
  function ladderFor(user) {
    const blankMilestones = REFERRAL_MILESTONES.map((m) => ({ milestone: m.milestone, id: m.id, name: m.name, bonus: m.bonus, state: "not_reached", trippingHandle: null }));
    const blank = { signups: 0, approvedReferrals: 0, milestones: blankMilestones, badges: [], next: null, elite: { qualified: false, onTimePosts: 0, ratingAvg: null, ratingCount: 0 } };
    if (!user || user.role !== "creator" || !user.creator) return blank;
    const handleKey = String(user.creator.handle || "").trim().toLowerCase();
    const rec = (handleKey && referrals.get(handleKey)) || { signups: 0, approved: 0, list: [] };
    const approvedList = approvedReferralList(user);
    const milestones = REFERRAL_MILESTONES.map((m) => {
      const trip = approvedList[m.milestone - 1] || null;
      if (!trip) return { milestone: m.milestone, id: m.id, name: m.name, bonus: m.bonus, state: "not_reached", trippingHandle: null };
      return {
        milestone: m.milestone, id: m.id, name: m.name, bonus: m.bonus,
        state: firstPostAt(trip.id) ? "unlocked" : "pending_unlock",
        trippingHandle: (trip.creator && trip.creator.handle) || null,
      };
    });
    const badges = milestones.filter((m) => m.state === "unlocked").map((m) => ({ id: m.id, name: m.name, kind: "milestone" }));
    const myPosts = postsByCreator.get(user.id) || [];
    const onTimePosts = myPosts.filter((p) => p.onTime).length;
    const rating = ratingFieldsOf(reviewsByCreator.get(user.id) || []);
    const standing = standingState(user);
    const qualified = user.status === "approved" && standing !== "banned" && standing !== "paused"
      && onTimePosts >= ELITE_RULE.minOnTimePosts
      && rating.ratingCount >= ELITE_RULE.minRatings
      && rating.ratingAvg !== null && rating.ratingAvg >= ELITE_RULE.minRatingAvg;
    if (qualified) badges.push({ id: "signl_elite", name: "SIGNL Elite", kind: "elite" });
    const nextM = milestones.find((m) => m.state !== "unlocked") || null;
    const next = nextM ? { milestone: nextM.milestone, name: nextM.name, state: nextM.state, needed: Math.max(0, nextM.milestone - approvedList.length), trippingHandle: nextM.trippingHandle } : null;
    return {
      signups: rec.signups,
      approvedReferrals: approvedList.length,
      milestones,
      badges,
      next,
      elite: { qualified, onTimePosts, ratingAvg: rating.ratingAvg, ratingCount: rating.ratingCount },
    };
  }
  function badgesFor(user) {
    return ladderFor(user).badges;
  }
  const bookingsByCreator = new Map();
  for (const b of bookings) {
    if (!bookingsByCreator.has(b.creatorId)) bookingsByCreator.set(b.creatorId, []);
    bookingsByCreator.get(b.creatorId).push(b);
  }
  const postsByCreator = new Map();
  for (const p of posts) {
    if (!postsByCreator.has(p.creatorId)) postsByCreator.set(p.creatorId, []);
    postsByCreator.get(p.creatorId).push(p);
  }
  const reviewsByCreator = new Map();
  for (const r of reviews) {
    if (!reviewsByCreator.has(r.creatorId)) reviewsByCreator.set(r.creatorId, []);
    reviewsByCreator.get(r.creatorId).push(r);
  }
  const bizReviewsByCreator = new Map();
  for (const r of bizReviews) {
    if (!bizReviewsByCreator.has(r.creatorId)) bizReviewsByCreator.set(r.creatorId, []);
    bizReviewsByCreator.get(r.creatorId).push(r);
  }

  function detailFor(user) {
    const empty = { signups: 0, approved: 0, points: 0, ledger: [], checklist: [], floorApplied: false, campusCrew: null };
    if (!user || user.role !== "creator" || !user.creator) return empty;
    const c = user.creator;
    const ledger = [];
    const push = (kind, label, points, at) => ledger.push({ kind, label, points, at: at || null });

    // Referrals (unchanged math): +3 per credited sign-up, +10 more
    // per credited creator who is approved.
    const handleKey = String(c.handle || "").trim().toLowerCase();
    const ref = (handleKey && referrals.get(handleKey)) || { signups: 0, approved: 0, list: [] };
    for (const s of ref.list) {
      push("referral_signup", `Creator joined through your invite link (@${(s.creator && s.creator.handle) || "creator"})`, MOMENTUM_POINTS.referralSignup, s.createdAt);
      if (s.role === "creator" && s.status === "approved" && !isTester(s)) {
        push("referral_approved", `A creator you recruited was approved (@${(s.creator && s.creator.handle) || "creator"})`, MOMENTUM_POINTS.referralApproved, s.reviewedAt || s.createdAt);
      }
    }

    // Referral milestone bonuses (ladder v2): one ledger entry per
    // UNLOCKED milestone, dated at the tripping referral's first
    // post. Pending milestones pay nothing yet, which is the point:
    // recruit creators who actually show up and post.
    {
      const ladderNow = ladderFor(user);
      const approvedList = approvedReferralList(user);
      for (const m of ladderNow.milestones) {
        if (m.state !== "unlocked") continue;
        const trip = approvedList[m.milestone - 1];
        push(`referral_milestone_${m.milestone}`, `Referral milestone: ${m.name} badge (${m.milestone} approved ${m.milestone === 1 ? "referral" : "referrals"}, and the referral who earned it delivered their first post)`, m.bonus, trip ? firstPostAt(trip.id) : null);
      }
    }

    // Campus crew: the slice of this creator's credited referrals
    // who named the SAME university. This is a display grouping of
    // the existing referral list, not a second reward system. It
    // appears only when the creator has a university and at least
    // one same-school creator arrived through their invite link.
    const ownUniversity = universityOfRecord(user);
    let campusCrew = null;
    if (ownUniversity && handleKey) {
      const crew = users
        .filter((candidate) => candidate.id !== user.id && candidate.role === "creator" && candidate.creator && String(candidate.referredBy || "").trim().toLowerCase() === handleKey && sameUniversity(universityOfRecord(candidate), ownUniversity))
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      if (crew.length) {
        campusCrew = {
          university: ownUniversity,
          count: crew.length,
          signups: crew.length,
          approved: crew.filter((candidate) => candidate.status === "approved" && !isTester(candidate)).length,
          creators: crew.map((candidate) => ({ userId: candidate.id, handle: candidate.creator.handle || "", status: candidate.status })),
        };
      }
    }

    // Profile completion, from the record as it stands now.
    const profileAt = c.photoUploadedAt || user.updatedAt || user.createdAt;
    const hasPhoto = !!c.hasPhoto;
    const bioDone = String(c.bio || "").trim().length >= 40;
    const neighborhoodDone = !!String(c.neighborhood || "").trim();
    const localDone = c.localAudiencePct !== null && c.localAudiencePct !== undefined;
    const stackCount = Object.keys(audienceStackOf(c)).length;
    const stackDone = stackCount >= 3;
    const workLinks = Math.min(3, (c.bestWork || []).length);
    if (hasPhoto) push("profile_photo", "Profile photo added", MOMENTUM_POINTS.profilePhoto, c.photoUploadedAt || profileAt);
    if (bioDone) push("profile_bio", "Bio written", MOMENTUM_POINTS.profileBio, user.updatedAt || user.createdAt);
    if (neighborhoodDone) push("profile_neighborhood", "Neighborhood set", MOMENTUM_POINTS.profileNeighborhood, user.updatedAt || user.createdAt);
    if (localDone) push("profile_local", "Local audience % reported", MOMENTUM_POINTS.profileLocalAudience, user.updatedAt || user.createdAt);
    if (stackDone) push("profile_stack", "Audience stack completed (3+ platforms)", MOMENTUM_POINTS.profileStack, user.updatedAt || user.createdAt);
    for (let i = 0; i < workLinks; i++) {
      push("profile_best_work", `Best work link ${i + 1} added`, MOMENTUM_POINTS.profileBestWorkPerLink, user.updatedAt || user.createdAt);
    }

    // The work itself: offers, posts, reviews, streaks, penalties.
    const myBookings = (bookingsByCreator.get(user.id) || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const myPosts = (postsByCreator.get(user.id) || []).slice().sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
    const postByBooking = new Map(myPosts.map((p) => [p.bookingId, p]));
    if (myBookings.length) {
      push("first_offer", "First offer accepted", MOMENTUM_POINTS.firstOfferAccepted, myBookings[0].createdAt);
    }
    let streak = 0;
    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    for (const p of myPosts) {
      if (p.onTime) {
        push("post_on_time", "Post delivered on time", MOMENTUM_POINTS.postOnTime, p.submittedAt);
        streak += 1;
        if (streak % MOMENTUM_POINTS.streakEvery === 0) {
          push("streak_bonus", `Reliability streak: ${streak} on-time posts in a row`, MOMENTUM_POINTS.streakBonus, p.submittedAt);
        }
      } else {
        // Delivered late has two tiers (Jeff, 2026-10-19 01:34):
        // inside the one-week hard stop it pays +5 with the -10
        // penalty; inside the ban fuse (days 7-14) it pays +0 with
        // the same -10, and the missed deadline stays on the record.
        const bk = bookingById.get(p.bookingId);
        const inFuse = bk && bk.redeemedAt && Date.parse(p.submittedAt) > Date.parse(bk.redeemedAt) + COMPLIANCE.hardStopDays * DAY_MS;
        if (inFuse) {
          push("post_late_fuse", "Post delivered after the hard stop (inside the ban fuse: counts, no delivery points)", 0, p.submittedAt);
        } else {
          push("post_late", "Post delivered late (inside the week it still counts)", MOMENTUM_POINTS.postLateDelivered, p.submittedAt);
        }
        push("post_late_penalty", "Late post penalty", MOMENTUM_POINTS.latePenalty, p.submittedAt);
        streak = 0;
      }
    }
    for (const b of myBookings) {
      // An honor report voids every consequence of the visit for
      // the creator: the business did not hold up its end.
      if (b.honorReportedAt) continue;
      // No-show: accepted and never showed. Two proofs: the
      // redemption window expired unused (the accept-then-vanish
      // case), or a set visit date has passed with no redemption.
      // Bookings with neither cannot be judged and are never
      // penalized.
      const expiredUnused = b.status === "expired" || (b.compliance && b.compliance.expiredAt);
      if (!b.redeemedAt && !postByBooking.has(b.id) && (expiredUnused || (b.visitDate && Date.parse(b.visitDate) < Date.now()))) {
        push("no_show", `No-show: accepted a visit at ${b.businessName || "a business"} and never showed`, MOMENTUM_POINTS.noShowPenalty, (b.compliance && b.compliance.expiredAt) || b.visitDate || b.updatedAt);
      }
      // The ban case: redeemed the comp and never posted. The
      // penalty is a fact of the record and survives reinstatement.
      if (b.compliance && b.compliance.bannedAt) {
        push("never_posted", `Redeemed a comp at ${b.businessName || "a business"} and never posted`, MOMENTUM_POINTS.neverPostedPenalty, b.compliance.bannedAt);
      }
    }
    // Creator reviews of businesses (Jeff, 2026-10-19): +10 for
    // LEAVING an honest review after a completed visit, at any
    // star rating. Points-for-positive-only would pay for praise,
    // so the rating never gates the points. (Reviews a creator
    // RECEIVES from businesses never mint points; they are shown
    // on the profile as social proof only.)
    const myBizReviews = bizReviewsByCreator.get(user.id) || [];
    for (const r of myBizReviews) {
      push("review_given", `You reviewed ${r.businessName || "a business"} after a completed visit`, MOMENTUM_POINTS.reviewGiven, r.createdAt);
    }
    // Ad use (Jeff, 2026-10-19): a Growth or Managed business running
    // a delivered post as an ad is a real outcome for the creator:
    // +25 per declared post, straight from the stored declaration.
    const bookingNameById = new Map(bookings.map((b) => [b.id, b.businessName || ""]));
    for (const p of myPosts) {
      if (p.adUseDeclaredAt) {
        const bn = bookingNameById.get(p.bookingId);
        push("ad_use", `Your post ran as an ad${bn ? ` (${bn})` : ""}`, MOMENTUM_POINTS.adUse, p.adUseDeclaredAt);
      }
      if (p.reportedAt) {
        push("performance_report", "Reported post performance (views and likes)", MOMENTUM_POINTS.performanceReport, p.reportedAt);
      }
    }

    ledger.sort((a, b) => String(a.at || "") < String(b.at || "") ? -1 : 1);

    // Ban freeze: while the ban stands, earns dated after it landed
    // do not count. Losses always count; they are history.
    const standing = user.standing || null;
    let effective = ledger;
    if (standing && standing.state === "banned" && standing.at) {
      effective = ledger.filter((e) => !(e.points > 0 && e.at && Date.parse(e.at) > Date.parse(standing.at)));
    }
    const rawTotal = effective.reduce((s, e) => s + e.points, 0);
    const points = Math.max(0, rawTotal);

    const checklist = [
      { id: "photo", label: "Add your profile photo", points: MOMENTUM_POINTS.profilePhoto, done: hasPhoto },
      { id: "bio", label: "Write your bio (40+ characters)", points: MOMENTUM_POINTS.profileBio, done: bioDone },
      { id: "neighborhood", label: "Set your neighborhood or area", points: MOMENTUM_POINTS.profileNeighborhood, done: neighborhoodDone },
      { id: "local", label: "Report your local audience %", points: MOMENTUM_POINTS.profileLocalAudience, done: localDone },
      { id: "stack", label: "Complete your audience stack (3+ platforms)", points: MOMENTUM_POINTS.profileStack, done: stackDone, detail: `${stackCount} of 3+ platforms` },
      { id: "bestwork", label: "Add best work links (+5 each, up to 3)", points: MOMENTUM_POINTS.profileBestWorkPerLink, done: workLinks >= 3, detail: `${workLinks} of 3 added` },
      { id: "firstoffer", label: "Accept your first offer", points: MOMENTUM_POINTS.firstOfferAccepted, done: myBookings.length > 0 },
      { id: "ontime", label: "Deliver a post on time (+20 each)", points: MOMENTUM_POINTS.postOnTime, done: myPosts.some((p) => p.onTime), detail: `${myPosts.filter((p) => p.onTime).length} on-time posts` },
      { id: "streak", label: "Hit a 5-post on-time streak (+25 bonus)", points: MOMENTUM_POINTS.streakBonus, done: ledger.some((e) => e.kind === "streak_bonus") },
      { id: "reviews", label: "Review a business after a completed visit (+10 each, any star rating)", points: MOMENTUM_POINTS.reviewGiven, done: myBizReviews.length > 0, detail: `${myBizReviews.length} reviewed` },
      { id: "aduse", label: "Have a post run as an ad by a Growth or Managed business (+25 each)", points: MOMENTUM_POINTS.adUse, done: myPosts.some((p) => p.adUseDeclaredAt), detail: `${myPosts.filter((p) => p.adUseDeclaredAt).length} posts ran as ads` },
      { id: "performance", label: "Report a post's views and likes when asked, 7 days after posting (+5 each)", points: MOMENTUM_POINTS.performanceReport, done: myPosts.some((p) => p.reportedAt), detail: `${myPosts.filter((p) => p.reportedAt).length} posts reported` },
      { id: "referrals", label: "Invite creators (+3 per sign-up, +10 per approval)", points: MOMENTUM_POINTS.referralSignup, done: ref.signups > 0, detail: `${ref.signups} joined, ${ref.approved} approved` },
    ];

    return {
      signups: ref.signups,
      approved: ref.approved,
      points,
      floorApplied: rawTotal < 0,
      ledger: effective,
      checklist,
      campusCrew,
    };
  }

  function summaryFor(user) {
    const d = detailFor(user);
    return { signups: d.signups, approved: d.approved, points: d.points, campusCrew: d.campusCrew };
  }

  return { detailFor, summaryFor, ladderFor, badgesFor };
}

// Loads the full dataset once and returns a Momentum calculator.
// Every Momentum read in a request goes through one of these so the
// numbers can never disagree between surfaces.
async function momentumContext() {
  const [users, bookings, posts, reviews, bizReviews] = await Promise.all([allUsers(), allBookings(), allPosts(), allReviews(), allBizReviews()]);
  return { users, momentum: createMomentum({ users, bookings, posts, reviews, bizReviews }) };
}

function inviteUrlForUser(user) {
  return user && user.creator && user.creator.handle
    ? `https://app.joinsignl.com/?ref=${encodeURIComponent(user.creator.handle)}`
    : null;
}

// The recruiting benefits, stated the same way everywhere they appear
// (sign-up email, approval email, recruiter kit email). Plain text,
// no em dashes.
function rosterBenefitsLines(user, place) {
  const inviteUrl = inviteUrlForUser(user);
  if (!inviteUrl) return [];
  return [
    `Grow your roster in ${place}, and get seen first:`,
    `Your personal invite link: ${inviteUrl}`,
    "Share it with creators you know. Every creator who signs up through your link is credited to your roster, and you earn Momentum points: +3 when a creator joins through your link, and +10 when they are approved.",
    "A bigger roster moves you up: when businesses in your market start choosing creators, roster standing is part of the order they see.",
    "",
  ];
}

// Lightweight founding summary attached to auth responses for creators:
// where they stand in their market and whether that market is live yet.
async function foundingSummary(user) {
  if (!user || user.role !== "creator") return null;
  const users = await allUsers();
  const { approvedRank, pendingRank } = creatorRanks(users);
  const inMarket = users.filter((u) => u.role === "creator" && u.market === user.market);
  return {
    market: user.market,
    city: user.city || "",
    state: user.state || null,
    country: user.country || null,
    unlisted: user.market === UNLISTED,
    marketLive: await isMarketLive(user.market),
    launchWindow: LAUNCH_WINDOW_TEXT,
    status: user.status,
    priorityPosition: user.status === "approved" ? approvedRank.get(user.id) || null : null,
    queuePosition: user.status === "pending" ? pendingRank.get(user.id) || null : null,
    foundingCreatorsInMarket: inMarket.filter((u) => u.status === "approved" && !isTester(u)).length,
    creatorsInMarket: inMarket.length,
  };
}

// Creator-facing founding summary (Jeff, 2026-10-18): never show the
// exact queue number or how many people have signed up in a market.
// Creators see a band instead: "in the first 100" (then 200, 300...).
// Exact positions and counts stay in admin responses and the event log.
function foundingBand(position) {
  if (!position || position < 1) return null;
  return Math.ceil(position / 100) * 100;
}

function publicFounding(summary) {
  if (!summary) return summary;
  const { priorityPosition, queuePosition, foundingCreatorsInMarket, creatorsInMarket, ...rest } = summary;
  return {
    ...rest,
    priorityBand: foundingBand(priorityPosition),
    queueBand: foundingBand(queuePosition),
  };
}

async function withFounding(user) {
  const pub = publicUser(user);
  if (pub && pub.role === "creator") {
    pub.founding = publicFounding(await foundingSummary(user));
    // Two-step claim (Jeff, 2026-10-20): the creator's own payload
    // carries the completion checklist (items, points, what is
    // still missing) so the dashboard can run the finish-your-
    // profile loop, and the stored flag on the payload is the
    // COMPUTED value, never a stale stored one.
    pub.profileCompletion = profileCompletionFor(user);
    if (pub.creator) pub.creator = { ...pub.creator, profileComplete: pub.profileCompletion.complete };
    // Momentum rides on the creator's own profile payload in full
    // detail (total, ledger, ways-to-earn checklist) so the dashboard
    // can run the profile-completion incentive loop.
    const { momentum } = await momentumContext();
    pub.momentum = momentum.detailFor(user);
    pub.ladder = momentum.ladderFor(user);
    pub.badges = pub.ladder.badges;
  }
  return pub;
}

// ---------- transactional email ----------
// Every outbound email is an event first (the dataset keeps the full
// record), then a send attempt when the SMTP transport is configured.
// A missing transport queues the email; it is never reported as sent.
async function deliverEmail(kind, user, subject, text, band) {
  const base = { kind, to: user.email, subject, band: band || null };
  await logEvent({ type: `${kind}_email_queued`, actorId: user.id, actorRole: user.role, subjectId: user.id, market: user.market || null, data: base });
  const result = await sendEmail({ to: user.email, subject, text });
  if (result.sent) {
    await logEvent({ type: `${kind}_email_sent`, actorId: user.id, actorRole: user.role, subjectId: user.id, market: user.market || null, data: base });
  } else {
    await logEvent({ type: `${kind}_email_not_sent`, actorId: user.id, actorRole: user.role, subjectId: user.id, market: user.market || null, data: { ...base, reason: result.reason || "unknown" } });
  }
  return result;
}

function greetingName(user) {
  const first = ((user && user.name) || "").trim().split(/\s+/)[0] || "";
  if (!first || first.includes("@") || (user.email && first.toLowerCase() === String(user.email).toLowerCase())) return "there";
  return first;
}

function paidCampaignLine(user) {
  if (!user || !user.creator || normalizeTierBand(user.creator.tierBand) !== "Headliners") return null;
  return "One more thing, because you are in the Headliners tier (15k+ followers): you are also eligible for paid campaigns, where a business pays you cash on top of the comped experience. Headliners tier members are first in line for paid campaigns when they open in your market.";
}

function signupConfirmationEmail(user, band) {
  const first = greetingName(user);
  const paidLine = paidCampaignLine(user);
  const subject = "Your SIGNL founding creator profile is in";
  if (user.market === UNLISTED) {
    const place = `${user.city}, ${user.country || user.state || ""}`;
    const lines = [
      `Hi ${first},`,
      "",
      `Your founding creator profile is built and in the review queue. Every application is reviewed by a person.`,
      "Every founding application gets a decision or a clear status within 2 business days.",
    ];
    if (band) lines.push(`You are in the first ${band} creators to sign up in ${user.city}. That founding standing never expires.`);
    lines.push(
      "",
      `SIGNL has not opened in ${place} yet, and your sign-up is how that changes: we open new markets where creator sign-ups pile up. When ${user.city} opens, founding sign-ups there are first in line, and we email you the moment it happens.`,
      "",
      "The deal, as agreed: businesses comp you a meal or service, you post your honest experience within 48 hours, and you disclose the comp in the post. Nobody can ever ask you for a positive post.",
      "",
      CREATOR_FREE_LINE,
      "",
      ...(paidLine ? [paidLine, ""] : []),
      ...rosterBenefitsLines(user, user.city),
      "Sign in any time to check your status: https://app.joinsignl.com",
      "",
      "You agreed to SIGNL's Terms of Service and Privacy Policy, and to receive account and marketing emails from SIGNL. You can unsubscribe from marketing emails at any time.",
      "",
      "National platforms sell reach. We sell regulars.",
      "The SIGNL team",
      "hello@joinsignl.com",
    );
    return { subject, text: lines.join("\n") };
  }
  const lines = [
    `Hi ${first},`,
    "",
    `Your founding creator profile for ${user.market} is built and in the review queue. Every application is reviewed by a person.`,
    "Every founding application gets a decision or a clear status within 2 business days.",
  ];
  if (band) lines.push(`You are in the first ${band} creators to sign up in ${user.market}. That founding standing never expires.`);
  lines.push(
    "",
    `What happens next: when you are approved, we email you again and your founding status page opens at app.joinsignl.com. ${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}, and founding creators get first pick of offers when it does.`,
    "",
    "The deal, as agreed: businesses comp you a meal or service, you post your honest experience within 48 hours, and you disclose the comp in the post. Nobody can ever ask you for a positive post.",
    "",
    CREATOR_FREE_LINE,
    "",
    ...(paidLine ? [paidLine, ""] : []),
    ...rosterBenefitsLines(user, user.market),
    "Sign in any time to check your status: https://app.joinsignl.com",
    "",
    "You agreed to SIGNL's Terms of Service and Privacy Policy, and to receive account and marketing emails from SIGNL. You can unsubscribe from marketing emails at any time.",
    "",
    "National platforms sell reach. We sell regulars.",
    "The SIGNL team",
    "hello@joinsignl.com",
  );
  return { subject, text: lines.join("\n") };
}

// The completion checklist as plain email lines, shared by the
// approval email and the day-3 reminder. Points are the existing
// Momentum profile values; the four gate items (home city,
// audience counts, categories, local audience %) are the ones a
// finished profile cannot go live without.
function completionChecklistLines(user) {
  const items = profileCompletionItems(user);
  return items.map((i) => {
    const pts = i.points ? ` (+${i.points} Momentum points)` : "";
    const gate = i.required ? " [needed to go live]" : "";
    return `- ${i.label}${pts}${gate}`;
  });
}

// Step-one confirmation for the quick claim (Jeff, 2026-10-20):
// the spot is claimed and the place in line is locked; the profile
// itself is finished after approval, which the email says plainly
// so nobody mistakes the claim for a finished profile.
function claimConfirmationEmail(user, band) {
  const first = greetingName(user);
  const subject = "Your SIGNL founding spot is claimed";
  if (user.market === UNLISTED) {
    const place = `${user.city}, ${user.country || user.state || ""}`;
    const lines = [
      `Hi ${first},`,
      "",
      `Your founding spot in ${user.city} is claimed, and your application is in the review queue. Every application is reviewed by a person.`,
      "Every founding application gets a decision or a clear status within 2 business days.",
    ];
    if (band) lines.push(`You are in the first ${band} creators to sign up in ${user.city}. Founding spots lock in sign-up order, and that standing never expires.`);
    lines.push(
      "",
      `What happens next: when you are approved, we email you again, and that is when you finish your profile: your home city, your audience counts, your local audience percentage, your categories, and the rest of what businesses see. A finished profile is what makes you visible to businesses, so the approval email is the one to act on.`,
      "",
      `SIGNL has not opened in ${place} yet, and your sign-up is how that changes: we open new markets where creator sign-ups pile up. When ${user.city} opens, founding sign-ups there are first in line.`,
      "",
      "The deal, as agreed: businesses comp you a meal or service, you post your honest experience within 48 hours, and you disclose the comp in the post. Nobody can ever ask you for a positive post.",
      "",
      CREATOR_FREE_LINE,
      "",
      ...rosterBenefitsLines(user, user.city),
      "Sign in any time to check your status: https://app.joinsignl.com",
      "",
      "You agreed to SIGNL's Terms of Service and Privacy Policy, and to receive account and marketing emails from SIGNL. You can unsubscribe from marketing emails at any time.",
      "",
      "National platforms sell reach. We sell regulars.",
      "Jeff",
      "Founder, SIGNL",
      "hello@joinsignl.com",
    );
    return { subject, text: lines.join("\n") };
  }
  const lines = [
    `Hi ${first},`,
    "",
    `Your founding spot in ${user.market} is claimed, and your application is in the review queue. Every application is reviewed by a person.`,
    "Every founding application gets a decision or a clear status within 2 business days.",
  ];
  if (band) lines.push(`You are in the first ${band} creators to sign up in ${user.market}. Founding spots lock in sign-up order, and that standing never expires.`);
  lines.push(
    "",
    `What happens next: when you are approved, we email you again, and that is when you finish your profile: your home city, your audience counts, your local audience percentage, your categories, and the rest of what businesses see. A finished profile is what makes you visible to businesses, so the approval email is the one to act on. ${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}, and founding creators with finished profiles get first pick of offers when it does.`,
    "",
    "The deal, as agreed: businesses comp you a meal or service, you post your honest experience within 48 hours, and you disclose the comp in the post. Nobody can ever ask you for a positive post.",
    "",
    CREATOR_FREE_LINE,
    "",
    ...rosterBenefitsLines(user, user.market),
    "Sign in any time to check your status: https://app.joinsignl.com",
    "",
    "You agreed to SIGNL's Terms of Service and Privacy Policy, and to receive account and marketing emails from SIGNL. You can unsubscribe from marketing emails at any time.",
    "",
    "National platforms sell reach. We sell regulars.",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com",
  );
  return { subject, text: lines.join("\n") };
}

// The day-3 completion reminder (Jeff, 2026-10-20): shorter than
// the approval email, same pitch. Sent once, by the sweep, only to
// approved creators whose profile is still unfinished.
function profileCompletionReminderEmail(user) {
  const first = greetingName(user);
  const completion = profileCompletionFor(user);
  const labels = { city: "your home city", audience: "your audience counts", categories: "your content categories", local: "your local audience %" };
  const missing = completion.missing.map((id) => labels[id] || id).join(", ");
  const unlisted = user.market === UNLISTED;
  const place = unlisted ? user.city : user.market;
  const subject = "Finish your SIGNL profile to be launch-ready";
  const lines = [
    `Hi ${first},`,
    "",
    `You are approved as a Founding Creator in ${place}, and your founding spot is locked in. One step is still open: your profile is not finished yet, so businesses cannot see you and you cannot take offers.`,
    "",
    `Still to do: ${missing}.`,
    "Finishing takes a few minutes: sign in, open the Profile tab, and work down the checklist on your dashboard: https://app.joinsignl.com",
    "",
    ...completionChecklistLines(user),
    "",
    unlisted
      ? `We open new markets where creator sign-ups pile up, and when ${user.city} opens, founding creators with finished profiles go first.`
      : `${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}, and founding creators with finished profiles get first pick of every offer.`,
    "",
    "National platforms sell reach. We sell regulars.",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com",
  ];
  return { subject, text: lines.join("\n") };
}

function approvalEmail(user, band) {
  const first = greetingName(user);
  const paidLine = paidCampaignLine(user);
  // The approval email carries the step-two ask (Jeff, 2026-10-20):
  // finish the profile to be launch-ready, with the completion
  // checklist and its Momentum values and a direct link into the
  // app, then the referral ask (rosterBenefitsLines: their
  // personal invite link, +3 per sign-up, +10 per approval, points
  // ordering the business-facing creator list). Founding spots
  // lock in sign-up order. Signs as Jeff, per the standing rule
  // for outbound email.
  const finishLines = (opensLine) => [
    "",
    "One step left: finish your profile to be launch-ready.",
    "Sign in and open the Profile tab: https://app.joinsignl.com",
    "Your dashboard shows this checklist. The items marked [needed to go live] are what make you visible to businesses; the rest earn Momentum points, and Momentum points order the creator list businesses see:",
    ...completionChecklistLines(user),
    "Until your profile is finished, businesses cannot see you and you cannot take offers, so finish it before your market opens.",
    "",
    opensLine,
    "",
    CREATOR_FREE_LINE,
  ];
  if (user.market === UNLISTED) {
    const subject = `You are approved: founding creator for ${user.city}`;
    const lines = [
      `Hi ${first},`,
      "",
      `Good news: your application was reviewed and approved. You are a Founding Creator for ${user.city}, and your founding status page is live.`,
    ];
    if (band) lines.push(`You are in the first ${band} to sign up in ${user.city}. Founding spots lock in sign-up order, and when ${user.city} opens, founding sign-ups are first in line for offers.`);
    lines.push(
      ...finishLines(`${user.city} is not an open market yet. We open new markets where creator sign-ups pile up, and the moment ${user.city} opens, we email you again.`),
      ...rosterBenefitsLines(user, user.city),
      "Momentum points order the creator list businesses see, and Headliners are first in line for paid campaigns.",
      ...(paidLine ? [paidLine, ""] : []),
      "National platforms sell reach. We sell regulars.",
      "Jeff",
      "Founder, SIGNL",
      "hello@joinsignl.com",
    );
    return { subject, text: lines.join("\n") };
  }
  const subject = "You are approved: welcome to the SIGNL founding roster";
  const lines = [
    `Hi ${first},`,
    "",
    `Good news: your application was reviewed and approved. You are now a Founding Creator in ${user.market}, and your founding status page is live.`,
  ];
  if (band) lines.push(`You are in the first ${band} founding creators in ${user.market}. Founding spots lock in sign-up order, and founding creators are shown to businesses in that order.`);
  lines.push(
    ...finishLines(`${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}. The moment it opens, we email you again, and founding creators get first pick of every offer. Your local audience percentage is the number businesses look at first, so keep it honest and current.`),
    ...rosterBenefitsLines(user, user.market),
    "Momentum points order the creator list businesses see, and Headliners are first in line for paid campaigns.",
    ...(paidLine ? [paidLine, ""] : []),
    "National platforms sell reach. We sell regulars.",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com",
  );
  return { subject, text: lines.join("\n") };
}

// ---------- one-time recruiter kit email ----------
// Jeff (2026-10-18): the recruiter ask goes BY EMAIL from the app,
// never by Instagram DM. Every creator who is already approved when
// this ships gets exactly one kit email: their Founding Creator
// badge, their invite link, and the recruiting benefits. The blob
// flag below is claimed BEFORE any send, inside the API handler, so
// the first request after deploy fires it and no request ever fires
// it again, even if a send fails midway.
const RECRUITER_KIT_FLAG_KEY = "config:recruiterKitEmailV1Sent";
const BADGE_SQUARE_URL = "https://joinsignl.com/assets/badges/signl-founding-creator-badge-square.png";
const BADGE_PORTRAIT_URL = "https://joinsignl.com/assets/badges/signl-founding-creator-badge-portrait.png";
const CREATOR_FILM_URL = "https://joinsignl.com/creators.html";

function recruiterKitEmail(user) {
  const first = greetingName(user);
  const unlisted = user.market === UNLISTED;
  const place = unlisted ? user.city : user.market;
  const subject = "Your Founding Creator badge is ready";
  const lines = [
    `Hi ${first},`,
    "",
    `Thank you for being first. You are on the SIGNL founding roster in ${place}, approved before the market opens, and this platform gets built on creators who show up early like you did.`,
    "",
    "Your Founding Creator badge is ready. It is yours to save and post anywhere:",
    `Square (best for feed posts): ${BADGE_SQUARE_URL}`,
    `Portrait (best for stories): ${BADGE_PORTRAIT_URL}`,
    "",
    ...rosterBenefitsLines(user, place),
    `If you feel like spreading the word, post the badge to your story with your invite link, or share our short creator film: ${CREATOR_FILM_URL}`,
    "Only if you want to. There is no requirement and no follow-up nagging from me. You are on the founding roster either way, and first pick of offers stays yours.",
    "",
    unlisted
      ? `${user.city} opens when sign-ups there pile up, and every creator who joins through you makes that happen sooner. The moment it opens, you hear from me.`
      : `${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}. The moment it opens, you hear from me.`,
    "",
    "National platforms sell reach. We sell regulars.",
    "",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com",
  ];
  return { subject, text: lines.join("\n") };
}

async function maybeSendRecruiterKit() {
  const existing = await store.get(RECRUITER_KIT_FLAG_KEY);
  if (existing) return;
  // Claim first, send second: the kit can never go out twice.
  const claimedAt = nowIso();
  await store.set(RECRUITER_KIT_FLAG_KEY, { version: 1, claimedAt, recipients: [] });
  const users = await allUsers();
  const recipients = users.filter((u) => u.role === "creator" && u.status === "approved" && !isTester(u));
  const sentTo = [];
  for (const recipient of recipients) {
    try {
      const mail = recruiterKitEmail(recipient);
      await deliverEmail("recruiter_kit", recipient, mail.subject, mail.text, null);
      sentTo.push(recipient.email);
    } catch (e) { /* one recipient must never block the rest */ }
  }
  await store.set(RECRUITER_KIT_FLAG_KEY, { version: 1, claimedAt, completedAt: nowIso(), recipients: sentTo });
  await logEvent({
    type: "recruiter_kit_email_run",
    actorId: null,
    actorRole: "system",
    subjectId: null,
    market: null,
    data: { version: 1, recipients: sentTo.length, emails: sentTo },
  });
}

function cleanStringList(value, allowed, maxItems) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === "string") list = value.split(",");
  return list
    .map((x) => String(x).trim())
    .filter((x) => x && (!allowed || allowed.includes(x)))
    .slice(0, maxItems || 8);
}

// Optional social links beyond Instagram/TikTok/YouTube: Facebook
// (profile or Page URL), X (handle or URL), LinkedIn (profile URL).
// Accepts a full URL or a bare handle/slug and stores a canonical URL.
// Business review-page links (Jeff, 2026-10-19): a business may
// link its public review pages (Google, Yelp, TripAdvisor,
// Facebook) so a creator sees them as a courtesy block in the
// visit flow: "Their review pages", one tap out. Host-validated
// per platform so a rendered link can never point somewhere its
// label does not say. Display-if-exists only, never mandatory,
// and NO points attach to external reviews anywhere: points are
// for the in-app review only (and Google prohibits incentivized
// reviews outright, so points there would endanger the business's
// own profile).
const REVIEW_LINK_HOSTS = {
  google: { label: "Google", hosts: ["google.com", "g.page", "goo.gl", "maps.app.goo.gl"], suffixHosts: ["google.com"] },
  yelp: { label: "Yelp", hosts: ["yelp.com"], suffixHosts: ["yelp.com"] },
  tripadvisor: { label: "TripAdvisor", hosts: ["tripadvisor.com"], suffixHosts: ["tripadvisor.com"] },
  facebook: { label: "Facebook", hosts: ["facebook.com", "fb.com"], suffixHosts: ["facebook.com"] },
};
function validateReviewLinks(input) {
  const out = {};
  if (input === undefined || input === null) return { ok: true, links: out };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Review links must be an object" };
  for (const key of Object.keys(REVIEW_LINK_HOSTS)) {
    const raw = input[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const value = String(raw).trim();
    let u;
    try {
      u = new URL(value);
    } catch (e) {
      return { ok: false, error: `Your ${REVIEW_LINK_HOSTS[key].label} review link is not a valid URL` };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: `Your ${REVIEW_LINK_HOSTS[key].label} review link must start with http:// or https://` };
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const spec = REVIEW_LINK_HOSTS[key];
    const hostOk = spec.hosts.includes(host) || spec.suffixHosts.some((s) => host === s || host.endsWith("." + s));
    if (!hostOk) return { ok: false, error: `That link does not point at ${spec.label}. Paste the link from your ${spec.label} review page.` };
    out[key] = value.slice(0, 500);
  }
  return { ok: true, links: out };
}
// The display shape: only the links that exist, labeled, in a
// fixed order. Null when the business has none (nothing renders).
function reviewLinksView(business) {
  const links = (business && business.reviewLinks) || {};
  const out = [];
  for (const key of Object.keys(REVIEW_LINK_HOSTS)) {
    if (links[key]) out.push({ key, label: REVIEW_LINK_HOSTS[key].label, url: links[key] });
  }
  return out.length ? out : null;
}
// Audience-code discounts (Jeff, 2026-10-19): OPT-IN, always.
// A business may offer its creators' audiences a discount for
// using the creator's code; SIGNL never forces one and never
// applies a default percentage. The setting lives on the
// business record: discountEnabled (default false) and
// discountPct (the business's own choice, 5..50, only meaningful
// when enabled). The creatorCode itself is issued on every
// booking either way: it is the counting handle the register
// tally hangs on, discount or not.
const DISCOUNT_PCT_MIN = 5;
const DISCOUNT_PCT_MAX = 50;
// The configured setting as a view: pct is the stored choice,
// or the suggested value when the business has not picked one
// yet (shown in the settings UI, never stamped from here).
// effectivePct is what a new booking would carry: the choice
// when on, 0 when off.
function discountSettingOf(business) {
  const enabled = !!(business && business.discountEnabled === true);
  const stored = business && typeof business.discountPct === "number" && Number.isFinite(business.discountPct) ? business.discountPct : null;
  const pct = stored !== null ? stored : ROAS_MODEL.suggestedDiscountPct;
  return { enabled, pct, effectivePct: enabled ? pct : 0 };
}
// The percentage stamped on a new booking for this business:
// their percentage when they opted in, 0 when they did not.
function discountPctForBooking(business) {
  return discountSettingOf(business).effectivePct;
}
// Validate a discount-setting write against the record's current
// state. Input fields are optional (an omitted field keeps its
// current value); enabling with no percentage anywhere falls
// back to the suggested value, which the business can change.
function validateDiscountSetting(input, business) {
  const cur = discountSettingOf(business);
  let enabled = cur.enabled;
  let pct = business && typeof business.discountPct === "number" && Number.isFinite(business.discountPct) ? business.discountPct : null;
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") return { ok: false, error: "Code discounts on/off must be true or false" };
    enabled = input.enabled;
  }
  if (input.pct !== undefined && input.pct !== null && input.pct !== "") {
    const n = Number(input.pct);
    if (!Number.isFinite(n) || n < DISCOUNT_PCT_MIN || n > DISCOUNT_PCT_MAX) return { ok: false, error: `Discount percent must be between ${DISCOUNT_PCT_MIN} and ${DISCOUNT_PCT_MAX}` };
    pct = Math.round(n * 100) / 100;
  } else if (input.pct === null) {
    pct = null;
  }
  if (enabled && pct === null) pct = ROAS_MODEL.suggestedDiscountPct;
  return { ok: true, enabled, pct };
}
// The Managed talent budget stored on a business record, with the
// suggested default for records that predate the field.
function talentBudgetOf(business) {
  const n = Number(business && business.monthlyTalentBudget);
  return Number.isFinite(n) && n >= 0 ? n : MANAGED_TALENT_BUDGET_DEFAULT;
}

function normalizeSocials(b) {
  const out = { facebookUrl: null, xHandle: null, xUrl: null, linkedinUrl: null };
  const fb = (b.facebookUrl || "").trim();
  if (fb) {
    out.facebookUrl = /^https?:\/\//i.test(fb) ? fb : `https://www.facebook.com/${fb.replace(/^@/, "")}`;
  }
  const x = (b.xHandle || b.xUrl || "").trim();
  if (x) {
    const fromUrl = x.match(/(?:x\.com|twitter\.com)\/@?([A-Za-z0-9_]+)/i);
    const handle = fromUrl ? fromUrl[1] : x.replace(/^@/, "").replace(/^https?:\/\//i, "");
    if (handle) {
      out.xHandle = handle;
      out.xUrl = `https://x.com/${handle}`;
    }
  }
  const li = (b.linkedinUrl || "").trim();
  if (li) {
    out.linkedinUrl = /^https?:\/\//i.test(li) ? li : `https://www.linkedin.com/in/${li.replace(/^@/, "")}`;
  }
  return out;
}

// Best-work links (Jeff, 2026-10-19): a creator may attach up to 3
// links to their own best posts - Instagram, TikTok or YouTube only.
// Host-validated, so a rendered link card can never point somewhere
// its label does not say. Links are stored raw on the creator record
// and rendered as outbound cards; third-party players are never
// embedded.
const BEST_WORK_HOSTS = [
  { hosts: ["instagram.com"], platform: "Instagram" },
  { hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"], platform: "TikTok" },
  { hosts: ["youtube.com", "m.youtube.com", "youtu.be"], platform: "YouTube" },
];
function bestWorkPlatform(url) {
  let u;
  try {
    u = new URL(String(url || ""));
  } catch (e) {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const entry of BEST_WORK_HOSTS) {
    if (entry.hosts.includes(host)) return entry.platform;
  }
  return null;
}
function bestWorkLabel(url) {
  const platform = bestWorkPlatform(url);
  if (!platform) return "Watch";
  let path = "";
  try {
    path = new URL(String(url)).pathname.toLowerCase();
  } catch (e) {
    path = "";
  }
  let kind = "video";
  if (platform === "Instagram") kind = /^\/(reel|reels|tv)\b/.test(path) ? "reel" : "post";
  if (platform === "YouTube") kind = path.startsWith("/shorts/") ? "short" : "video";
  return `Watch: ${platform} ${kind}`;
}
function validateBestWork(input) {
  if (input === undefined || input === null) return { ok: true, links: [] };
  if (!Array.isArray(input)) return { ok: false, error: "Best work must be a list of links" };
  const links = [];
  for (const raw of input) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) continue;
    if (s.length > 300) return { ok: false, error: "Best work links are too long (300 characters max each)" };
    if (!bestWorkPlatform(s)) return { ok: false, error: "Best work links must be Instagram, TikTok or YouTube URLs" };
    if (!links.includes(s)) links.push(s);
  }
  if (links.length > 3) return { ok: false, error: "Add up to 3 best work links" };
  return { ok: true, links };
}
function bestWorkCards(creator) {
  const links = validateBestWork(creator && creator.bestWork).links;
  return links.map((url) => ({ url, platform: bestWorkPlatform(url), label: bestWorkLabel(url) }));
}

async function allOffers() {
  const rows = await store.list("offer:");
  return rows.map((r) => r.value);
}

async function allBookings() {
  const rows = await store.list("booking:");
  return rows.map((r) => r.value);
}

async function allPosts() {
  const rows = await store.list("post:");
  return rows.map((r) => r.value);
}

// Creates the booking for an offer a creator is taking, whether
// the take came from a direct accept, a business selection, or a
// backfill accept. One code path so the compliance clock, the
// audience code, the discount stamp, and (for paid offers) the
// escrow ledger are identical in every lane. Callers own the
// standing / cap / eligibility checks that differ per lane.
async function createBookingForOffer({ offer, creator, via, applicationId = null }) {
  const business = await store.get(`user:${offer.businessId}`);
  const code = await genCode();
  const creatorCode = await genCreatorCode(creator.creator ? creator.creator.handle : "");
  const ts = nowIso();
  const kind = kindOf(offer);
  let redeemBy;
  if (laneOf(offer) === "open" && offer.windowEndAt) {
    redeemBy = new Date(Math.min(Date.parse(offer.windowEndAt), Date.parse(ts) + COMPLIANCE.visitWindowDays * DAY_MS)).toISOString();
  } else {
    redeemBy = redeemByFor(offer, new Date(ts));
  }
  const booking = {
    id: crypto.randomUUID(),
    offerId: offer.id,
    applicationId,
    businessId: offer.businessId,
    businessName: offer.businessName,
    creatorId: creator.id,
    creatorName: creator.name,
    creatorHandle: creator.creator ? creator.creator.handle : "",
    market: offer.market,
    category: offer.category,
    title: offer.title,
    whatComped: offer.whatComped,
    covers: kind === "paid" ? null : coversOf(offer),
    paidBrief: kind === "paid" ? (offer.paidBrief || null) : null,
    dollarCap: offer.dollarCap,
    visitWindow: offer.visitWindow,
    windowMode: offer.windowMode || "7days",
    redeemBy,
    visitDate: "",
    code,
    codeStatus: "issued",
    status: "booked",
    createdAt: ts,
    updatedAt: ts,
    checkinAt: null,
    redeemedAt: null,
    redeemMethod: null,
    postDeadline: null,
    replacementRequestedAt: null,
    creatorCode,
    discountPct: discountPctForBooking(business && business.business),
    redemptions: null,
    compCostActual: offer.dollarCap,
  };
  if (kind === "paid") {
    // Paid open offer: the business posted a cash rate for the
    // Standard Visit package. The escrow ledger is exactly the
    // paid-booking ledger: rate + 3% from the business, 97% to
    // the creator, held until the post is live (+48h hold).
    const math = paidMath(Number(offer.cashRate));
    booking.kind = "paid";
    booking.compCostActual = math.businessTotal;
    booking.paidLane = {
      rate: math.rate,
      businessTotal: math.businessTotal,
      creatorNet: math.creatorNet,
      platformFee: math.platformFee,
      escrowState: "held",
      paymentNote: PAID_LANE.paymentNote,
      bookedAt: ts,
      proofAt: null,
      releasedAt: null,
      refundedAt: null,
      refundReason: null,
    };
  }
  await store.set(`booking:${booking.id}`, booking);
  await store.set(`code:${code}`, { bookingId: booking.id });
  await store.set(`ccode:${creatorCode}`, { bookingId: booking.id });
  await logEvent({ type: "booking_code_issued", actorId: creator.id, actorRole: "creator", subjectId: booking.id, market: offer.market, data: { code, offerId: offer.id, businessId: offer.businessId, dollarCap: booking.dollarCap, covers: booking.covers, hasBrief: !!booking.paidBrief, via } });
  if (kind === "paid") {
    await logEvent({ type: "paid_booking_created", actorId: offer.businessId, actorRole: "business", subjectId: booking.id, market: booking.market, data: { creatorId: creator.id, rate: booking.paidLane.rate, businessTotal: booking.paidLane.businessTotal, creatorNet: booking.paidLane.creatorNet, platformFee: booking.paidLane.platformFee, escrowState: "held", via, offerId: offer.id, hasBrief: !!booking.paidBrief } });
  }
  return booking;
}

// How many spots of an offer are actually taken: live bookings
// only (an expired or cancelled booking frees its spot, which is
// what makes backfill possible).
function filledCountFor(offerId, bookings) {
  return bookings.filter((bk) => bk.offerId === offerId && bk.status !== "expired" && bk.status !== "cancelled").length;
}

// The applicant stack ranking (design note: local fit, Impact,
// Momentum, reliability; founding order breaks ties). Scores are
// computed live from stored records, the same inputs discovery
// uses, and the components ride on the payload so the business
// sees WHY the stack is ordered the way it is.
async function rankApplications(apps) {
  const users = await allUsers();
  const byId = new Map(users.map((u) => [u.id, u]));
  const [bookings, posts, reviews, bizReviews] = await Promise.all([allBookings(), allPosts(), allReviews(), allBizReviews()]);
  const momentum = createMomentum({ users, bookings, posts, reviews, bizReviews });
  const { approvedRank } = creatorRanks(users);
  const reviewsByCreator = new Map();
  for (const r of reviews) {
    if (!reviewsByCreator.has(r.creatorId)) reviewsByCreator.set(r.creatorId, []);
    reviewsByCreator.get(r.creatorId).push(r);
  }
  const out = [];
  for (const app of apps) {
    const c = byId.get(app.creatorId);
    if (!c || !c.creator) continue;
    const rating = ratingFieldsOf(reviewsByCreator.get(c.id) || []);
    const history = summarizeHistory(bookings.filter((b) => b.creatorId === c.id), posts);
    const impact = computeLocalImpactScore(c.creator, history);
    const track = summarizeTrackRecord(bookings, posts, c.id);
    const localPct = c.creator.localAudiencePct === null || c.creator.localAudiencePct === undefined ? 0 : Number(c.creator.localAudiencePct);
    const reliability = history.redeemed > 0 ? Math.round(((history.postsOnTime + history.postsLate * 0.5) / history.redeemed) * 100) : 50;
    const mom = momentum.summaryFor(c);
    const rankScore = Math.round((0.35 * localPct + 0.25 * (impact ? impact.score : 0) + 0.2 * Math.min(100, mom.points) + 0.2 * reliability) * 100) / 100;
    out.push({
      ...app,
      rankScore,
      rankParts: { localPct, impactScore: impact ? impact.score : null, momentum: mom.points, reliability },
      creator: {
        userId: c.id,
        name: c.name,
        handle: c.creator.handle,
        university: universityOfRecord(c),
        campusBadge: campusBadgeText(universityOfRecord(c)),
        tierBand: normalizeTierBand(c.creator.tierBand),
        localAudiencePct: c.creator.localAudiencePct === undefined ? null : c.creator.localAudiencePct,
        totalAudience: audienceTotalOf(c.creator),
        paidRate: typeof c.creator.paidRate === "number" && c.creator.paidRate > 0 ? c.creator.paidRate : null,
        ratingAvg: rating.ratingAvg,
        ratingCount: rating.ratingCount,
        badges: momentum.badgesFor(c),
        foundingRank: approvedRank.get(c.id) || null,
        createdAt: c.createdAt,
        trackRecord: track,
      },
    });
  }
  out.sort((a, b) => (b.rankScore - a.rankScore) || (a.creator.createdAt < b.creator.createdAt ? -1 : 1));
  return out;
}

const RELEASE_REASON_TEXT = {
  spots_filled: "The business filled all the spots on this offer.",
  selection_deadline: "The selection deadline passed, so applications released automatically. Nobody should be left waiting without an answer.",
  offer_expired: "The offer's redemption window passed before selections finished.",
  offer_closed: "The business closed this offer.",
  business_released: "The business released this application to decide on the remaining stack.",
  backfill_window_passed: "The 24 hour backfill window passed, so the spot moved to the next applicant.",
  backfill_declined: "You passed on the backfill spot, so it moved to the next applicant.",
};

// Ends an application in a notified terminal state. The event and
// the in-app notification are the no-ghosting guarantee: release
// is never silent, on either side.
async function releaseApplication(app, reason, actor = { id: null, role: "system" }) {
  app.status = reason === "offer_expired" ? "expired" : "released";
  app.releaseReason = reason;
  app.decidedAt = nowIso();
  app.updatedAt = nowIso();
  await store.set(`application:${app.id}`, app);
  await logEvent({ type: "application_released", actorId: actor.id, actorRole: actor.role, subjectId: app.id, market: app.market, data: { offerId: app.offerId, creatorId: app.creatorId, businessId: app.businessId, reason } });
  await notifyUser(app.creatorId, "application_released", RELEASE_REASON_TEXT[reason] || "Your application was released.", { offerId: app.offerId, applicationId: app.id, reason });
  return app;
}

// After spots free up on an open offer, offer the next spot to
// the highest ranked applicant still waiting. One outstanding
// backfill offer per freed spot chain: the sweep advances it when
// its 24 hour window passes. When nobody is left waiting, a
// filled offer reopens to the pool.
async function maybeBackfill(offer, bookings) {
  if (!offer || laneOf(offer) !== "open") return null;
  if (offer.status !== "open" && offer.status !== "filled") return null;
  const allBk = bookings || (await allBookings());
  if (filledCountFor(offer.id, allBk) >= offer.spots) return null;
  const apps = await allApplications();
  const mine = apps.filter((a) => a.offerId === offer.id);
  if (mine.some((a) => a.status === "backfill_offered")) return null;
  const waiting = mine.filter((a) => a.status === "applied");
  if (!waiting.length) {
    if (offer.status === "filled") {
      offer.status = "open";
      offer.updatedAt = nowIso();
      await store.set(`offer:${offer.id}`, offer);
    }
    return null;
  }
  const ranked = await rankApplications(waiting);
  const next = ranked[0];
  const app = await store.get(`application:${next.id}`);
  if (!app || app.status !== "applied") return null;
  app.status = "backfill_offered";
  app.backfillOfferedAt = nowIso();
  app.backfillExpiresAt = new Date(Date.now() + BACKFILL_ACCEPT_HOURS * 3600 * 1000).toISOString();
  app.updatedAt = nowIso();
  await store.set(`application:${app.id}`, app);
  await logEvent({ type: "backfill_offered", actorId: null, actorRole: "system", subjectId: app.id, market: app.market, data: { offerId: offer.id, creatorId: app.creatorId, businessId: app.businessId, expiresAt: app.backfillExpiresAt } });
  await notifyUser(app.creatorId, "backfill_offered", `A spot opened up on "${offer.title}" at ${offer.businessName}. You have 24 hours to take it from your Applications.`, { offerId: offer.id, applicationId: app.id });
  return app;
}

async function creatorHistory(creatorUserId) {
  const bookings = (await allBookings()).filter((b) => b.creatorId === creatorUserId);
  const posts = (await allPosts()).filter((p) => p.creatorId === creatorUserId);
  return summarizeHistory(bookings, posts);
}

// ---------- SIGNL track record + business reviews ----------
// The track record is the differentiator (Jeff, 2026-10-19: profiles
// must be detailed and robust, because the platform sells the
// connection). Every figure is computed ONLY from stored bookings and
// posts: visits completed = bookings actually redeemed, posts
// delivered = posts actually submitted, on-time % from those posts,
// businesses worked with = the distinct business names on redeemed
// bookings. Before any activity exists the zero state is the honest
// answer (isNew) and the UI says "New to SIGNL: no visits yet" -
// nothing here is ever invented, estimated, or seeded.
function summarizeTrackRecord(bookings, posts, creatorId) {
  const mine = bookings.filter((b) => b.creatorId === creatorId);
  // Honor-reported visits never count as completed: the business
  // did not hold up its end, so the visit is void on the record.
  const visited = mine.filter((b) => b.redeemedAt && !b.honorReportedAt);
  const myPosts = posts.filter((p) => p.creatorId === creatorId);
  const onTime = myPosts.filter((p) => p.onTime).length;
  const names = [];
  for (const b of visited) {
    const n = String(b.businessName || "").trim();
    if (n && !names.includes(n)) names.push(n);
  }
  // Post-performance (Jeff, 2026-10-19 round 2): creators report a
  // post's views and likes 7 days after posting. The aggregate only
  // exists when at least one delivered post carries a creator-
  // reported figure: absent data stays absent, never zero-filled
  // or estimated.
  let contentViews = 0;
  let hasContentViews = false;
  for (const p of myPosts) {
    if (typeof p.views === "number") { contentViews += p.views; hasContentViews = true; }
  }
  return {
    visitsCompleted: visited.length,
    postsDelivered: myPosts.length,
    onTimePct: myPosts.length ? Math.round((onTime / myPosts.length) * 100) : null,
    businessesWorkedWith: names,
    isNew: visited.length === 0 && myPosts.length === 0,
    ...(hasContentViews ? { contentViews } : {}),
  };
}

async function creatorTrackRecord(creatorId) {
  const [bookings, posts] = await Promise.all([allBookings(), allPosts()]);
  return summarizeTrackRecord(bookings, posts, creatorId);
}

// Business reviews live as review:{id} records (see the POST
// /bookings/:id/review route). The only shape a review is ever shown
// in: stars, the business's own words, the business's name, when.
async function allReviews() {
  const rows = await store.list("review:");
  return rows.map((r) => r.value);
}

// Creator reviews OF businesses live as bizreview:{id} records
// (see the POST /bookings/:id/review-business route). They feed
// Momentum (+10 for leaving one, any star rating) and show on the
// creator's own visit card. They are never a public rating of the
// business and carry no points for the business.
async function allBizReviews() {
  const rows = await store.list("bizreview:");
  return rows.map((r) => r.value);
}

function reviewDisplay(r) {
  return {
    stars: r.stars,
    comment: r.comment || "",
    businessName: r.businessName || "A SIGNL business",
    createdAt: r.createdAt,
  };
}

function reviewSummaryOf(displayList) {
  if (!displayList.length) return { count: 0, average: null };
  const avg = displayList.reduce((s, r) => s + (Number(r.stars) || 0), 0) / displayList.length;
  return { count: displayList.length, average: Math.round(avg * 10) / 10 };
}

// The business-to-creator RATING (Jeff, 2026-10-20 late): creators
// carry two standing numbers, Momentum points AND a star rating
// from businesses. The rating is the average of the review records
// above, computed server-side on read like everything else (never
// a stored, client-editable field). ratingAvg is null until the
// first rating exists: an unrated creator is NEVER rendered as
// 0 stars or 0.0 anywhere. The rating is display only: it never
// feeds Momentum points and never changes any ordering (discovery
// and the applicant stack stay Momentum-led).
function ratingFieldsOf(reviewRecords) {
  const list = reviewRecords || [];
  if (!list.length) return { ratingAvg: null, ratingCount: 0 };
  const avg = list.reduce((s, r) => s + (Number(r.stars) || 0), 0) / list.length;
  return { ratingAvg: Math.round(avg * 10) / 10, ratingCount: list.length };
}

// The public /c/ profile shows a creator's rating only once at
// least this many businesses have rated them: one or two early
// ratings never define a creator in public. Below the threshold
// the public payload carries no rating data at all.
const PUBLIC_RATING_MIN_COUNT = 3;

async function creatorReviews(creatorId) {
  const all = await allReviews();
  return all
    .filter((r) => r.creatorId === creatorId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// The discovery query, shared verbatim by the real business surface
// and the admin Business Preview so both answer identically. `viewer`
// only drives the favorite flag and the default market; every filter
// reads a field stored on the creator record.
async function discoverCards(query, viewer) {
  const users = await allUsers();
  // Banned creators (redeemed a comp, never posted, cure expired) are
  // out of discovery entirely: a business can never select them again.
  // Testers are out too: an approved tester account tests the app, it
  // is never shown to a business as a bookable creator. And an approved
  // creator whose profile is not complete (a quick claim that has not
  // finished step two) is not on the roster yet either.
  let creators = users.filter((u) => isRosterCreator(u) && profileCompleteOf(u) && standingState(u) !== "banned");
  const market = query.market || (viewer && viewer.role === "business" ? viewer.market : null);
  if (market) creators = creators.filter((u) => u.market === (marketByName(market) || {}).name);
  if (query.tier) creators = creators.filter((u) => u.creator && normalizeTierBand(u.creator.tierBand) === normalizeTierBand(query.tier));
  if (query.category) creators = creators.filter((u) => u.creator && u.creator.categories.includes(query.category));
  if (query.compCategory) creators = creators.filter((u) => u.creator && (u.creator.compCategories || []).includes(query.compCategory));
  if (query.neighborhood) {
    const nb = String(query.neighborhood).trim().toLowerCase();
    if (nb) creators = creators.filter((u) => {
      const area = ((u.creator && u.creator.neighborhood) || "").toLowerCase();
      const city = (u.city || "").toLowerCase();
      return area.includes(nb) || city.includes(nb);
    });
  }
  // Follower range filters read the STACKED TOTAL audience (Jeff,
  // 2026-10-19): a creator's reach is all their platforms summed.
  const fMin = parseInt(query.followersMin, 10);
  if (!Number.isNaN(fMin)) creators = creators.filter((u) => u.creator && audienceTotalOf(u.creator) >= fMin);
  const fMax = parseInt(query.followersMax, 10);
  if (!Number.isNaN(fMax)) creators = creators.filter((u) => u.creator && audienceTotalOf(u.creator) <= fMax);
  const minLocal = Number(query.minLocalPct);
  if (query.minLocalPct !== undefined && !Number.isNaN(minLocal)) {
    creators = creators.filter((u) => u.creator && u.creator.localAudiencePct !== null && u.creator.localAudiencePct !== undefined && Number(u.creator.localAudiencePct) >= minLocal);
  }
  if (query.paid === "1" || query.paid === "true") {
    // The paid filter reads the REAL paid lane (Jeff, 2026-10-19):
    // a creator is bookable for paid visits only when she has
    // listed a paid rate. (It previously read the Creators-tier
    // paid-campaigns comp flag, which is a different thing.)
    creators = creators.filter((u) => u.creator && Number(u.creator.paidRate) > 0);
  }
  if (query.q) {
    const q = query.q.toLowerCase();
    creators = creators.filter((u) => u.name.toLowerCase().includes(q) || (u.creator && u.creator.handle.toLowerCase().includes(q)));
  }
  const { approvedRank } = creatorRanks(users);
  const [bookings, posts, reviews, bizReviews] = await Promise.all([allBookings(), allPosts(), allReviews(), allBizReviews()]);
  const momentum = createMomentum({ users, bookings, posts, reviews, bizReviews });
  const bookedUp = await bookedUpCreatorIds(users, bookings);
  const out = [];
  for (const c of creators) {
    const card = await publicCreator(c, viewer, approvedRank.get(c.id) || null);
    // Roster standing rides on the card: it is part of the order
    // businesses were promised creators would be seen in.
    card.momentum = momentum.summaryFor(c);
    card.badges = momentum.badgesFor(c);
    card.standing = standingState(c);
    // At their weekly visit cap: still visible, NOT greyed (that is
    // the paused treatment), flagged "Booked up this week".
    card.bookedUp = bookedUp.has(c.id);
    out.push(card);
  }
  // Default sort is founding priority: earliest founding sign-ups
  // first, which is the priority promise made at sign-up. Businesses
  // can re-sort by Local Impact Score (?sort=score) or by Momentum
  // points (?sort=momentum).
  if (query.sort === "score") {
    out.sort((a, b) => (b.localImpactScore || 0) - (a.localImpactScore || 0));
  } else if (query.sort === "momentum") {
    out.sort((a, b) => (b.momentum.points - a.momentum.points) || (a.createdAt < b.createdAt ? -1 : 1));
  } else {
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  // Paused creators stay visible but sink below creators in good
  // standing on EVERY sort (stable partition applied last): greyed
  // out and deprioritized until they deliver the missing post.
  return [
    ...out.filter((c) => c.standing !== "paused"),
    ...out.filter((c) => c.standing === "paused"),
  ];
}

async function publicCreator(u, viewer, foundingPriority) {
  const history = await creatorHistory(u.id);
  const impact = computeLocalImpactScore(u.creator || {}, history);
  const trackRecord = await creatorTrackRecord(u.id);
  const reviewList = (await creatorReviews(u.id)).map(reviewDisplay);
  const rating = ratingFieldsOf(reviewList);
  const university = universityOfRecord(u);
  let isFavorite = false;
  if (viewer && viewer.role === "business") {
    isFavorite = !!(await store.get(`favorite:${viewer.id}:${u.id}`));
  }
  return {
    userId: u.id,
    name: u.name,
    market: u.market,
    city: u.city || "",
    neighborhood: (u.creator && u.creator.neighborhood) || "",
    university,
    campusBadge: campusBadgeText(university),
    createdAt: u.createdAt,
    foundingBand: foundingPriority === undefined ? null : foundingBand(foundingPriority),
    photoUrl: u.creator && u.creator.hasPhoto ? `/api/users/${u.id}/photo` : null,
    // Paid lane fields ride on the card normalized: compOpen
    // defaults true for legacy records, paidRate is a number or
    // null (null = no paid bookings at any price).
    profile: u.creator
      ? { ...u.creator, university, compOpen: u.creator.compOpen !== false, paidRate: typeof u.creator.paidRate === "number" && u.creator.paidRate > 0 ? u.creator.paidRate : null }
      : u.creator,
    totalAudience: audienceTotalOf(u.creator || {}),
    audienceStack: audienceView(u.creator || {}).platforms,
    visitIncludes: STANDARD_VISIT.summary,
    bestWork: bestWorkCards(u.creator || {}),
    trackRecord,
    reviewSummary: reviewSummaryOf(reviewList),
    reviews: reviewList.slice(0, 10),
    ratingAvg: rating.ratingAvg,
    ratingCount: rating.ratingCount,
    localImpactScore: impact ? impact.score : null,
    scoreComponents: impact ? impact.components : null,
    history,
    isFavorite,
    bookedUp: visitsThisWeek(await allBookings(), u.id, Date.now()) >= maxVisitsPerWeekOf(u),
  };
}

// ---------- public creator profile ----------
// One approved creator's shareable profile (Jeff, 2026-10-19): the
// roster is never public (no listing, no browsing, no search), but a
// creator can share their OWN page, app.joinsignl.com/c/<handle>,
// the way creators elsewhere advertise a bio link. The payload is a
// strict whitelist of public-safe fields built field by field; the
// full user record never leaves this function. Pending and rejected
// creators answer exactly like unknown handles: 404.
function sanitizePublicHandle(raw) {
  let h = String(raw || "");
  try { h = decodeURIComponent(h); } catch (e) { /* keep the raw value */ }
  return h.trim().replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40).toLowerCase();
}

async function publicProfilePayload(u) {
  const c = u.creator || {};
  const { users, momentum } = await momentumContext();
  const { approvedRank } = creatorRanks(users);
  const history = await creatorHistory(u.id);
  const impact = computeLocalImpactScore(c, history);
  const trackRecord = await creatorTrackRecord(u.id);
  const reviewList = (await creatorReviews(u.id)).map(reviewDisplay);
  // Public rating threshold (Jeff, 2026-10-20 late): the public
  // profile carries rating data only once PUBLIC_RATING_MIN_COUNT
  // businesses have rated this creator. Below that the payload
  // carries the empty state (average null, no reviews), so nothing
  // about ratings renders publicly and no "no reviews" or penalty
  // framing ever appears. Businesses inside the app see the rating
  // from the first one; only the public page waits for three.
  const rating = ratingFieldsOf(reviewList);
  const showPublicRating = rating.ratingCount >= PUBLIC_RATING_MIN_COUNT;
  const unlisted = u.market === UNLISTED;
  const university = universityOfRecord(u);
  const audience = audienceView(c);
  return {
    name: u.name,
    handle: c.handle,
    university,
    campusBadge: campusBadgeText(university),
    instagramUrl: c.instagramUrl || `https://instagram.com/${c.handle}`,
    photoUrl: c.hasPhoto ? `/api/users/${u.id}/photo` : null,
    market: unlisted ? u.city || "" : u.market,
    unlisted,
    city: u.city || "",
    neighborhood: c.neighborhood || "",
    tierBand: normalizeTierBand(c.tierBand) || null,
    followerCount: c.followerCount || 0,
    totalAudience: audience.total,
    audienceStack: audience.platforms,
    categories: c.categories || [],
    compCategories: (c.compCategories || []).filter((x) => x !== PAID_COMP),
    compOpen: c.compOpen !== false,
    paidRate: typeof c.paidRate === "number" && c.paidRate > 0 ? c.paidRate : null,
    localAudiencePct: c.localAudiencePct === undefined ? null : c.localAudiencePct,
    localAudienceSource: c.localAudienceSource || "Self-reported",
    localImpactScore: impact ? impact.score : null,
    momentumPoints: momentum.summaryFor(u).points,
    badges: momentum.badgesFor(u),
    foundingBand: foundingBand(approvedRank.get(u.id) || null),
    bestWork: bestWorkCards(c),
    trackRecord,
    reviewSummary: showPublicRating ? reviewSummaryOf(reviewList) : { count: 0, average: null },
    reviews: showPublicRating ? reviewList.slice(0, 10) : [],
    ratingAvg: showPublicRating ? rating.ratingAvg : null,
    ratingCount: showPublicRating ? rating.ratingCount : 0,
    visitIncludes: STANDARD_VISIT.summary,
  };
}

function postState(booking, post) {
  if (post) return post.onTime ? "submitted_on_time" : "submitted_late";
  if (booking.status === "completed") return "submitted_on_time";
  if (booking.redeemedAt) {
    return Date.now() > Date.parse(booking.postDeadline) ? "overdue" : "awaiting_post";
  }
  return "booked";
}

async function withPostState(booking) {
  const posts = await allPosts();
  const post = posts.find((p) => p.bookingId === booking.id) || null;
  let creatorStanding = "good";
  if (booking.creatorId) {
    const creator = await store.get(`user:${booking.creatorId}`);
    if (creator) creatorStanding = standingState(creator);
  }
  // Paid lane + review surfaces (Jeff, 2026-10-19): the booking's
  // paidLane object rides on the record itself; here we attach the
  // business's public review-page links (courtesy block for the
  // creator, display-if-exists) and the creator's own in-app review
  // of this business when one exists (so the visit card can show
  // it instead of the review form).
  let businessReviewLinks = null;
  if (booking.businessId) {
    const bizUser = await store.get(`user:${booking.businessId}`);
    if (bizUser && bizUser.business) businessReviewLinks = reviewLinksView(bizUser.business);
  }
  let businessReview = null;
  const myBizReview = (await allBizReviews()).find((r) => r.bookingId === booking.id);
  if (myBizReview) businessReview = { stars: myBizReview.stars, text: myBizReview.text || "", createdAt: myBizReview.createdAt };
  // The mirror: the business's own rating OF this creator on this
  // booking, when one exists, so the business visit card shows the
  // rating it left instead of the rating form (and the creator's
  // card shows what the business said).
  let creatorReview = null;
  const myCreatorReview = (await allReviews()).find((r) => r.bookingId === booking.id);
  if (myCreatorReview) creatorReview = { stars: myCreatorReview.stars, comment: myCreatorReview.comment || "", createdAt: myCreatorReview.createdAt };
  // SIGNL ROAS (Jeff, 2026-10-19): every booking payload carries
  // its own score, computed by the one helper from the stored
  // facts (redemption tally, reported cost, the post's reported
  // numbers, the business's plan allocation when its plan is
  // known). Legacy bookings without the ROAS fields read as
  // empty tallies and the comp's stated value as cost basis.
  let planAllocation;
  if (booking.businessId) {
    const bizUser = await store.get(`user:${booking.businessId}`);
    const plan = bizUser && bizUser.business ? planById(bizUser.business.plan) : null;
    if (plan) planAllocation = plan.priceMonthly / plan.visitsPerMonth;
  }
  const roas = roasFor([{ ...booking, post, planAllocation }]);
  return { ...booking, post, postState: postState(booking, post), compliance: complianceStatusFor(booking, post, creatorStanding), businessReviewLinks, businessReview, creatorReview, roas };
}

// ---------- Post compliance (Jeff, 2026-10-19; timeline final) ----------
// The deal is simple and the enforcement is automatic. The 48-hour
// post clock starts at redemption. The creator checks off by pasting
// the post link (the link IS the proof; a bare checkbox would prove
// nothing). The ladder (Jeff's pick, 2026-10-19 01:34):
//   post within onTimeHours of redemption      ON TIME (+20)
//   post after that, within hardStopDays       DELIVERED LATE (+5, -10)
//   reminders at 48h, day 5, day 6 ("your account pauses tomorrow")
//   day hardStopDays, no proof                 PAUSED (greyed, blocked
//                                              from offers; the visit is
//                                              recorded as a missed deadline)
//   during the ban fuse (hardStopDays .. hardStopDays+banFuseDays)
//                                              a proof still lands, counts
//                                              delivered-late at +0/-10,
//                                              unpauses; the missed mark stays
//   day hardStopDays+banFuseDays, still none   BANNED from offers (-50);
//                                              admin reinstatement only
// If the comp was never redeemed, this ladder never runs: the
// redemption window (Part 5) expires the booking as a no-show.
// Standing lives on the user record: user.standing = { state, reason,
// at, bookingId }. No standing record means good standing.
// THE timeline (Jeff, 2026-10-19): every number the engine runs on
// lives in this ONE object, so a timeline decision is a one-line
// edit here and nowhere else.
const COMPLIANCE = {
  visitWindowDays: 7, // an accepted offer redeems within this window (Part 5)
  onTimeHours: 48, // post within this of redemption = on time
  hardStopDays: 7, // one week after redemption: the hard stop (pause)
  banFuseDays: 7, // days after the hard stop before the ban lands (day 14)
};
// Reminder offsets derive from the timeline: stage 2 lands two days
// before the hard stop (day 5), the final warning one day before
// (day 6, "your account pauses tomorrow").
const REMINDER2_DAYS = COMPLIANCE.hardStopDays - 2;
const REMINDER3_DAYS = COMPLIANCE.hardStopDays - 1;
// The post-performance email ("How did your post do?") asks seven
// days after proof; a separate feature's timing, kept named here.
const PERFORMANCE_ASK_DAYS = 7;

function pauseAtFor(booking) {
  if (!booking.redeemedAt) return null;
  return new Date(Date.parse(booking.redeemedAt) + COMPLIANCE.hardStopDays * DAY_MS).toISOString();
}

function banAtFor(booking) {
  if (booking.compliance && booking.compliance.cureClosesAt) return booking.compliance.cureClosesAt;
  if (!booking.redeemedAt) return null;
  return new Date(Date.parse(booking.redeemedAt) + (COMPLIANCE.hardStopDays + COMPLIANCE.banFuseDays) * DAY_MS).toISOString();
}

function standingState(user) {
  if (!user || !user.standing || !user.standing.state) return "good";
  return user.standing.state;
}

// ---------- tester designation (Jeff, 2026-10-19) ----------
// A tester is an approved creator account used to exercise the app
// end to end (Tony Johnson is the first): they sign in and use the
// creator side normally (profile, founding page, preview offers,
// settings), but they are NOT on the roster. Every business-facing
// surface and every roster/approved count treats them as if the
// account were not there: discovery never returns them, their
// /c/<handle> page answers 404 like a pending creator's, their
// photo is not public, campaign sends never go to their email, and
// founding ranks, per-market counts, and admin stats all skip them.
// The flag lives on the user record as `tester` (default false),
// set only from the admin console (POST /api/admin/tester).
function isTester(u) {
  return !!(u && u.tester);
}

function isRosterCreator(u) {
  return !!u && u.role === "creator" && u.status === "approved" && !isTester(u);
}

// ---------- profile completion: the two-step claim (Jeff, 2026-10-20) ----------
// Step one CLAIMS the spot with almost nothing: handle, market,
// email, password, and the rule checkboxes. Founding spots lock in
// sign-up order, so the claim is what holds the creator's place.
// Step two is the full profile, finished AFTER approval from the
// checklist on the creator's dashboard (the approval email walks
// them into it, and one reminder follows at day 3). An approved
// creator whose profile is not complete is NOT on the roster:
// businesses cannot discover them, their public /c/ page answers
// 404 exactly like a pending creator's, and they cannot apply to
// open offers or receive direct ones. They can always sign in, see
// their checklist, and finish the profile.
//
// Completeness is COMPUTED from the record on every read (the
// Momentum philosophy: stored facts, never a client-sent flag).
// The required set is exactly what the original full sign-up form
// required, so every creator who registered the old way is
// complete by construction:
//   - an Instagram handle
//   - a home city
//   - at least one audience count (any platform)
//   - at least one content category
//   - a self-reported local audience %
// Photo, a 40+ character bio, neighborhood, best-work links, and
// the paid settings are NOT gate fields: they are the points layer
// of the checklist (existing Momentum values), encouraged, never
// blocking. The stored creator.profileComplete flag is a cache for
// payloads, admin, and the reminder sweep; the backfill below
// repairs it for records written before this shipped.
function profileCompletionItems(user) {
  const c = (user && user.creator) || {};
  const stackCount = Object.keys(audienceStackOf(c)).length;
  const workLinks = Math.min(3, (c.bestWork || []).length);
  return [
    { id: "city", label: "Set your home city", points: null, done: !!String((user && user.city) || "").trim(), required: true },
    { id: "audience", label: "Add your audience counts", points: MOMENTUM_POINTS.profileStack, done: audienceTotalOf(c) > 0, required: true, detail: stackCount ? `${stackCount} of 3+ platforms counted for the stack bonus` : "3+ platforms earns the stack bonus" },
    { id: "categories", label: "Pick at least one content category", points: null, done: Array.isArray(c.categories) && c.categories.length > 0, required: true },
    { id: "local", label: "Report your local audience %", points: MOMENTUM_POINTS.profileLocalAudience, done: c.localAudiencePct !== null && c.localAudiencePct !== undefined, required: true },
    { id: "photo", label: "Add your profile photo", points: MOMENTUM_POINTS.profilePhoto, done: !!c.hasPhoto, required: false },
    { id: "bio", label: "Write your bio (40+ characters)", points: MOMENTUM_POINTS.profileBio, done: String(c.bio || "").trim().length >= 40, required: false },
    { id: "neighborhood", label: "Set your neighborhood or area", points: MOMENTUM_POINTS.profileNeighborhood, done: !!String(c.neighborhood || "").trim(), required: false },
    { id: "bestwork", label: "Add best work links (+5 each, up to 3)", points: MOMENTUM_POINTS.profileBestWorkPerLink, done: workLinks >= 3, required: false, detail: `${workLinks} of 3 added` },
    { id: "settings", label: "Review how businesses can book you (comp visits on, paid rate optional)", points: null, done: true, required: false },
  ];
}

function profileCompletionFor(user) {
  const items = profileCompletionItems(user);
  const required = items.filter((i) => i.required);
  const requiredDone = required.filter((i) => i.done).length;
  return {
    complete: requiredDone === required.length,
    items,
    requiredDone,
    requiredTotal: required.length,
    missing: required.filter((i) => !i.done).map((i) => i.id),
  };
}

function profileCompleteOf(user) {
  if (!user || user.role !== "creator" || !user.creator) return false;
  if (!String(user.creator.handle || "").trim()) return false;
  return profileCompletionFor(user).complete;
}

// One-time backfill for records written before profileComplete
// existed: recompute the stored flag (and the completion stamp)
// from the record itself and report who is genuinely incomplete.
// Runs opportunistically on the first request after deploy
// (claimed-flag pattern, like the recruiter kit) and on demand
// from the admin endpoint. Idempotent: once the flags match the
// computed values, later runs change nothing.
const PROFILE_BACKFILL_KEY = "config:profileBackfill";
async function runProfileBackfill() {
  const users = await allUsers();
  const audit = { ranAt: nowIso(), creators: 0, complete: 0, incomplete: 0, updated: 0, approvedIncomplete: [] };
  for (const u of users) {
    if (u.role !== "creator" || !u.creator) continue;
    audit.creators += 1;
    const completion = profileCompletionFor(u);
    if (completion.complete) audit.complete += 1;
    else audit.incomplete += 1;
    if (u.status === "approved" && !completion.complete) {
      audit.approvedIncomplete.push({ userId: u.id, handle: u.creator.handle || null, email: u.email, market: u.market, status: u.status, missing: completion.missing });
    }
    if (u.creator.profileComplete !== completion.complete || (completion.complete && !u.creator.profileCompletedAt)) {
      u.creator = {
        ...u.creator,
        profileComplete: completion.complete,
        profileCompletedAt: completion.complete ? (u.creator.profileCompletedAt || u.reviewedAt || u.updatedAt || u.createdAt) : null,
      };
      u.updatedAt = nowIso();
      await store.set(`user:${u.id}`, u);
      audit.updated += 1;
    }
  }
  await store.set(PROFILE_BACKFILL_KEY, { done: true, ranAt: audit.ranAt, audit });
  await logEvent({ type: "profile_backfill_completed", actorId: null, actorRole: "system", subjectId: null, market: null, data: audit });
  return audit;
}

async function maybeRunProfileBackfill() {
  const rec = await store.get(PROFILE_BACKFILL_KEY);
  if (rec && rec.done) return null;
  // Claim before running so concurrent requests do not pile on.
  await store.set(PROFILE_BACKFILL_KEY, { claimedAt: nowIso(), done: false });
  return runProfileBackfill();
}

// ---------- visit windows + weekly cap (Jeff, 2026-10-19 r2) ----------
// There are NO appointments on SIGNL. An accepted offer carries a
// redemption WINDOW: the creator redeems any time inside it. Two
// shapes only, picked in the composer: "7days" (redeem within
// COMPLIANCE.visitWindowDays of accepting; the default) and
// "thisweek" (redeem by the end of the current week, Sunday).
function redeemByFor(offer, fromDate) {
  const from = fromDate ? new Date(fromDate) : new Date();
  if (offer && offer.windowMode === "thisweek") {
    const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 23, 59, 59));
    let add = (7 - end.getUTCDay()) % 7; // days until Sunday (0 if today is Sunday)
    end.setUTCDate(end.getUTCDate() + add);
    if (end.getTime() <= from.getTime()) end.setUTCDate(end.getUTCDate() + 7);
    return end.toISOString();
  }
  return new Date(from.getTime() + COMPLIANCE.visitWindowDays * DAY_MS).toISOString();
}

function startOfWeekMs(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return x.getTime() - dow * DAY_MS;
}

// The weekly visit cap: a creator sets maxVisitsPerWeek (default 3,
// range 1-7). The count is bookings ACCEPTED in the current week
// (Mon-Sun) that are still live claims on the creator's time:
// booked, redeemed, or completed visits count; cancelled and
// expired ones do not.
function visitsThisWeek(bookings, creatorId, nowMs) {
  const start = startOfWeekMs(new Date(nowMs));
  return bookings.filter((b) => b.creatorId === creatorId && b.status !== "cancelled" && b.status !== "expired" && Date.parse(b.createdAt) >= start && Date.parse(b.createdAt) < start + 7 * DAY_MS).length;
}

function maxVisitsPerWeekOf(creatorUser) {
  const v = creatorUser && creatorUser.creator ? Number(creatorUser.creator.maxVisitsPerWeek) : NaN;
  return Number.isInteger(v) && v >= 1 && v <= 7 ? v : 3;
}

async function bookedUpCreatorIds(users, bookings) {
  const nowMs = Date.now();
  const out = new Set();
  for (const u of users) {
    if (u.role !== "creator") continue;
    if (visitsThisWeek(bookings, u.id, nowMs) >= maxVisitsPerWeekOf(u)) out.add(u.id);
  }
  return out;
}

// The one status every surface agrees on. Business labels: Redeemed,
// Post due, Posted, Late, Missed. Internal states:
//   booked          visit not redeemed yet
//   post_due        redeemed, inside the 48 hours
//   posted_on_time  proof in by the deadline
//   posted_late     proof in after the deadline (counts delivered)
//   overdue         deadline passed, no proof, hard stop not reached
//   paused          hard stop (day 7) reached with no proof
//   missed          ban fuse burned down with no proof (day 14)
//   expired         redemption window passed unused (a no-show)
//   honor_reported  creator reported the business did not honor the
//                   comp; the compliance clock is void for this visit
function complianceStatusFor(booking, post, creatorStanding) {
  const banAt = banAtFor(booking);
  const base = {
    redeemedAt: booking.redeemedAt || null,
    postDeadline: booking.postDeadline || null,
    pauseAt: pauseAtFor(booking),
    banAt,
    proofUrl: post ? post.url : null,
    proofSubmittedAt: post ? post.submittedAt : null,
    creatorStanding: creatorStanding || "good",
    redeemBy: booking.redeemBy || null,
    honorReportedAt: booking.honorReportedAt || null,
    missedDeadlineAt: (booking.compliance && booking.compliance.missedDeadlineAt) || null,
  };
  if (booking.honorReportedAt && !post) return { ...base, status: "honor_reported" };
  if (!booking.redeemedAt) return { ...base, status: booking.status === "expired" ? "expired" : "booked" };
  if (post) return { ...base, status: post.onTime ? "posted_on_time" : "posted_late" };
  const now = Date.now();
  if (now <= Date.parse(booking.postDeadline)) return { ...base, status: "post_due" };
  if (now < Date.parse(base.pauseAt)) return { ...base, status: "overdue" };
  if (now < Date.parse(banAt)) return { ...base, status: "paused" };
  return { ...base, status: "missed" };
}

// Post-performance email (Jeff, 2026-10-19 round 2): ONE automated
// email, seven days after proof was submitted, asking for the post's
// views and likes. No chase sequence follows it. Reporting earns
// the creator +5 Momentum, computed from the stored report.
function postPerformanceEmail(creator, booking) {
  const first = greetingName(creator);
  const biz = booking.businessName || "your visit";
  return {
    subject: "How did your post do?",
    text: [
      `Hi ${first},`,
      "",
      `It has been a week since your post for ${biz} went up. Two quick numbers help the business see what a visit is worth, and they build your own SIGNL track record: your post's views and likes.`,
      "",
      "Add them in the app: open My Visits, find the visit, and use Add post numbers. It takes ten seconds, and reporting earns you +5 Momentum points.",
      "",
      "Sign in: https://app.joinsignl.com",
      "",
      "The SIGNL team",
      "hello@joinsignl.com",
    ].join("\n"),
  };
}

function complianceReminderEmail(creator, booking, stage) {
  const first = greetingName(creator);
  const biz = booking.businessName || "your visit";
  const deadline = booking.postDeadline ? new Date(booking.postDeadline).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
  const pauseDate = (() => { const p = pauseAtFor(booking); return p ? new Date(p).toLocaleDateString("en-US", { dateStyle: "medium" }) : ""; })();
  const banDate = (() => { const b = banAtFor(booking); return b ? new Date(b).toLocaleDateString("en-US", { dateStyle: "medium" }) : ""; })();
  const howTo = [
    "How to check off (takes 20 seconds):",
    "1. Open SIGNL and go to My Visits.",
    "2. Find this visit and paste the link to your post under Post your proof.",
    "3. That link is your check-off. We verify delivery from it.",
    "The post must be your honest experience with the comp disclosed, as you agreed.",
  ];
  if (stage === 1) {
    return {
      subject: `Your SIGNL post is due for ${biz}`,
      text: [
        `Hi ${first},`,
        "",
        `The 48 hours for your full-credit post about ${biz} are up (it was due ${deadline}), and we do not have your post link yet. No stress: a post delivered within one week of the visit still counts, marked late. One week is the hard stop.`,
        "",
        ...howTo,
        "",
        `Please get the link in before ${pauseDate}. On that day your account pauses if no post has landed, and a redeemed visit that reaches ${banDate} with no post closes the account to future offers.`,
        "",
        "If you already posted, this email crossed with your check-off and you can ignore it.",
        "",
        "The SIGNL team",
        "hello@joinsignl.com",
      ].join("\n"),
    };
  }
  if (stage === 2) {
    return {
      subject: `Still missing your post link for ${biz}`,
      text: [
        `Hi ${first},`,
        "",
        `We are still missing the post link for your visit to ${biz}. The visit was redeemed, the comp was real, and the only thing left is the post you agreed to.`,
        "",
        ...howTo,
        "",
        `The hard stop is ${pauseDate}: one week after the visit. That day your account pauses (greyed out for businesses, no new offers) until the post lands. A post can still land for one more week after that, and if ${banDate} arrives with no post, the account is removed from future offers.`,
        "",
        "If something went wrong with the visit itself, reply to this email and tell us. We would rather hear it than guess.",
        "",
        "The SIGNL team",
        "hello@joinsignl.com",
      ].join("\n"),
    };
  }
  return {
    subject: "Final warning: your SIGNL account pauses tomorrow",
    text: [
      `Hi ${first},`,
      "",
      `This is the final warning for your visit to ${biz}: the one-week hard stop lands tomorrow, ${pauseDate}, and we still have no post link. When it lands, your account PAUSES: businesses see you greyed out and you cannot accept new offers until the post arrives.`,
      "",
      ...howTo,
      "",
      `Even after the pause, the post can still land for one more week and your account unpauses automatically; the visit counts as delivered late and the missed deadline stays on your record. If ${banDate} arrives with no post, the account is banned from future offers, and only a person at SIGNL can reinstate it.`,
      "",
      "The SIGNL team",
      "hello@joinsignl.com",
    ].join("\n"),
  };
}

function bannedNoticeReason() {
  return "A comped visit was redeemed and no post was ever delivered inside the window. This account cannot be booked again unless SIGNL reinstates it.";
}

// The strike pause email (refinement bundle, 2026-10-20): sent once
// when the third expired window pauses the account. Plain language,
// the count, what happens next, and the review route. No em dashes.
function strikePauseEmail(creator) {
  const first = greetingName(creator);
  const subject = "Your SIGNL account is paused for review";
  const lines = [
    `Hi ${first},`,
    "",
    `Three booked visits on your account reached the end of their redemption windows without being used. ${strikeStatusLine(creator) || ""}`,
    "",
    "Your account is paused while the SIGNL team reviews it. While it is paused, businesses cannot send you new offers and you cannot take new ones. Visits you already redeemed are not affected.",
    "",
    "If something kept you from those visits, reply to this email and tell us what happened. Reviews are done by a person, and reinstated accounts restart with two strikes on the count, one short of the limit, so one more expired window pauses the account again.",
    "",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com",
  ];
  return { subject, text: lines.join("\n") };
}

// The sweep: one pass over every redeemed-but-unposted booking,
// driving reminders, the day-8 pause, and the day-9 ban. Idempotent:
// every step stamps the booking or the user record before it acts, so
// a re-run never double-sends or double-punishes. Called by the
// Netlify scheduled function (netlify/functions/compliance-sweep.mjs),
// by the admin endpoint, and opportunistically (throttled) from the
// request path. Returns a summary of what it did.
// Paid-lane escrow refund (Jeff, 2026-10-19): when a paid visit
// resolves badly, the business's money goes back and the state is
// recorded on the booking. Idempotent: only a "held" escrow can
// refund, exactly once. Reasons: no_show (window expired unused),
// creator_banned (the compliance ladder's end), business_did_not_honor
// (an honor report voided the visit; the money follows the void).
async function refundPaidEscrow(booking, reason, summary) {
  const lane = booking.paidLane;
  if (!lane || lane.escrowState !== "held") return;
  lane.escrowState = "refunded";
  lane.refundedAt = nowIso();
  lane.refundReason = reason;
  booking.updatedAt = nowIso();
  await store.set(`booking:${booking.id}`, booking);
  await logEvent({ type: "paid_escrow_refunded", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, rate: lane.rate, businessTotal: lane.businessTotal, reason } });
  if (summary) summary.escrowRefunded += 1;
}

async function runComplianceSweep() {
  const summary = { checked: 0, reminder1: 0, reminder2: 0, reminder3: 0, lateMarked: 0, paused: 0, banned: 0, performance: 0, expired: 0, escrowReleased: 0, escrowRefunded: 0 };
  const bookings = await allBookings();
  const posts = await allPosts();
  const postByBooking = new Map(posts.map((p) => [p.bookingId, p]));
  const now = Date.now();
  for (const booking of bookings) {
    // An honor report voids this visit's compliance clock entirely:
    // the business did not hold up its end, so no reminder, pause,
    // or ban can ever come out of this booking.
    if (booking.honorReportedAt) continue;
    if (!booking.redeemedAt || booking.status === "completed") continue;
    if (postByBooking.has(booking.id)) continue;
    summary.checked += 1;
    const creator = await store.get(`user:${booking.creatorId}`);
    if (!creator || creator.role !== "creator") continue;
    booking.compliance = booking.compliance || {};
    if (!booking.compliance.banAt) booking.compliance.banAt = banAtFor(booking);
    const redeemedMs = Date.parse(booking.redeemedAt);
    const deadlineMs = Date.parse(booking.postDeadline);
    const pauseMs = redeemedMs + COMPLIANCE.hardStopDays * DAY_MS;
    const banMs = Date.parse(booking.compliance.banAt);
    let dirty = false;

    const sendStage = async (stage) => {
      const key = `reminder${stage}At`;
      if (booking.compliance[key]) return;
      booking.compliance[key] = nowIso();
      dirty = true;
      await logEvent({ type: `post_reminder_${stage}`, actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, redeemedAt: booking.redeemedAt, postDeadline: booking.postDeadline, pauseAt: pauseAtFor(booking), banAt: booking.compliance.banAt } });
      try {
        const mail = complianceReminderEmail(creator, booking, stage);
        await deliverEmail(`post_reminder_${stage}`, creator, mail.subject, mail.text, null);
      } catch (e) { /* email is best-effort; the reminder event is the record */ }
      summary[`reminder${stage}`] += 1;
    };

    if (now > deadlineMs) {
      if (!booking.compliance.visitLateAt) {
        booking.compliance.visitLateAt = nowIso();
        dirty = true;
        await logEvent({ type: "visit_late", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, postDeadline: booking.postDeadline } });
        summary.lateMarked += 1;
      }
      await sendStage(1);
    }
    if (now >= redeemedMs + REMINDER2_DAYS * DAY_MS) await sendStage(2);
    if (now >= redeemedMs + REMINDER3_DAYS * DAY_MS) await sendStage(3);
    if (now >= pauseMs && now < banMs) {
      // The hard stop: the visit is recorded as a missed deadline and
      // the account pauses until a proof lands inside the ban fuse.
      if (!booking.compliance.missedDeadlineAt) {
        booking.compliance.missedDeadlineAt = nowIso();
        dirty = true;
        await logEvent({ type: "visit_deadline_missed", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, redeemedAt: booking.redeemedAt, pauseAt: pauseAtFor(booking) } });
      }
      if (standingState(creator) !== "banned" && standingState(creator) !== "paused") {
        creator.standing = { state: "paused", reason: "A post passed the one-week hard stop with nothing delivered. Deliver the post link to unpause.", at: nowIso(), bookingId: booking.id };
        creator.updatedAt = nowIso();
        await store.set(`user:${creator.id}`, creator);
        booking.compliance.pausedAt = nowIso();
        dirty = true;
        await logEvent({ type: "account_paused", actorId: null, actorRole: "system", subjectId: creator.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, banAt: booking.compliance.banAt } });
        summary.paused += 1;
      }
    }
    if (now >= banMs) {
      // The ban: redeemed, never posted, fuse burned down. Jeff's rule.
      if (!booking.compliance.missedDeadlineAt) {
        booking.compliance.missedDeadlineAt = nowIso();
        dirty = true;
        await logEvent({ type: "visit_deadline_missed", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, redeemedAt: booking.redeemedAt, pauseAt: pauseAtFor(booking) } });
      }
      if (!booking.compliance.bannedAt) {
        booking.compliance.bannedAt = nowIso();
        dirty = true;
      }
      if (standingState(creator) !== "banned") {
        creator.standing = { state: "banned", reason: bannedNoticeReason(), at: nowIso(), bookingId: booking.id };
        creator.updatedAt = nowIso();
        await store.set(`user:${creator.id}`, creator);
        await logEvent({ type: "account_banned", actorId: null, actorRole: "system", subjectId: creator.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, redeemedAt: booking.redeemedAt, banAt: booking.compliance.banAt } });
        summary.banned += 1;
      }
      // A paid visit that ends in a ban refunds the business in
      // full: the post will never exist.
      await refundPaidEscrow(booking, "creator_banned", summary);
    }
    if (dirty) {
      booking.updatedAt = nowIso();
      await store.set(`booking:${booking.id}`, booking);
    }
  }
  // Redemption-window expiry (Jeff, 2026-10-19 r2): an accepted
  // offer that is never redeemed inside its window expires. That is
  // the accept-then-vanish case: Momentum treats it as a no-show
  // (computed from this stored marker), and the code dies with it.
  for (const booking of bookings) {
    if (booking.redeemedAt || booking.status !== "booked" || booking.honorReportedAt) continue;
    if (!booking.redeemBy || now <= Date.parse(booking.redeemBy)) continue;
    booking.status = "expired";
    booking.codeStatus = "expired";
    booking.compliance = booking.compliance || {};
    booking.compliance.expiredAt = nowIso();
    booking.updatedAt = nowIso();
    await store.set(`booking:${booking.id}`, booking);
    await logEvent({ type: "offer_expired", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, redeemBy: booking.redeemBy } });
    summary.expired += 1;
    // Strike rule (refinement bundle, 2026-10-20): an expired
    // redemption window is a strike on the creator. The loop above
    // already skips honor-voided bookings, and business-cancelled
    // bookings never reach "expired" (their status is cancelled),
    // so a strike can only land on a genuine accept-then-vanish.
    // The booking's status change above makes this idempotent: a
    // re-run skips it because it is no longer "booked". At the
    // limit the account pauses pending admin review, with the
    // strike source stamped on the standing record so no proof
    // submission can lift it (unpauseIfClear checks the source).
    const strikeCreator = await store.get(`user:${booking.creatorId}`);
    if (strikeCreator && strikeCreator.role === "creator") {
      const strikes = noShowStrikesOf(strikeCreator) + 1;
      strikeCreator.noShowStrikes = strikes;
      strikeCreator.updatedAt = nowIso();
      await store.set(`user:${strikeCreator.id}`, strikeCreator);
      booking.compliance.strikeCounted = strikes;
      booking.updatedAt = nowIso();
      await store.set(`booking:${booking.id}`, booking);
      await logEvent({ type: "creator_strike", actorId: null, actorRole: "system", subjectId: strikeCreator.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, strikes, limit: STRIKE_LIMIT } });
      summary.strikes = (summary.strikes || 0) + 1;
      if (strikes >= STRIKE_LIMIT && standingState(strikeCreator) !== "banned" && standingState(strikeCreator) !== "paused") {
        strikeCreator.standing = { state: "paused", source: "strikes", reason: strikePauseReason(), at: nowIso(), bookingId: booking.id };
        strikeCreator.updatedAt = nowIso();
        await store.set(`user:${strikeCreator.id}`, strikeCreator);
        await notifyUser(strikeCreator.id, "account_paused_strikes", "Your SIGNL account is paused for review: three booked visit windows expired unused. Reply to the email we sent if something kept you from those visits.", { strikes, limit: STRIKE_LIMIT });
        const mail = strikePauseEmail(strikeCreator);
        await deliverEmail("strike_pause", strikeCreator, mail.subject, mail.text);
        await logEvent({ type: "account_paused_strikes", actorId: null, actorRole: "system", subjectId: strikeCreator.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, strikes, limit: STRIKE_LIMIT } });
        summary.strikePaused = (summary.strikePaused || 0) + 1;
      }
    }
    // An expired paid booking is a no-show: the escrow refunds.
    await refundPaidEscrow(booking, "no_show", summary);
  }
  // Post-performance capture (Jeff, 2026-10-19 round 2): seven days
  // after a proof was submitted, send ONE email asking for the post's
  // views and likes. The marker lives on the post record, so it can
  // never fire twice, and no chase sequence follows it.
  for (const post of posts) {
    if (!post.submittedAt || post.performanceRequestedAt) continue;
    if (now < Date.parse(post.submittedAt) + PERFORMANCE_ASK_DAYS * DAY_MS) continue;
    const booking = bookings.find((b) => b.id === post.bookingId);
    if (!booking) continue;
    const creator = await store.get(`user:${post.creatorId}`);
    if (!creator || creator.role !== "creator") continue;
    post.performanceRequestedAt = nowIso();
    await store.set(`post:${post.id}`, post);
    await logEvent({ type: "post_performance_requested", actorId: null, actorRole: "system", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, creatorId: post.creatorId, businessId: post.businessId } });
    try {
      const mail = postPerformanceEmail(creator, booking);
      await deliverEmail("post_performance", creator, mail.subject, mail.text, null);
    } catch (e) { /* best-effort; the requested event is the record */ }
    summary.performance += 1;
  }
  // Paid-lane escrow release (Jeff, 2026-10-19): a held escrow
  // releases when the post proof exists AND the 48 hour hold after
  // proof has passed. The hold protects against chargebacks on a
  // post that vanishes overnight; release is a state change on the
  // booking plus an event, never a simulated charge.
  for (const booking of bookings) {
    const lane = booking.paidLane;
    if (!lane || lane.escrowState !== "held") continue;
    const post = postByBooking.get(booking.id);
    if (!post || !post.submittedAt) continue;
    if (now < Date.parse(post.submittedAt) + PAID_LANE.escrowHoldHoursAfterProof * 3600000) continue;
    lane.escrowState = "released";
    lane.releasedAt = nowIso();
    booking.updatedAt = nowIso();
    await store.set(`booking:${booking.id}`, booking);
    await logEvent({ type: "paid_escrow_released", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, rate: lane.rate, creatorNet: lane.creatorNet, proofAt: post.submittedAt } });
    summary.escrowReleased += 1;
  }
  return summary;
}

// The offer lifecycle sweep (Jeff, 2026-10-20): the SLA and
// backfill engine for open offers. Runs on the same triggers as
// the compliance sweep (scheduled function, admin endpoint, and a
// throttled opportunistic pass). Everything it does is logged and
// notified; nothing here is silent.
//   - Selection deadline passed with applicants waiting: release
//     them all (reason selection_deadline) and expire the offer.
//   - Redemption window ended: expire the offer, release anyone
//     still waiting (reason offer_expired).
//   - A backfill offer's 24 hour window passed: release that
//     applicant and advance the spot to the next in the stack.
//   - A selected booking expired or was cancelled: free the spot
//     and backfill from the stack.
//   - Zero applications 48 hours after publish: the coaching
//     nudge (attention item on the business home + one email).
async function runOfferSweep() {
  const summary = { offersExpired: 0, slaReleased: 0, backfillAdvanced: 0, backfillOffered: 0, nudges: 0 };
  const now = Date.now();
  const offers = await allOffers();
  const bookings = await allBookings();
  const apps = await allApplications();
  const appsByOffer = new Map();
  for (const a of apps) {
    if (!appsByOffer.has(a.offerId)) appsByOffer.set(a.offerId, []);
    appsByOffer.get(a.offerId).push(a);
  }

  // Freed spots: a selected application's booking died (window
  // expired = the no-show case, or the creator cancelled).
  for (const booking of bookings) {
    if (!booking.applicationId || booking.backfillHandled) continue;
    if (booking.status !== "expired" && booking.status !== "cancelled") continue;
    booking.backfillHandled = true;
    booking.updatedAt = nowIso();
    await store.set(`booking:${booking.id}`, booking);
    const offer = offers.find((o) => o.id === booking.offerId);
    if (offer && (offer.status === "open" || offer.status === "filled")) {
      const offered = await maybeBackfill(offer, bookings);
      if (offered) summary.backfillOffered += 1;
    }
  }

  for (const offer of offers) {
    if (laneOf(offer) !== "open") continue;
    if (offer.status !== "open" && offer.status !== "filled") continue;
    const mine = appsByOffer.get(offer.id) || [];
    const waiting = mine.filter((a) => a.status === "applied");
    const windowEnded = offer.windowEndAt && now > Date.parse(offer.windowEndAt);
    const deadlinePassed = offer.selectionDeadline && now > Date.parse(offer.selectionDeadline);

    // Backfill windows advance first, while the offer is alive.
    if (!windowEnded) {
      for (const app of mine.filter((a) => a.status === "backfill_offered")) {
        if (app.backfillExpiresAt && now > Date.parse(app.backfillExpiresAt)) {
          await releaseApplication(app, "backfill_window_passed");
          summary.backfillAdvanced += 1;
          const fresh = offers.find((o) => o.id === offer.id);
          const offered = await maybeBackfill(fresh || offer, bookings);
          if (offered) summary.backfillOffered += 1;
        }
      }
    }

    if (windowEnded) {
      offer.status = "expired";
      offer.updatedAt = nowIso();
      await store.set(`offer:${offer.id}`, offer);
      summary.offersExpired += 1;
      await logEvent({ type: "offer_expired_window", actorId: null, actorRole: "system", subjectId: offer.id, market: offer.market, data: { businessId: offer.businessId } });
      for (const app of mine.filter((a) => a.status === "applied" || a.status === "backfill_offered")) {
        await releaseApplication(app, "offer_expired");
      }
      continue;
    }

    if (deadlinePassed && waiting.length) {
      for (const app of waiting) {
        await releaseApplication(app, "selection_deadline");
        summary.slaReleased += 1;
      }
      offer.status = "expired";
      offer.updatedAt = nowIso();
      await store.set(`offer:${offer.id}`, offer);
      summary.offersExpired += 1;
      await logEvent({ type: "offer_selection_deadline_passed", actorId: null, actorRole: "system", subjectId: offer.id, market: offer.market, data: { businessId: offer.businessId, released: waiting.length } });
      await notifyUser(offer.businessId, "offer_deadline", `The selection deadline passed on "${offer.title}", so the waiting applications were released. Repost any time; picking applicants inside the window keeps the stack.`, { offerId: offer.id });
      continue;
    }

    // Coaching nudge: published 48+ hours, zero applications ever,
    // not nudged yet. One nudge per offer, ever.
    if (offer.status === "open" && !offer.nudgeSentAt && mine.length === 0 && now > Date.parse(offer.createdAt) + OFFER_NUDGE_HOURS * 3600 * 1000) {
      offer.nudgeSentAt = nowIso();
      offer.updatedAt = nowIso();
      await store.set(`offer:${offer.id}`, offer);
      summary.nudges += 1;
      await logEvent({ type: "offer_nudge_sent", actorId: null, actorRole: "system", subjectId: offer.id, market: offer.market, data: { businessId: offer.businessId, hoursOpen: OFFER_NUDGE_HOURS } });
      await notifyUser(offer.businessId, "offer_nudge", `"${offer.title}" has no applications after 48 hours. Two one-tap fixes usually move it: raise the comp, or widen the redemption window. Both are on the offer card under My Offers.`, { offerId: offer.id });
      const biz = await store.get(`user:${offer.businessId}`);
      if (biz && biz.email) {
        try {
          await deliverEmail("offer_nudge", biz, `No applications yet on "${offer.title}"`, [
            `Hi ${greetingName(biz)},`,
            ``,
            `Your SIGNL offer "${offer.title}" has been open for 48 hours with no applications yet. That is fixable, and the two changes that move offers most are one tap each on the offer card under My Offers in the app:`,
            ``,
            `1. Raise the comp value. Offers priced at or above the typical range for the tier fill first.`,
            `2. Widen the redemption window. Longer windows give creators room to fit the visit in.`,
            ``,
            `Your offer stays live while you decide. Creators apply with one tap, and you pick from the stack.`,
            ``,
            `Jeff`,
            `Founder, SIGNL`,
          ].join("\n"), null);
        } catch (e) { /* email is best-effort; the nudge event and attention item are the record */ }
      }
    }
  }
  return summary;
}

const OFFER_SWEEP_THROTTLE_MS = 55 * 60 * 1000;
async function maybeRunOfferSweep() {
  const rec = await store.get("config:offerSweep");
  const last = rec && rec.lastRunAt ? Date.parse(rec.lastRunAt) : 0;
  if (Date.now() - last < OFFER_SWEEP_THROTTLE_MS) return null;
  await store.set("config:offerSweep", { lastRunAt: nowIso() });
  return runOfferSweep();
}

const SWEEP_THROTTLE_MS = 55 * 60 * 1000;
async function maybeRunComplianceSweep() {
  const rec = await store.get("config:complianceSweep");
  const last = rec && rec.lastRunAt ? Date.parse(rec.lastRunAt) : 0;
  if (Date.now() - last < SWEEP_THROTTLE_MS) return;
  // Claim before running so concurrent requests do not pile on.
  await store.set("config:complianceSweep", { lastRunAt: nowIso() });
  await runComplianceSweep();
}

const CAMPAIGN_SWEEP_THROTTLE_MS = 25 * 60 * 1000;
async function maybeRunCampaignSweep() {
  if (TEST_MODE) return;
  const rec = await store.get("config:campaignSweep");
  const last = rec && rec.lastRunAt ? Date.parse(rec.lastRunAt) : 0;
  if (Date.now() - last < CAMPAIGN_SWEEP_THROTTLE_MS) return;
  // Claim before running so concurrent requests do not pile on.
  await store.set("config:campaignSweep", { lastRunAt: nowIso() });
  await runCampaignSweep();
}

// ---------- profile completion reminder sweep (Jeff, 2026-10-20) ----------
// The two-step claim leaves some approved creators with an
// unfinished profile: approved, spot locked, but invisible to
// businesses until the gate fields land. Three days after
// approval, ONE reminder goes out (the approval email already made
// the full pitch; this is the shorter nudge). The sent stamp lives
// on the user record, so it can never fire twice. Testers and
// preview records are excluded: preview writes no user records at
// all, and a tester is not on the roster. Runs on the same
// triggers as the compliance sweep: the scheduled function (via
// the admin compliance sweep endpoint) and a throttled
// opportunistic pass on ordinary requests. An explicit `now` is
// honored ONLY in TEST_MODE, mirroring the campaign sweep.
const PROFILE_REMINDER_DAYS = 3;
async function runProfileCompletionReminderSweep(opts = {}) {
  const summary = { checked: 0, sent: 0 };
  const now = opts.now ? opts.now.getTime() : Date.now();
  const users = await allUsers();
  for (const u of users) {
    if (u.role !== "creator" || u.status !== "approved" || isTester(u)) continue;
    if (standingState(u) === "banned") continue;
    if (profileCompleteOf(u)) continue;
    summary.checked += 1;
    if (u.profileCompletionReminderSentAt) continue;
    if (!u.reviewedAt) continue;
    if (now - Date.parse(u.reviewedAt) < PROFILE_REMINDER_DAYS * DAY_MS) continue;
    u.profileCompletionReminderSentAt = nowIso();
    u.updatedAt = nowIso();
    await store.set(`user:${u.id}`, u);
    await logEvent({ type: "profile_completion_reminder_sent", actorId: null, actorRole: "system", subjectId: u.id, market: u.market, data: { handle: u.creator ? u.creator.handle : null, approvedAt: u.reviewedAt, missing: profileCompletionFor(u).missing } });
    try {
      const mail = profileCompletionReminderEmail(u);
      await deliverEmail("profile_completion_reminder", u, mail.subject, mail.text, null);
    } catch (e) { /* email is best-effort; the sent stamp and the event are the record */ }
    summary.sent += 1;
  }
  return summary;
}

const PROFILE_REMINDER_SWEEP_THROTTLE_MS = 55 * 60 * 1000;
async function maybeRunProfileReminderSweep() {
  const rec = await store.get("config:profileReminderSweep");
  const last = rec && rec.lastRunAt ? Date.parse(rec.lastRunAt) : 0;
  if (Date.now() - last < PROFILE_REMINDER_SWEEP_THROTTLE_MS) return null;
  await store.set("config:profileReminderSweep", { lastRunAt: nowIso() });
  return runProfileCompletionReminderSweep();
}

// ---------- Creator outreach campaign sender (Jeff, 2026-10-19) ----------
// Jeff approved a creator outreach email and wants it sent WITHOUT
// per-send approval cards. The Gmail connector pops a card per
// send; the app's own SMTP transport (lib/email.js) does not, so the
// campaign sends from INSIDE the app, exactly like its transactional
// mail. Design constraints that keep this small and safe:
//   - Recipients live in Blobs: one config record per campaign
//     (campaign:<id>) and one record per recipient
//     (campaign-recipient:<id>:<email>). The queue ships EMPTY;
//     recipients arrive only through the admin import endpoint,
//     already skip-filtered by whoever prepares the import. The
//     server additionally refuses tester-account emails at import
//     and prunes them from the queue at sweep time, so a tester
//     can never receive a campaign send.
//   - Sending happens only in runCampaignSweep(): the campaign must
//     be ARMED (Jeff arms it in the admin UI) and the clock must be
//     inside the send window, 08:00-21:00 America/New_York.
//   - Batches are small (8). Volume is governed by a GLOBAL daily
//     ceiling (40 sends per America/New_York calendar day across
//     ALL campaigns): the constraint being protected is the hello@
//     sending domain's reputation, not any single campaign, so the
//     ceiling follows the domain. Reaching it is not an error; the
//     sweep simply sends nothing more that day and campaigns stay
//     armed. A per-campaign lifetime backstop (1,000) exists purely
//     as a bug guard and is never expected to bind. More than 2
//     send failures in one run stop the run and set
//     campaign.lastError. An emptied queue auto-disarms.
//   - A second campaign (founding-crossover-2026-10) targets
//     creators already on national platforms with an additive,
//     non-exclusive pitch (crossoverEmail()). It runs through the
//     exact same machinery and ceiling; the only extra rule is at
//     import: an address the founding campaign already holds is
//     recorded on the crossover campaign as skipped with reason
//     cross_campaign, so nobody receives two outreach emails.
//   - "bounced" exists as a recipient status for the day bounce
//     handling is automated; v1 never sets it (SMTP send results
//     cannot see bounces), so counts report it honestly as 0.
const DEFAULT_CAMPAIGN_ID = "founding-creators-2026-10";
// Second campaign (Jeff, 2026-10-19): platform-crossover creators,
// the ones already working national platforms (Grin, Cohley,
// Momfluence and the like). Same machinery, different email: the
// pitch is additive and non-exclusive. SIGNL is the local layer on
// top of the national deals they keep, never a replacement.
const CROSSOVER_CAMPAIGN_ID = "founding-crossover-2026-10";
const CAMPAIGN_BATCH_SIZE = 8;
// Anti-spam daily ceiling (Jeff, 2026-10-19): at most this many
// campaign sends per America/New_York calendar day, counted across
// ALL campaigns combined, because what the ceiling protects is the
// hello@ sending domain, not a campaign. The count is derived from
// the recipient records themselves (every successful send stamps
// sentAt on its own record), so there is no separate counter to
// drift from reality or to race: see campaignSentToday().
const CAMPAIGN_DAILY_CEILING = 40;
// Runaway backstop ONLY: a per-campaign lifetime ceiling set so
// high it can bind only if something is deeply wrong (a bug looping
// sends). It is a bug guard, never a product limit, and normal
// operation never reaches it; the daily ceiling above is the real
// volume control.
const CAMPAIGN_RUNAWAY_BACKSTOP = 1000;
const CAMPAIGN_MAX_FAILURES_PER_RUN = 2;
const CAMPAIGN_WINDOW = { startHour: 8, endHour: 21, timeZone: "America/New_York" };

function campaignPaceMs() {
  const n = parseInt(process.env.SIGNL_CAMPAIGN_PACE_MS || "", 10);
  return Number.isNaN(n) ? 400 : Math.max(0, n);
}
const campaignSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function validCampaignId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,60}$/.test(id);
}

async function getCampaignConfig(campaignId) {
  const rec = await store.get(`campaign:${campaignId}`);
  if (rec) return rec;
  return { id: campaignId, armed: false, armedAt: null, armedBy: null, disarmedAt: null, disarmReason: null, lastError: null, lastRunAt: null, totalSent: 0, createdAt: null, updatedAt: null };
}

async function saveCampaignConfig(cfg) {
  cfg.updatedAt = nowIso();
  await store.set(`campaign:${cfg.id}`, cfg);
  return cfg;
}

async function listCampaignRecipients(campaignId) {
  const rows = await store.list(`campaign-recipient:${campaignId}:`);
  return rows.map((r) => r.value);
}

function campaignCounts(recipients) {
  const counts = { queued: 0, sent: 0, bounced: 0, skipped: 0, total: recipients.length };
  for (const r of recipients) {
    if (Object.prototype.hasOwnProperty.call(counts, r.status)) counts[r.status] += 1;
  }
  return counts;
}

function campaignFirstName(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  if (!first || first.includes("@")) return "there";
  return first;
}

// The founding mechanics paragraph, shared by both campaign
// templates: Hampton Roads (the November / Black Friday launch
// market) vs every other founding market, which opens in waves in
// the following 30 to 90 days.
function campaignMarketParagraph(market) {
  return market === "Hampton Roads"
    ? "Hampton Roads launches in November, and our opening push is Black Friday weekend. Founding creators are joining now, in sign-up order, and the first ones in get seen first when businesses start choosing."
    : `${market} is a founding market: sign-ups are open now and offers open city by city as the roster fills, in the next 30 to 90 days. Founding creators join in sign-up order, and the first ones in get seen first when businesses start choosing.`;
}

function campaignClaimLink(recipient) {
  const market = String(recipient.market || "");
  return `app.joinsignl.com/?handle=${encodeURIComponent(String(recipient.handle || "").replace(/^@/, ""))}&market=${encodeURIComponent(market)}`;
}

// The Jeff-approved outreach email (2026-10-19), rendered server
// side from the recipient's slots. Plain text, first name only,
// no em dashes. The market paragraph differs for Hampton Roads
// (the November / Black Friday launch market) vs everywhere else.
function campaignEmail(recipient) {
  const market = String(recipient.market || "");
  const subject = `A founding creator spot in ${market}`;
  const marketParagraph = campaignMarketParagraph(market);
  const lines = [
    `Hi ${campaignFirstName(recipient.name)},`,
    "",
    `I'm Jeff, founder of SIGNL. I found you through ${String(recipient.opener || "").trim()}. You're exactly the kind of local voice we're building around.`,
    "",
    "SIGNL connects local creators with local businesses: they comp you a meal, a service, or an experience, and you post honestly about it within 48 hours. No script, no required praise, full disclosure. Businesses get real local posts. You get comped experiences and a founding profile that's live and shareable from day one.",
    "",
    marketParagraph,
    "",
    "Your spot is partly filled in already:",
    campaignClaimLink(recipient),
    "",
    "If you apply, you will get a decision or a clear status within 2 business days.",
    "",
    "Two minutes. " + CREATOR_FREE_LINE + " If it's not for you, you won't hear from me again.",
    "",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com | joinsignl.com",
    "National platforms sell reach. We sell regulars.",
  ];
  return { subject, text: lines.join("\n") };
}

// The crossover email (Jeff, 2026-10-19), for creators already
// working national platforms. The positioning is additive and
// non-exclusive by design: they keep every national deal they
// have, and SIGNL is the local layer on top, in their own city.
// Same rules as the founding template: plain text, first name
// only sign-off, no em dashes, claim link prefilled.
function crossoverEmail(recipient) {
  const market = String(recipient.market || "");
  const subject = `Your national platforms, plus a local layer in ${market}`;
  const lines = [
    `Hi ${campaignFirstName(recipient.name)},`,
    "",
    `I'm Jeff, founder of SIGNL. I found you through ${String(recipient.opener || "").trim()}.`,
    "",
    "You already know how the national platforms work, platforms like Grin, Cohley, or Momfluence. SIGNL is not asking you to leave any of them, and nothing about SIGNL is exclusive. Keep every national deal you have. SIGNL is the local layer on top: the work in your own city that the national platforms cannot see.",
    "",
    `Here is what that layer looks like in ${market}. Local businesses comp you a meal, a service, or an experience, and you post honestly about it within 48 hours. No script, no required praise, full disclosure. Every visit is tracked, and your delivered posts build a public track record that businesses near you can see.`,
    "",
    "There is local money in it too, two ways. First, you can set a paid rate on your SIGNL profile for direct local bookings: you keep 97 percent of your rate, the business covers another 3 percent on their side, and SIGNL holds the payment and releases it when your post is live. Second, creators with 15k+ followers are first in line for paid cash campaigns when local businesses run them.",
    "",
    "Why local pays differently: the followers who live near you are the customers local businesses actually want, and a national platform cannot tell a business what share of a creator's audience lives in its market. SIGNL leads with exactly that number.",
    "",
    campaignMarketParagraph(market),
    "",
    "Your founding profile is free, and your spot is held in sign-up order. Claim yours here, it takes about two minutes:",
    `https://${campaignClaimLink(recipient)}`,
    "",
    "If you apply, you will get a decision or a clear status within 2 business days.",
    "",
    "If it's not for you, no hard feelings, and you won't hear from me again.",
    "",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com | joinsignl.com",
    "National platforms sell reach. We sell regulars.",
  ];
  return { subject, text: lines.join("\n") };
}

// Which template a campaign sends. Every campaign except the
// crossover campaign uses the founding template; crossover
// recipients are stored under their own campaign keys and only
// ever receive the crossover email.
function campaignEmailFor(campaignId, recipient) {
  return campaignId === CROSSOVER_CAMPAIGN_ID ? crossoverEmail(recipient) : campaignEmail(recipient);
}

function campaignWindowOpen(date) {
  const hourRaw = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: CAMPAIGN_WINDOW.timeZone }).format(date);
  const hour = ((parseInt(hourRaw, 10) % 24) + 24) % 24;
  return hour >= CAMPAIGN_WINDOW.startHour && hour < CAMPAIGN_WINDOW.endHour;
}

// yyyy-mm-dd of a date in the campaign timezone (America/New_York),
// the calendar the daily ceiling runs on.
function campaignDayKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CAMPAIGN_WINDOW.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// How many campaign emails have already gone out on the ET calendar
// day containing `now`, across every campaign. Derived from the
// recipient records themselves: each successful send stamps sentAt
// on its own record (a unique key per recipient), so the count is
// always exactly the sends that happened, with no separate counter
// record to increment, drift, or lose a race. The sweep runs under
// the claim-before-run throttle lock, and even if two runs ever
// overlapped, the worst case is one extra small batch, because each
// run re-derives the count before it sends.
async function campaignSentToday(now) {
  const dayKey = campaignDayKey(now);
  const rows = await store.list("campaign-recipient:");
  let n = 0;
  for (const row of rows) {
    const r = row.value;
    if (!r || r.status !== "sent" || !r.sentAt) continue;
    const t = Date.parse(r.sentAt);
    if (Number.isNaN(t)) continue;
    if (campaignDayKey(new Date(t)) === dayKey) n += 1;
  }
  return n;
}

// One campaign sweep pass over every campaign config. Sends only
// for armed campaigns inside the window. Returns a summary; the
// scheduled function (netlify/functions/campaign-sweep.mjs) and the
// admin endpoint are the callers. `opts.now` exists for the verify
// suites (TEST_MODE only at the endpoint) so the window can be
// time-traveled deterministically.
async function runCampaignSweep(opts = {}) {
  const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
  const summary = { campaigns: 0, armed: 0, windowClosed: 0, attempted: 0, sent: 0, failed: 0, backstopReached: 0, dailyCeilingHit: 0, disarmed: 0, skippedTesters: 0, sentToday: 0, dailyCeiling: CAMPAIGN_DAILY_CEILING };
  // Global daily ceiling: sends already made today, across every
  // campaign, counted once up front and incremented locally as this
  // run sends, so a multi-campaign sweep can never overshoot.
  let sentToday = await campaignSentToday(now);
  summary.sentToday = sentToday;
  const configs = (await store.list("campaign:")).map((r) => r.value);
  for (const cfg of configs) {
    if (!cfg || !cfg.id) continue;
    summary.campaigns += 1;
    if (!cfg.armed) continue;
    summary.armed += 1;
    if (!campaignWindowOpen(now)) { summary.windowClosed += 1; continue; }
    let recipients = await listCampaignRecipients(cfg.id);
    // Tester guard (Jeff, 2026-10-19): an address queued before its
    // account was flagged tester must still never be sent to. Any
    // queued recipient whose email now belongs to a tester account
    // leaves the queue as skipped before the batch is picked.
    if (recipients.some((r) => r.status === "queued")) {
      const testerEmails = new Set((await allUsers()).filter((u) => isTester(u)).map((u) => String(u.email || "").toLowerCase()));
      let pruned = false;
      for (const r of recipients) {
        if (r.status !== "queued" || !testerEmails.has(String(r.email || "").toLowerCase())) continue;
        r.status = "skipped";
        r.skipReason = "tester_account";
        r.updatedAt = now.toISOString();
        await store.set(`campaign-recipient:${cfg.id}:${r.email}`, r);
        summary.skippedTesters += 1;
        pruned = true;
        await logEvent({ type: "campaign_recipient_skipped", actorId: null, actorRole: "system", subjectId: null, market: r.market || null, data: { campaignId: cfg.id, email: r.email, reason: "tester_account" } });
      }
      if (pruned) recipients = await listCampaignRecipients(cfg.id);
    }
    let counts = campaignCounts(recipients);
    cfg.lastRunAt = now.toISOString();
    if (counts.sent >= CAMPAIGN_RUNAWAY_BACKSTOP) {
      // Bug guard only (see CAMPAIGN_RUNAWAY_BACKSTOP): a campaign
      // at the backstop means something looped, so stop it loudly.
      cfg.armed = false;
      cfg.disarmedAt = now.toISOString();
      cfg.disarmReason = "runaway_backstop_reached";
      cfg.lastError = `Runaway backstop reached: this campaign has sent ${counts.sent} emails in its lifetime, which should never happen. It has been disarmed; investigate before re-arming.`;
      await saveCampaignConfig(cfg);
      await logEvent({ type: "campaign_runaway_backstop_reached", actorId: null, actorRole: "system", subjectId: null, market: null, data: { campaignId: cfg.id, totalSent: counts.sent, backstop: CAMPAIGN_RUNAWAY_BACKSTOP } });
      summary.backstopReached += 1;
      summary.disarmed += 1;
      continue;
    }
    const remainingToday = CAMPAIGN_DAILY_CEILING - sentToday;
    if (remainingToday <= 0) {
      // The daily ceiling is reached: not an error, nothing is
      // wrong. The campaign stays armed, no lastError is set, and
      // the queue simply waits for the next ET calendar day.
      summary.dailyCeilingHit += 1;
      await saveCampaignConfig(cfg);
      continue;
    }
    const batch = recipients
      .filter((r) => r.status === "queued")
      .slice(0, Math.min(CAMPAIGN_BATCH_SIZE, CAMPAIGN_RUNAWAY_BACKSTOP - counts.sent, remainingToday));
    let failures = 0;
    let lastReason = null;
    for (let i = 0; i < batch.length; i++) {
      if (failures > CAMPAIGN_MAX_FAILURES_PER_RUN) break;
      const recipient = batch[i];
      const mail = campaignEmailFor(cfg.id, recipient);
      const messageRef = crypto.randomUUID();
      const result = await sendEmail({ to: recipient.email, subject: mail.subject, text: mail.text });
      summary.attempted += 1;
      if (result.sent) {
        recipient.status = "sent";
        recipient.sentAt = now.toISOString();
        recipient.messageRef = messageRef;
        recipient.updatedAt = now.toISOString();
        await store.set(`campaign-recipient:${cfg.id}:${recipient.email}`, recipient);
        counts.sent += 1;
        summary.sent += 1;
        sentToday += 1;
        summary.sentToday = sentToday;
        await logEvent({ type: "campaign_email_sent", actorId: null, actorRole: "system", subjectId: null, market: recipient.market || null, data: { campaignId: cfg.id, email: recipient.email, handle: recipient.handle || null, messageRef } });
      } else {
        failures += 1;
        summary.failed += 1;
        lastReason = result.reason || "send_failed";
        recipient.attempts = (recipient.attempts || 0) + 1;
        recipient.lastAttemptAt = now.toISOString();
        recipient.lastError = lastReason;
        recipient.updatedAt = now.toISOString();
        await store.set(`campaign-recipient:${cfg.id}:${recipient.email}`, recipient);
        await logEvent({ type: "campaign_email_failed", actorId: null, actorRole: "system", subjectId: null, market: recipient.market || null, data: { campaignId: cfg.id, email: recipient.email, handle: recipient.handle || null, reason: lastReason } });
      }
      if (i < batch.length - 1) {
        const pace = campaignPaceMs();
        if (pace > 0) await campaignSleep(pace);
      }
    }
    if (failures > CAMPAIGN_MAX_FAILURES_PER_RUN) {
      cfg.lastError = `Send run stopped after ${failures} failures (last: ${lastReason}). The queue is paused where it stands; check the transport, then the next scheduled run retries.`;
    }
    const after = await listCampaignRecipients(cfg.id);
    counts = campaignCounts(after);
    cfg.totalSent = counts.sent;
    if (cfg.armed && counts.queued === 0 && counts.sent > 0) {
      cfg.armed = false;
      cfg.disarmedAt = now.toISOString();
      cfg.disarmReason = "queue_empty";
      await logEvent({ type: "campaign_queue_empty", actorId: null, actorRole: "system", subjectId: null, market: null, data: { campaignId: cfg.id, totalSent: counts.sent } });
      summary.disarmed += 1;
    } else if (cfg.armed && counts.sent >= CAMPAIGN_RUNAWAY_BACKSTOP) {
      cfg.armed = false;
      cfg.disarmedAt = now.toISOString();
      cfg.disarmReason = "runaway_backstop_reached";
      await logEvent({ type: "campaign_runaway_backstop_reached", actorId: null, actorRole: "system", subjectId: null, market: null, data: { campaignId: cfg.id, totalSent: counts.sent, backstop: CAMPAIGN_RUNAWAY_BACKSTOP } });
      summary.backstopReached += 1;
      summary.disarmed += 1;
    }
    await saveCampaignConfig(cfg);
  }
  return summary;
}

function campaignView(cfg, counts, sentToday) {
  return {
    id: cfg.id,
    armed: !!cfg.armed,
    armedAt: cfg.armedAt || null,
    disarmedAt: cfg.disarmedAt || null,
    disarmReason: cfg.disarmReason || null,
    lastError: cfg.lastError || null,
    lastRunAt: cfg.lastRunAt || null,
    totalSent: counts ? counts.sent : cfg.totalSent || 0,
    dailyCeiling: CAMPAIGN_DAILY_CEILING,
    sentToday: typeof sentToday === "number" ? sentToday : null,
    backstop: CAMPAIGN_RUNAWAY_BACKSTOP,
    batchSize: CAMPAIGN_BATCH_SIZE,
    window: { startHour: CAMPAIGN_WINDOW.startHour, endHour: CAMPAIGN_WINDOW.endHour, timeZone: CAMPAIGN_WINDOW.timeZone },
    windowOpenNow: campaignWindowOpen(new Date()),
  };
}

// Staff notice (Jeff, 2026-10-19 r2): the moment a creator checks
// in or a comp is redeemed, the business gets an email: who is
// here, their photo, what is comped, the code, and how it works.
// Windows replaced fixed visit days, so this replaces any
// morning-of notice. One notice per trigger per booking, logged
// as staff_notice_sent. Preview mode never reaches a redemption,
// so no preview email can exist.
function staffNoticeEmail(creator, booking, trigger) {
  const c = creator.creator || {};
  const photo = c.hasPhoto ? `https://app.joinsignl.com/api/users/${creator.id}/photo` : "(no photo on file yet)";
  const happening = trigger === "checkin" ? `${creator.name} (@${c.handle || ""}) just checked in at your business on SIGNL.` : `${creator.name} (@${c.handle || ""}) is redeeming their SIGNL comp right now.`;
  return {
    subject: trigger === "checkin" ? `SIGNL check-in: ${creator.name} is here` : `SIGNL visit now: ${creator.name} is redeeming their comp`,
    text: [
      happening,
      "",
      `Creator: ${creator.name} (@${c.handle || ""})`,
      `Photo: ${photo}`,
      `Comp: ${booking.whatComped} (cap $${booking.dollarCap})`,
      `Booking code: ${booking.code}`,
      "",
      "How it works: the creator shows this code, you redeem it in the app at the Counter tab, and their 48 hour post clock starts at that moment. Ring the comp in your own system the way you normally do; SIGNL never touches your register.",
      "",
      "The SIGNL team",
      "hello@joinsignl.com",
    ].join("\n"),
  };
}

async function sendStaffNotice(booking, trigger) {
  const marker = trigger === "checkin" ? "checkinNoticeAt" : "redeemNoticeAt";
  booking.staffNotice = booking.staffNotice || {};
  if (booking.staffNotice[marker]) return;
  const [bizUser, creator] = await Promise.all([store.get(`user:${booking.businessId}`), store.get(`user:${booking.creatorId}`)]);
  if (!bizUser || !creator) return;
  booking.staffNotice[marker] = nowIso();
  await store.set(`booking:${booking.id}`, booking);
  await logEvent({ type: "staff_notice_sent", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { trigger, creatorId: booking.creatorId, businessId: booking.businessId, code: booking.code } });
  try {
    const mail = staffNoticeEmail(creator, booking, trigger);
    await deliverEmail("staff_notice", bizUser, mail.subject, mail.text, null);
  } catch (e) { /* best-effort; the event is the record */ }
}

// The ONE counter redemption (Jeff, 2026-10-20 late): burn the
// code, start the 48 hour post clock, log it, and send the owner
// the staff notice. The owner Counter tab and staff mode both run
// through here, so a redemption means exactly the same thing
// whoever taps the button. actor.via is "owner" or "staff" and is
// stamped on the booking (owner visit views show it) and on the
// code_redeemed event. Callers check the not-yet-redeemed state
// before calling; this function assumes the code is live.
async function performCounterRedeem(booking, actor) {
  const ts = nowIso();
  booking.redeemedAt = ts;
  booking.redeemMethod = "counter_code";
  booking.redeemedVia = actor.via;
  booking.codeStatus = "burned";
  booking.status = "redeemed";
  booking.postDeadline = new Date(Date.parse(ts) + COMPLIANCE.onTimeHours * 3600 * 1000).toISOString();
  booking.updatedAt = ts;
  await store.set(`booking:${booking.id}`, booking);
  await logEvent({ type: "code_redeemed", actorId: actor.id, actorRole: actor.role, subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, code: booking.code, method: "counter_code", via: actor.via, postDeadline: booking.postDeadline, dollarCap: booking.dollarCap } });
  await sendStaffNotice(booking, "redeem");
  return booking;
}

// ---------- staff redemption mode (Jeff, 2026-10-20 late) ----------
// The person at the register is a host or a server, not the owner,
// so redemption cannot require the owner's login. Staff mode is
// the answer: a scoped session for ONE business, opened with the
// business's staff PIN, that can do exactly three things (look up
// a creator code for that business, see that visit's essentials,
// redeem it) and nothing else. It is NOT a user account: the token
// lives in its own cookie (signl_staff) and its own record
// namespace (staffsession:), so it never resolves as a signed-in
// user anywhere; every owner route still answers it 401.
//
// Records:
//   staffpin:{businessId}     { salt, hash, setAt, updatedAt }
//                             scrypt, same helpers as passwords;
//                             a separate record so the secret can
//                             never ride a user payload.
//   staffcfg:{businessId}     { staffCode, epoch, createdAt }
//   bizcode:{CODE}            { businessId }  staff-code index;
//                             the code is the typeable identifier
//                             printed on the register card.
//   staffsession:{token}      { businessId, epoch, createdAt,
//                             expiresAt }  12 hour shift session.
//   staffguard:{businessId}   { fails: [ms], lockedUntil }
//                             5 wrong PINs inside 15 minutes locks
//                             staff entry for that business 15 min.
// Sign out all staff devices bumps the cfg epoch and deletes the
// business's session records, so every outstanding token dies.
const STAFF_SESSION_TTL_MS = 12 * 3600 * 1000;
const STAFF_PIN_MAX_FAILS = 5;
const STAFF_PIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const STAFF_PIN_LOCK_MS = 15 * 60 * 1000;
const STAFF_LOOKUP_LIMIT = 30;
const STAFF_LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const staffLookupAttempts = new Map(); // staff token -> [ms]

function staffCookie(token, secure) {
  const parts = [
    `signl_staff=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(STAFF_SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearStaffCookie(secure) {
  const parts = ["signl_staff=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function staffPinRecord(businessId) {
  return store.get(`staffpin:${businessId}`);
}

// The business's staff code: six unambiguous characters, minted
// lazily the first time staff settings are read or a PIN is set,
// indexed for the register link and the generic entry path.
async function ensureStaffCode(bizUser) {
  let cfg = await store.get(`staffcfg:${bizUser.id}`);
  if (cfg && cfg.staffCode) return cfg;
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    const taken = await store.get(`bizcode:${code}`);
    if (!taken) {
      cfg = { staffCode: code, epoch: (cfg && cfg.epoch) || 0, createdAt: nowIso() };
      await store.set(`staffcfg:${bizUser.id}`, cfg);
      await store.set(`bizcode:${code}`, { businessId: bizUser.id });
      return cfg;
    }
  }
  return cfg || { staffCode: null, epoch: 0 };
}

async function businessByStaffCode(code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return null;
  const idx = await store.get(`bizcode:${clean}`);
  if (!idx || !idx.businessId) return null;
  const biz = await store.get(`user:${idx.businessId}`);
  return biz && biz.role === "business" && biz.business ? biz : null;
}

async function staffPinLock(businessId) {
  const g = await store.get(`staffguard:${businessId}`);
  return g && g.lockedUntil && Date.now() < Date.parse(g.lockedUntil) ? g : null;
}

async function staffPinFail(businessId) {
  const now = Date.now();
  const g = (await store.get(`staffguard:${businessId}`)) || { fails: [], lockedUntil: null };
  g.fails = (g.fails || []).filter((t) => now - t < STAFF_PIN_FAIL_WINDOW_MS);
  g.fails.push(now);
  if (g.fails.length >= STAFF_PIN_MAX_FAILS) {
    g.lockedUntil = new Date(now + STAFF_PIN_LOCK_MS).toISOString();
    g.fails = [];
  }
  await store.set(`staffguard:${businessId}`, g);
  return g;
}

async function createStaffSession(businessId) {
  const cfg = (await store.get(`staffcfg:${businessId}`)) || { epoch: 0 };
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await store.set(`staffsession:${token}`, {
    businessId,
    epoch: cfg.epoch || 0,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + STAFF_SESSION_TTL_MS).toISOString(),
  });
  return token;
}

async function getStaffContext(event) {
  const cookies = auth.parseCookies(event.headers.cookie || event.headers.Cookie || "");
  const token = cookies.signl_staff;
  if (!token) return null;
  const s = await store.get(`staffsession:${token}`);
  if (!s) return null;
  if (Date.now() > Date.parse(s.expiresAt)) {
    await store.del(`staffsession:${token}`);
    return null;
  }
  const cfg = await store.get(`staffcfg:${s.businessId}`);
  if (((cfg && cfg.epoch) || 0) !== (s.epoch || 0)) {
    await store.del(`staffsession:${token}`);
    return null;
  }
  const biz = await store.get(`user:${s.businessId}`);
  if (!biz || biz.role !== "business" || !biz.business) return null;
  return { token, businessId: s.businessId, business: biz, expiresAt: s.expiresAt };
}

function staffLookupAllowed(token) {
  const now = Date.now();
  const hits = (staffLookupAttempts.get(token) || []).filter((t) => now - t < STAFF_LOOKUP_WINDOW_MS);
  if (hits.length >= STAFF_LOOKUP_LIMIT) {
    staffLookupAttempts.set(token, hits);
    return false;
  }
  hits.push(now);
  staffLookupAttempts.set(token, hits);
  return true;
}

// The staff-scoped view of a booking: the redemption essentials
// and nothing else. No audience codes, no money beyond the comp
// cap the creator already agreed to show, no other bookings.
function staffBookingView(booking) {
  let windowStatus = "open";
  if (booking.status === "expired" || (booking.redeemBy && Date.now() > Date.parse(booking.redeemBy))) windowStatus = "closed";
  return {
    creatorName: booking.creatorName,
    creatorHandle: booking.creatorHandle || "",
    title: booking.title,
    whatComped: booking.whatComped,
    covers: booking.kind === "paid" ? null : coversOf(booking),
    dollarCap: booking.dollarCap,
    visitDate: booking.visitDate || "",
    visitWindow: booking.visitWindow || "",
    redeemBy: booking.redeemBy || null,
    windowStatus,
    redeemedAt: booking.redeemedAt || null,
    postDeadline: booking.postDeadline || null,
    code: booking.code,
  };
}

// After a proof lands, a paused creator unpauses automatically UNLESS
// another redeemed visit is still sitting in its pause window. A ban
// is never lifted here: reinstatement is a human decision.
async function unpauseIfClear(creator, sourceBookingId) {
  if (standingState(creator) !== "paused") return false;
  // A strike pause is admin-review only: a proof landing on some
  // other visit must never lift it.
  if (strikePaused(creator)) return false;
  const bookings = (await allBookings()).filter((b) => b.creatorId === creator.id && b.redeemedAt && b.status !== "completed");
  const posts = await allPosts();
  const postedIds = new Set(posts.filter((p) => p.creatorId === creator.id).map((p) => p.bookingId));
  const now = Date.now();
  const stillPaused = bookings.some((b) => b.id !== sourceBookingId && !postedIds.has(b.id) && now >= Date.parse(pauseAtFor(b)) && now < Date.parse(banAtFor(b)));
  if (stillPaused) return false;
  creator.standing = { state: "good", reason: null, at: nowIso(), bookingId: null };
  creator.updatedAt = nowIso();
  await store.set(`user:${creator.id}`, creator);
  await logEvent({ type: "account_unpaused", actorId: creator.id, actorRole: "creator", subjectId: creator.id, market: creator.market, data: { bookingId: sourceBookingId, how: "proof_submitted" } });
  return true;
}

async function genCode() {
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = "SGNL-";
    for (let i = 0; i < 6; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    const taken = await store.get(`code:${code}`);
    if (!taken) return code;
  }
  throw new Error("Could not allocate a booking code");
}

// ---------- Business Preview dashboard (Jeff, 2026-10-19) ----------
// The business home Jeff asked to walk through end to end: one
// simulated business on the Growth plan, a roster of bookings across
// the REAL approved creators, and every lifecycle state on one
// screen - code issued, redeemed with the 48 hour clock running,
// posted on time with performance and a review, posted late, and one
// visit sitting in the late window so a problem surfaces the way a
// business actually sees it. Every timestamp is computed relative to
// the request, so the states and the countdown are always live.
// The invariant is the preview invariant, held absolutely: this
// builder READS the user store and the code index and writes
// NOTHING. No store.set, no logEvent, no metric moves; the bookings
// exist only inside this response and nowhere else in the system.
const PREVIEW_DASH_BUSINESS = { name: "Salt & Ember Kitchen", category: "Chef-driven restaurant", market: "Hampton Roads" };
// Salt & Ember is presented as a business that HAS opted in to
// audience-code discounts, at its own chosen 20 percent: that is
// what keeps the simulated tallies below scoring exactly as they
// always have. The dashboard says so in words next to the score.
// (Discounts are every business's own opt-in, never a default.)
const PREVIEW_DASH_DISCOUNT = { enabled: true, pct: ROAS_MODEL.suggestedDiscountPct };
// The preview staff demo's fixed credentials (refinement bundle,
// 2026-10-20): displayed ONLY inside Business Preview, valid ONLY
// for the in-memory simulation the client runs from the preview
// dashboard payload. They are not a real staff code or PIN: no
// staffcfg or staffpin record ever carries them, and the real
// staff endpoints have never heard of them.
const PREVIEW_STAFF_DEMO = { staffCode: "EMBER6", pin: "2468" };

function hoursFrom(nowMs, h) {
  return new Date(nowMs + h * 3600 * 1000).toISOString();
}

function previewFmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// Same QR the creator's real visit screen carries: the counter URL
// for the code, generated with the same library and settings.
function previewQrSvg(code) {
  try {
    const qrcode = require("qrcode-generator");
    const qr = qrcode(0, "M");
    const base = process.env.APP_URL || "https://app.joinsignl.com";
    qr.addData(`${base}/counter?code=${code}`);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 8, scalable: true });
  } catch (e) {
    return null;
  }
}

// A display-only code for a simulated booking. Checked (read-only)
// against the live code index and against the codes already handed
// out in this response, so a simulated code never equals a real one.
async function previewDisplayCode(used) {
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = "SGNL-";
    for (let i = 0; i < 6; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (used.has(code)) continue;
    const taken = await store.get(`code:${code}`);
    if (!taken) { used.add(code); return code; }
  }
  used.add("SGNL-PREVUE");
  return "SGNL-PREVUE";
}

// A display-only audience code for a simulated booking (the
// SIGNL ROAS creator code). Derived from the creator's handle
// like the real ones; never written to the ccode: index, so a
// simulated code can never be reported against or collide with
// a real tally.
function previewCreatorCode(handle, used) {
  const base = creatorCodeBase(handle);
  for (let attempt = 0; attempt < 12; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) suffix += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    const code = `${base}-${suffix}`;
    if (!used.has(code)) { used.add(code); return code; }
  }
  used.add(`${base}-PREVIEW`);
  return `${base}-PREVIEW`;
}

// The Standard Visit checklist for one simulated booking, in the same
// states the real surfaces compute: done, pending, or overdue.
function previewDashChecklist(b) {
  const methodLabel = b.redeemMethod === "business_confirm" ? "you confirmed the visit in the app (no code needed)" : "staff scanned the code at the counter";
  const items = [
    {
      key: "redeem",
      label: "Visit redeemed in the app (code burned, 48 hour clock started)",
      state: b.redeemedAt ? "done" : "pending",
      detail: b.redeemedAt
        ? `${previewFmtDate(b.redeemedAt)} · ${methodLabel}`
        : `Code ${b.code} · redeem by ${previewFmtDate(b.redeemBy)} · the creator can come any time in the window, no appointment`,
    },
    {
      key: "post",
      label: "1 post or reel within 48 hours of the visit",
      state: b.post ? "done" : b.state === "overdue" || b.state === "paused" ? "overdue" : "pending",
      detail: b.post
        ? `Posted ${previewFmtDate(b.post.submittedAt)} · ${b.post.hoursAfterRedeem}h after redemption · ${b.post.onTime ? "on time" : "delivered late"}`
        : b.redeemedAt
          ? `Due by ${previewFmtDate(b.postDeadline)}`
          : "The clock starts at redemption",
    },
    {
      key: "stories",
      label: "2 stories from the visit",
      state: b.post ? "done" : "pending",
      detail: "Part of the Standard Visit, posted around the visit itself",
    },
    {
      key: "disclosure",
      label: "Comp disclosed in the post (FTC)",
      state: b.post ? "done" : "pending",
      detail: b.post ? "Disclosed, as every SIGNL post must be" : "Required on every post; a post without it does not check off",
    },
    {
      key: "live30",
      label: "Post stays live at least 30 days",
      state: b.post ? "done" : "pending",
      detail: b.post ? `Live since ${previewFmtDate(b.post.submittedAt)}, tracked from the proof link` : "Tracked from the proof link once the post lands",
    },
    {
      key: "numbers",
      label: "Post numbers reported (views, likes, comments, shares)",
      state: b.post && b.post.reportedAt ? "done" : "pending",
      detail: b.post && b.post.reportedAt
        ? `${Number(b.post.views || 0).toLocaleString("en-US")} views · ${Number(b.post.likes || 0).toLocaleString("en-US")} likes · ${Number(b.post.comments || 0).toLocaleString("en-US")} comments · ${Number(b.post.shares || 0).toLocaleString("en-US")} shares, reported by the creator`
        : "Asked automatically 7 days after the post; the numbers land here",
    },
  ];
  return items;
}

async function previewDashboard() {
  const now = Date.now();
  const plan = planById("growth") || PLANS[1];
  const users = await allUsers();
  const roster = users.filter((u) => isRosterCreator(u) && profileCompleteOf(u));
  const handleOf = (u) => ((u.creator && u.creator.handle) || "").toLowerCase();
  const nameOf = (u) => (u.name || "").toLowerCase();
  const featured = [
    roster.find((u) => handleOf(u).includes("elegance.by.emily")) || roster.find((u) => nameOf(u).includes("emily")),
    roster.find((u) => handleOf(u).includes("vibewithkesha")) || roster.find((u) => nameOf(u).includes("kesha")),
    roster.find((u) => handleOf(u).includes("minimony")) || roster.find((u) => nameOf(u).includes("moni")),
    roster.find((u) => handleOf(u).includes("ac32085")) || roster.find((u) => nameOf(u).includes("christopher")),
  ];
  // Slots in demo order; a missing featured creator falls back to the
  // roster in sign-up order, and a small roster simply covers more
  // than one slot, the way a real business books a favorite twice.
  const slotCreator = (i) => featured[i] || (roster.length ? roster[i % roster.length] : null);
  const briefs = [
    { slot: 0, kind: "booked", title: "Autumn tasting menu for two", whatComped: "Five-course tasting menu for the creator and a guest, with two cocktails", dollarCap: 110, covers: 2, visitWindow: "Evenings this week" },
    { slot: 1, kind: "redeemed", title: "Weekend brunch on us", whatComped: "Brunch for two: two entrees, two coffees, one shared pastry board", dollarCap: 65, covers: 2, compCost: 34, visitWindow: "Weekend mornings" },
    { slot: 2, kind: "complete_on_time", title: "Chef's counter dinner", whatComped: "Chef's counter seating for two, four courses", dollarCap: 90, covers: 2, compCost: 47, visitWindow: "Weeknights", redemptions: { count: 9, basketTotal: 486 } },
    { slot: 3, kind: "complete_late", title: "Cocktail hour feature", whatComped: "Two signature cocktails and three small plates for the creator and a guest", dollarCap: 70, covers: 2, compCost: 38, visitWindow: "Thursday to Saturday", redemptions: { count: 6, basketTotal: 318 } },
    { slot: 0, kind: "overdue", title: "Sunday supper club", whatComped: "Sunday supper for two: shared starter, two mains, dessert to share", dollarCap: 80, covers: 2, compCost: 41, visitWindow: "Sundays" },
  ];
  const usedCodes = new Set();
  const usedCreatorCodes = new Set();
  const bookings = [];
  for (let i = 0; i < briefs.length; i++) {
    const brief = briefs[i];
    const creator = slotCreator(brief.slot);
    if (!creator) continue;
    const code = await previewDisplayCode(usedCodes);
    const b = {
      id: `preview-dash-${i + 1}`,
      preview: true,
      businessId: "__preview__",
      businessName: PREVIEW_DASH_BUSINESS.name,
      market: PREVIEW_DASH_BUSINESS.market,
      creatorId: creator.id,
      creatorName: creator.name,
      creatorHandle: creator.creator ? creator.creator.handle : "",
      creatorTier: creator.creator ? normalizeTierBand(creator.creator.tierBand) : null,
      title: brief.title,
      whatComped: brief.whatComped,
      covers: brief.covers || 1,
      paidBrief: null,
      dollarCap: brief.dollarCap,
      compCostModeled: brief.compCost || null,
      // SIGNL ROAS simulation (Jeff, 2026-10-19): the audience
      // code this creator would share for Salt & Ember, the
      // discount it carries (Salt & Ember opted in at 20 percent;
      // see PREVIEW_DASH_DISCOUNT), the register tally the
      // business reported back (posted bookings only), and the
      // comp's cost basis at the business's own cost.
      creatorCode: previewCreatorCode(creator.creator ? creator.creator.handle : "", usedCreatorCodes),
      discountPct: PREVIEW_DASH_DISCOUNT.pct,
      redemptions: brief.redemptions ? { ...brief.redemptions, discountPct: PREVIEW_DASH_DISCOUNT.pct } : null,
      compCostActual: brief.compCost || null,
      visitWindow: brief.visitWindow,
      windowMode: "7days",
      code,
      codeStatus: "issued",
      status: "booked",
      state: "booked",
      stateLabel: "Booked · code issued",
      createdAt: null,
      redeemBy: null,
      checkinAt: null,
      redeemedAt: null,
      redeemMethod: null,
      postDeadline: null,
      pauseAt: null,
      post: null,
      review: null,
      alerts: [],
      checklist: [],
      qrSvg: null,
    };
    if (brief.kind === "booked") {
      b.createdAt = hoursFrom(now, -26);
      b.redeemBy = hoursFrom(now, -26 + COMPLIANCE.visitWindowDays * 24);
      b.qrSvg = previewQrSvg(code);
    } else if (brief.kind === "redeemed") {
      b.createdAt = hoursFrom(now, -49);
      b.redeemBy = hoursFrom(now, -49 + COMPLIANCE.visitWindowDays * 24);
      b.redeemedAt = hoursFrom(now, -5);
      b.redeemMethod = "counter_code";
      b.codeStatus = "burned";
      b.status = "redeemed";
      b.postDeadline = hoursFrom(now, -5 + COMPLIANCE.onTimeHours);
      b.state = "post_due";
      b.stateLabel = "Redeemed · post clock running";
      b.alerts = ["On track: the post is due inside the 48 hour window."];
    } else if (brief.kind === "complete_on_time" || brief.kind === "complete_late") {
      const onTime = brief.kind === "complete_on_time";
      const redeemedAgoH = onTime ? 9 * 24 : 12 * 24;
      const afterH = onTime ? 21 : 70;
      b.createdAt = hoursFrom(now, -(redeemedAgoH + 48));
      b.redeemBy = hoursFrom(now, -(redeemedAgoH + 48) + COMPLIANCE.visitWindowDays * 24);
      b.redeemedAt = hoursFrom(now, -redeemedAgoH);
      b.redeemMethod = onTime ? "counter_code" : "business_confirm";
      b.codeStatus = "burned";
      b.status = "completed";
      b.postDeadline = hoursFrom(now, -redeemedAgoH + COMPLIANCE.onTimeHours);
      b.post = {
        url: onTime ? "https://www.instagram.com/p/C8kQ2mPxT4a/" : "https://www.instagram.com/reel/C9rT7wKdN2s/",
        submittedAt: hoursFrom(now, -redeemedAgoH + afterH),
        onTime,
        hoursAfterRedeem: afterH,
        disclosedComp: true,
        views: onTime ? 12400 : 8150,
        likes: onTime ? 986 : 640,
        comments: onTime ? 74 : 52,
        shares: onTime ? 41 : 23,
        reportedAt: hoursFrom(now, -redeemedAgoH + afterH + PERFORMANCE_ASK_DAYS * 24),
      };
      b.review = onTime
        ? { stars: 5, text: "Posted right on time and the reel is still bringing people in.", createdAt: hoursFrom(now, -4 * 24) }
        : { stars: 4, text: "Great post, a couple of days past the 48 hours but worth it.", createdAt: hoursFrom(now, -3 * 24) };
      b.state = onTime ? "posted_on_time" : "posted_late";
      b.stateLabel = onTime ? "Posted on time · complete" : "Posted late · delivered, complete";
    } else if (brief.kind === "overdue") {
      b.createdAt = hoursFrom(now, -5 * 24);
      b.redeemBy = hoursFrom(now, -5 * 24 + COMPLIANCE.visitWindowDays * 24);
      b.redeemedAt = hoursFrom(now, -84);
      b.redeemMethod = "business_confirm";
      b.codeStatus = "burned";
      b.status = "redeemed";
      b.postDeadline = hoursFrom(now, -84 + COMPLIANCE.onTimeHours);
      b.pauseAt = hoursFrom(now, -84 + COMPLIANCE.hardStopDays * 24);
      b.state = "overdue";
      b.stateLabel = "Post overdue · in the late window";
      b.replacementAvailable = true;
      b.alerts = [
        `The 48 hour deadline passed ${Math.round((now - Date.parse(b.postDeadline)) / 3600000)} hours ago with no post link yet. Reminder emails went out automatically at the deadline.`,
        `The visit still counts if the post lands before the hard stop on ${previewFmtDate(b.pauseAt)}; after that the creator's account pauses until it does.`,
        "In the live app, this is where you can request a replacement visit. Nothing about the creator's standing is ever shown publicly.",
      ];
    }
    b.checklist = previewDashChecklist(b);
    bookings.push(b);
  }
  const delivered = bookings.filter((b) => b.post);
  const onTimeCount = delivered.filter((b) => b.post.onTime).length;
  const totalViews = delivered.reduce((s, b) => s + (b.post.views || 0), 0);
  const totalLikes = delivered.reduce((s, b) => s + (b.post.likes || 0), 0);
  const compValueGiven = bookings.reduce((s, b) => s + (b.redeemedAt ? b.compCostModeled || 0 : 0), 0);
  // SIGNL ROAS (Jeff, 2026-10-19): the returns story is the
  // score now, computed by the one helper over the delivered
  // bookings: register spend tracked through each creator's
  // audience code plus media value at the published model rates,
  // against the comps' cost and the code discounts, with the
  // Growth plan allocation ($599 / 20 visits = $29.95 a visit)
  // in the all-in variant. Each delivered booking also carries
  // its own score for its card.
  const planAllocation = plan.priceMonthly / plan.visitsPerMonth;
  for (const b of delivered) b.roas = roasFor([{ ...b, planAllocation }]);
  const roas = roasFor(delivered.map((b) => ({ ...b, planAllocation })));
  const summary = {
    cycleLabel: new Date(now).toLocaleString("en-US", { month: "long", year: "numeric" }),
    visitsUsed: bookings.length,
    visitsAllowance: plan.visitsPerMonth,
    visitsRemaining: Math.max(0, plan.visitsPerMonth - bookings.length),
    postsDelivered: delivered.length,
    postsOnTime: onTimeCount,
    postsLate: delivered.length - onTimeCount,
    onTimeRatePct: delivered.length ? Math.round((onTimeCount / delivered.length) * 100) : null,
    postsInFlight: bookings.filter((b) => b.state === "post_due").length,
    postsOverdue: bookings.filter((b) => b.state === "overdue").length,
    totalViews,
    totalLikes,
    compValueGiven,
    compValueBasis: "Modeled at the business's own cost for the comps actually given, not menu price",
    roas,
    modeled: true,
  };
  // Managed talent budget view (Jeff, 2026-10-19): a SECOND
  // simulated business on the Managed plan, so Salt & Ember's
  // Growth dashboard above stays exactly as it was. (Choice
  // documented in the README runbook.) The Managed business
  // carries the suggested $500 monthly talent budget; its
  // coordinator has spent part of it this cycle on two paid
  // bookings over the real roster, at illustrative rates run
  // through the real paidMath fee split. Spent is the sum of those
  // bookings' business totals for the cycle; remaining is budget
  // minus spent. Simulated like everything in preview: computed
  // per request, zero writes, no creator contacted.
  const managedPlan = planById("managed") || PLANS[2];
  const managedPaid = [];
  const paidSlots = [
    { slot: 2, rate: 250, escrowState: "released", escrowNote: "Post live and the 48 hour hold passed: released to the creator" },
    { slot: 1, rate: 180, escrowState: "held", escrowNote: "Post live, inside the 48 hour hold: still held by SIGNL" },
  ];
  for (let i = 0; i < paidSlots.length; i++) {
    const creator = slotCreator(paidSlots[i].slot);
    if (!creator) continue;
    const math = paidMath(paidSlots[i].rate);
    managedPaid.push({
      id: `preview-paid-${i + 1}`,
      preview: true,
      creatorId: creator.id,
      creatorName: creator.name,
      creatorHandle: creator.creator ? creator.creator.handle : "",
      rate: math.rate,
      businessTotal: math.businessTotal,
      creatorNet: math.creatorNet,
      platformFee: math.platformFee,
      escrowState: paidSlots[i].escrowState,
      escrowNote: paidSlots[i].escrowNote,
      paymentNote: PAID_LANE.paymentNote,
    });
  }
  const managedSpent = Math.round(managedPaid.reduce((s, x) => s + x.businessTotal, 0) * 100) / 100;
  const managedView = {
    business: { name: "Harbor Table (Managed plan example)", category: "Seafood restaurant", market: PREVIEW_DASH_BUSINESS.market },
    // The contrast case: Harbor Table has NOT turned code
    // discounts on. Its creator codes would still be issued and
    // tallied; they would carry no discount.
    discountCodes: { enabled: false, pct: null },
    plan: { id: managedPlan.id, name: managedPlan.name, priceMonthly: managedPlan.priceMonthly, minMonths: managedPlan.minMonths, visitsPerMonth: managedPlan.visitsPerMonth },
    budget: {
      monthlyTalentBudget: MANAGED_TALENT_BUDGET_DEFAULT,
      spentThisMonth: managedSpent,
      remaining: Math.round((MANAGED_TALENT_BUDGET_DEFAULT - managedSpent) * 100) / 100,
      paidBookings: managedPaid,
      note: "A spending cap and authorization, not a held deposit: each paid booking escrows on its own, held by SIGNL until the post is live.",
    },
  };
  // Business Home (dashboard concept merge, Jeff 2026-10-20): the
  // first screen a business opens, computed from the same simulated
  // bookings as everything else on this dashboard: the headline
  // metrics, the attention list, the visit pipeline as cumulative
  // stage reach (each stage counts the bookings that reached it),
  // plan pace, the content that is working (ranked by the register
  // tallies, the tracked action, never vanity counts alone), and
  // the next visits by nearest deadline. Pure computation over the
  // in-memory simulation: zero writes, like everything in preview.
  const homeAttention = [];
  for (const b of bookings) {
    if (b.state === "overdue") {
      homeAttention.push({ kind: "overdue", bookingId: b.id, label: "A post is past its deadline", detail: `${b.title} with @${b.creatorHandle}: the 48 hour deadline passed and no post link is in yet. The hard stop is ${previewFmtDate(b.pauseAt)}.` });
    }
  }
  for (const b of bookings) {
    if (b.state === "post_due") {
      homeAttention.push({ kind: "clock", bookingId: b.id, label: "A post clock is running", detail: `${b.title} with @${b.creatorHandle}: the visit is redeemed and the post is due by ${previewFmtDate(b.postDeadline)}.` });
    }
  }
  for (const b of bookings) {
    if (b.post && !b.redemptions) {
      homeAttention.push({ kind: "tally", bookingId: b.id, label: "A register tally is still unreported", detail: `${b.title} with @${b.creatorHandle}: the post is live, and reporting the code tally on the visit card below completes its SIGNL ROAS Score.` });
    }
  }
  for (const b of bookings) {
    if (b.state === "booked" && b.redeemBy && Date.parse(b.redeemBy) - now < 48 * 3600 * 1000) {
      homeAttention.push({ kind: "window", bookingId: b.id, label: "A visit window closes soon", detail: `${b.title} with @${b.creatorHandle}: the redemption window closes ${previewFmtDate(b.redeemBy)}.` });
    }
  }
  const homeTopContent = delivered
    .slice()
    .sort((a, b) => ((b.redemptions ? b.redemptions.count : 0) - (a.redemptions ? a.redemptions.count : 0)) || ((b.post.views || 0) - (a.post.views || 0)))
    .slice(0, 3)
    .map((b) => ({
      bookingId: b.id,
      title: b.title,
      creatorName: b.creatorName,
      creatorHandle: b.creatorHandle,
      postUrl: b.post.url,
      views: b.post.views || 0,
      likes: b.post.likes || 0,
      onTime: !!b.post.onTime,
      redemptions: b.redemptions ? { count: b.redemptions.count, basketTotal: b.redemptions.basketTotal } : null,
      roasScore: b.roas ? b.roas.score : null,
    }));
  const nextDeadlineOf = (b) => (b.state === "booked" ? b.redeemBy : b.state === "overdue" ? b.pauseAt : b.postDeadline);
  const homeNextVisits = bookings
    .filter((b) => !b.post)
    .map((b) => ({ bookingId: b.id, title: b.title, creatorName: b.creatorName, creatorHandle: b.creatorHandle, state: b.state, stateLabel: b.stateLabel, when: nextDeadlineOf(b), whenLabel: b.state === "booked" ? "Redeem by" : b.state === "overdue" ? "Hard stop" : "Post due" }))
    .sort((a, b) => (String(a.when || "") < String(b.when || "") ? -1 : 1));
  const home = {
    visitsUsed: summary.visitsUsed,
    visitsAllowance: summary.visitsAllowance,
    visitsRemaining: summary.visitsRemaining,
    postsLive: summary.postsDelivered,
    onTimeRatePct: summary.onTimeRatePct,
    roasScore: summary.roas ? summary.roas.score : null,
    roasAllInScore: summary.roas ? summary.roas.allInScore : null,
    attention: homeAttention,
    pipeline: {
      invited: bookings.length,
      claimed: bookings.filter((b) => !!b.code).length,
      visitSet: bookings.filter((b) => !!b.redeemBy).length,
      clockRunning: bookings.filter((b) => !!b.redeemedAt).length,
      live: delivered.length,
    },
    planPacePct: summary.visitsAllowance ? Math.round((summary.visitsUsed / summary.visitsAllowance) * 100) : 0,
    topContent: homeTopContent,
    nextVisits: homeNextVisits,
  };
  // Staff redemption demo (refinement bundle, 2026-10-20): Jeff
  // presents with the Preview example accounts and needs to run
  // the PIN login himself in front of a business. The demo is a
  // pure function of this payload: a fixed sample staff code for
  // the simulated business, a known demo PIN, and the one sample
  // booking still in its booked state as the redeemable visit.
  // The client runs the whole staff flow against these values in
  // memory. Nothing here reads or writes a real staff record: no
  // staffpin, staffcfg, staffsession, or booking record is ever
  // touched, which the verify suite asserts byte-for-byte.
  const staffDemoBooked = bookings.find((b) => b.state === "booked") || null;
  const staffDemo = {
    businessName: PREVIEW_DASH_BUSINESS.name,
    staffCode: PREVIEW_STAFF_DEMO.staffCode,
    registerPath: `/redeem/${PREVIEW_STAFF_DEMO.staffCode}`,
    demoPin: PREVIEW_STAFF_DEMO.pin,
    redeemCode: staffDemoBooked ? staffDemoBooked.code : null,
    redeemVisit: staffDemoBooked
      ? { creatorName: staffDemoBooked.creatorName, creatorHandle: staffDemoBooked.creatorHandle, title: staffDemoBooked.title, whatComped: staffDemoBooked.whatComped, covers: staffDemoBooked.covers, dollarCap: staffDemoBooked.dollarCap, redeemBy: staffDemoBooked.redeemBy, visitWindow: staffDemoBooked.visitWindow }
      : null,
    burnedExample: (() => { const burned = bookings.find((b) => b.codeStatus === "burned"); return burned ? { code: burned.code, title: burned.title } : null; })(),
  };
  return {
    preview: true,
    business: { ...PREVIEW_DASH_BUSINESS, planId: plan.id, planName: plan.name, discountCodes: { ...PREVIEW_DASH_DISCOUNT } },
    plan: { id: plan.id, name: plan.name, priceMonthly: plan.priceMonthly, minMonths: plan.minMonths, visitsPerMonth: plan.visitsPerMonth, features: plan.features },
    rights: visitRightsForPlan(plan.id),
    standardVisit: STANDARD_VISIT,
    summary,
    bookings,
    staffDemo,
    managedView,
    home,
    rosterEmpty: bookings.length === 0,
  };
}

// ---------- Business Home (real data) ----------
// The Preview Business Home (above) becomes the real business
// home: the same computations, fed by the business's real
// bookings, offers, and applications. Pure read: zero writes.
// The metric definitions match the preview exactly (visits used
// this cycle against the plan allowance, posts live, on-time
// rate, ROAS from sums via roasFor, pipeline as cumulative stage
// reach, top content ranked by register tallies then views), so
// the sample a business saw before sign-up and the home they get
// after can never tell two different stories.
async function businessHome(user) {
  const now = Date.now();
  const plan = planById(user.business.plan) || PLANS[0];
  const bookings = (await allBookings()).filter((b) => b.businessId === user.id);
  const posts = await allPosts();
  const postByBooking = new Map(posts.map((p) => [p.bookingId, p]));
  const offers = (await allOffers()).filter((o) => o.businessId === user.id);
  const apps = (await allApplications()).filter((a) => a.businessId === user.id);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthBookings = bookings.filter((b) => Date.parse(b.createdAt) >= monthStart.getTime());
  const delivered = bookings.filter((b) => postByBooking.has(b.id));
  const onTime = delivered.filter((b) => postByBooking.get(b.id).onTime);
  const planAllocation = plan.priceMonthly / plan.visitsPerMonth;
  const roas = roasFor(delivered.map((b) => ({ ...b, planAllocation })));
  const totalViews = delivered.reduce((s, b) => s + (Number(postByBooking.get(b.id).views) || 0), 0);

  const attention = [];
  for (const b of bookings) {
    const post = postByBooking.get(b.id);
    if (b.redeemedAt && !post && b.postDeadline && now > Date.parse(b.postDeadline) && b.status !== "completed") {
      attention.push({ kind: "overdue", bookingId: b.id, label: "A post is past its deadline", detail: `${b.title} with @${b.creatorHandle}: the 48 hour deadline passed and no post link is in yet.` });
    } else if (b.redeemedAt && !post) {
      attention.push({ kind: "clock", bookingId: b.id, label: "A post clock is running", detail: `${b.title} with @${b.creatorHandle}: redeemed, post due by ${previewFmtDate(b.postDeadline)}.` });
    }
    if (post && !b.redemptions) {
      attention.push({ kind: "tally", bookingId: b.id, label: "A register tally is still unreported", detail: `${b.title} with @${b.creatorHandle}: the post is live; reporting the code tally on the visit completes its SIGNL ROAS Score.` });
    }
    if (!b.redeemedAt && b.status === "booked" && b.redeemBy && Date.parse(b.redeemBy) - now < 48 * 3600 * 1000 && Date.parse(b.redeemBy) > now) {
      attention.push({ kind: "window", bookingId: b.id, label: "A visit window closes soon", detail: `${b.title} with @${b.creatorHandle}: the redemption window closes ${previewFmtDate(b.redeemBy)}.` });
    }
  }
  for (const o of offers) {
    if (laneOf(o) !== "open") continue;
    const mine = apps.filter((a) => a.offerId === o.id);
    const waiting = mine.filter((a) => a.status === "applied" || a.status === "backfill_offered");
    if ((o.status === "open" || o.status === "filled") && waiting.length) {
      attention.push({ kind: "applications", offerId: o.id, label: `${waiting.length} creator${waiting.length === 1 ? "" : "s"} waiting on "${o.title}"`, detail: `Selection deadline: ${previewFmtDate(o.selectionDeadline)}. Pick from the stack under My Offers before it passes and applications release automatically.` });
    }
    if (o.nudgeSentAt && o.status === "open" && mine.length === 0) {
      attention.push({ kind: "offer_nudge", offerId: o.id, label: `"${o.title}" has no applications yet`, detail: "Two one-tap fixes usually move it: raise the comp, or widen the window. Both are on the offer card under My Offers.", fixes: ["raise_comp", "widen_window"] });
    }
    if (o.status === "draft") {
      attention.push({ kind: "draft", offerId: o.id, label: `"${o.title}" is a draft`, detail: "Drafts are saved and ready. Offers publish when your market opens." });
    }
  }

  const topContent = delivered
    .slice()
    .sort((a, b) => ((b.redemptions ? b.redemptions.count : 0) - (a.redemptions ? a.redemptions.count : 0)) || ((Number(postByBooking.get(b.id).views) || 0) - (Number(postByBooking.get(a.id).views) || 0)))
    .slice(0, 3)
    .map((b) => {
      const post = postByBooking.get(b.id);
      return { bookingId: b.id, title: b.title, creatorName: b.creatorName, creatorHandle: b.creatorHandle, postUrl: post.url, views: post.views || 0, likes: post.likes || 0, onTime: !!post.onTime, redemptions: b.redemptions ? { count: b.redemptions.count, basketTotal: b.redemptions.basketTotal } : null, roasScore: roasFor([{ ...b, planAllocation }]).score };
    });
  const nextVisits = bookings
    .filter((b) => !postByBooking.has(b.id) && b.status === "booked")
    .map((b) => ({ bookingId: b.id, title: b.title, creatorName: b.creatorName, creatorHandle: b.creatorHandle, state: b.redeemedAt ? "post_due" : "booked", stateLabel: b.redeemedAt ? "Redeemed, post clock running" : "Booked, code issued", when: b.redeemedAt ? b.postDeadline : b.redeemBy, whenLabel: b.redeemedAt ? "Post due" : "Redeem by" }))
    .sort((a, b) => (String(a.when || "") < String(b.when || "") ? -1 : 1));

  // Rebook prompts: creators with a delivered visit first (proof
  // beats promise), favorites ahead of the rest inside each group.
  const favRows = await store.list(`favorite:${user.id}:`);
  const favIds = new Set(favRows.map((r) => r.key.split(":")[2]));
  const deliveredCreators = new Map();
  for (const b of delivered) {
    if (!deliveredCreators.has(b.creatorId)) deliveredCreators.set(b.creatorId, b);
  }
  const rebookPrompts = [];
  for (const [creatorId, b] of deliveredCreators) {
    const c = await store.get(`user:${creatorId}`);
    if (!c) continue;
    rebookPrompts.push({ creatorId, name: c.name, handle: c.creator ? c.creator.handle : b.creatorHandle, isFavorite: favIds.has(creatorId), source: "delivered", lastTitle: b.title, lastWhatComped: b.whatComped, lastDollarCap: b.dollarCap });
  }
  for (const creatorId of favIds) {
    if (deliveredCreators.has(creatorId)) continue;
    const c = await store.get(`user:${creatorId}`);
    if (!c || c.role !== "creator") continue;
    rebookPrompts.push({ creatorId, name: c.name, handle: c.creator ? c.creator.handle : "", isFavorite: true, source: "favorite", lastTitle: null, lastWhatComped: null, lastDollarCap: null });
  }
  rebookPrompts.sort((a, b) => (Number(b.isFavorite) - Number(a.isFavorite)) || (a.source === b.source ? 0 : a.source === "delivered" ? -1 : 1));

  return {
    business: { name: user.business.businessName, category: user.business.category, market: user.market, planId: plan.id, planName: user.business.planName, billingStatus: user.business.billingStatus, accessState: businessAccessState(user) },
    plan: { id: plan.id, name: plan.name, priceMonthly: plan.priceMonthly, minMonths: plan.minMonths, visitsPerMonth: plan.visitsPerMonth },
    marketLive: await isMarketLive(user.market),
    home: {
      visitsUsed: monthBookings.length,
      visitsAllowance: plan.visitsPerMonth,
      visitsRemaining: Math.max(0, plan.visitsPerMonth - monthBookings.length),
      postsLive: delivered.length,
      onTimeRatePct: delivered.length ? Math.round((onTime.length / delivered.length) * 100) : null,
      roasScore: roas.score,
      roasAllInScore: roas.allInScore,
      totalViews,
      attention,
      pipeline: {
        invited: bookings.length,
        claimed: bookings.filter((b) => !!b.code).length,
        visitSet: bookings.filter((b) => !!b.redeemBy).length,
        clockRunning: bookings.filter((b) => !!b.redeemedAt).length,
        live: delivered.length,
      },
      planPacePct: plan.visitsPerMonth ? Math.round((monthBookings.length / plan.visitsPerMonth) * 100) : 0,
      topContent,
      nextVisits,
    },
    rebookPrompts,
    favoritesCount: favIds.size,
    openOffers: offers.filter((o) => laneOf(o) === "open" && (o.status === "open" || o.status === "filled")).length,
    draftOffers: offers.filter((o) => o.status === "draft").length,
    // Staff redemption (Jeff, 2026-10-20 late): the home prompts
    // an activated owner with no staff PIN to set one, so the
    // register is never stuck waiting on the owner's login.
    staffPinSet: !!(await staffPinRecord(user.id)),
  };
}

// ---------- auth context ----------

async function getAuthUser(event) {
  const cookies = auth.parseCookies(event.headers.cookie || event.headers.Cookie || "");
  const token = cookies.signl_session;
  if (!token) return { user: null, token: null };
  const user = await auth.getSessionUser(token);
  return { user, token };
}

function requireApproved(user) {
  return user && user.status === "approved";
}

// ---------- route handlers ----------

async function handleRegister(event) {
  const b = parseBody(event);
  const role = b.role;
  if (role !== "creator" && role !== "business") return err(400, "role must be creator or business");
  // Two-step claim (Jeff, 2026-10-20): a creator may claim their
  // founding spot with only a handle, a market, an email, a
  // password, and the rule checkboxes. The full profile is step
  // two, finished after approval from the dashboard checklist.
  // quickClaim is creators only; businesses always register with
  // the full form. The agreement checks are the same four the full
  // form enforces, with the same words.
  const quickClaim = role === "creator" && b.quickClaim === true;
  const claimHandle = quickClaim && typeof b.handle === "string" ? b.handle.replace(/^@/, "").trim() : "";
  if (quickClaim) {
    if (!claimHandle) return err(400, "Your Instagram handle is required");
    if (b.agreedHonestPosts !== true) return err(400, "Please confirm the honest-post rule: no business can ever require a positive post.");
    if (b.agreedFtcDisclosure !== true) return err(400, "Please confirm you will disclose every comp in your posts, as the FTC requires.");
    if (b.agreedPostCompliance !== true) return err(400, "Please confirm the post rule: post within 48 hours of a comped visit for full credit and paste the post link in the app. One week is the hard stop: a redeemed visit with no post pauses your account at one week and closes it at two.");
    if (b.agreedTerms !== true) return err(400, "Please agree to the Terms of Service and Privacy Policy, and to receiving account and marketing emails from SIGNL.");
  }
  // Business registration is founding-list intake (Jeff restored
  // the standing launch shape, 2026-10-20): a business registers
  // with the full form, is reviewed like any application, and
  // lands on a Founding Status page only. Approval does NOT open
  // the product: the business stays in founding access state until
  // an admin activates it by hand (the concierge founding cohort,
  // a partner's first sales). Billing stays founding-honest: the
  // plan is recorded in-app, no card is charged, and payment stays
  // concierge, hand-sent by Jeff at activation.
  if (!isEmail(b.email || "")) return err(400, "A valid email is required");
  if (typeof b.password !== "string" || b.password.length < 10) return err(400, "Password must be at least 10 characters");
  if (!quickClaim && (!b.name || typeof b.name !== "string")) return err(400, "Name is required");
  const unlisted = b.market === UNLISTED;
  if (unlisted && role !== "creator") return err(400, "Business accounts are tied to a SIGNL market. Pick your market from the list; if your city is not there yet, join as a creator-market signal on joinsignl.com and we will open business accounts when the market launches.");
  const market = unlisted ? { name: UNLISTED, cities: [] } : marketByName(b.market || "");
  if (!market) return err(400, "Choose one of the SIGNL markets");
  let customCity = "";
  let customCountry = "";
  let customState = "";
  if (unlisted) {
    customCity = (b.customCity || "").trim().slice(0, 60);
    customCountry = (b.customCountry || "").trim().slice(0, 60);
    customState = (b.customState || "").trim().slice(0, 60);
    if (!customCity) return err(400, "Tell us your city, so your sign-up counts toward opening SIGNL there");
    if (!customCountry) return err(400, "Tell us your country, so your sign-up counts toward opening SIGNL there");
    if (customState.length === 2) customState = customState.toUpperCase();
  }

  const email = b.email.toLowerCase();
  const existing = await store.get(`email:${email}`);
  if (existing) return err(409, "An account with this email already exists");

  const { salt, hash } = auth.hashPassword(b.password);
  const id = crypto.randomUUID();
  const ts = nowIso();
  const user = {
    id,
    role,
    email,
    // A quick claim carries no name: the handle stands in until
    // the creator sets their real name in the completion flow.
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : claimHandle,
    passwordSalt: salt,
    passwordHash: hash,
    status: "pending",
    tester: false,
    market: market.name,
    city: unlisted ? customCity : (b.city || "").trim(),
    state: unlisted ? customState || null : null,
    country: unlisted ? customCountry : market.country || "United States",
    createdAt: ts,
    updatedAt: ts,
    reviewedAt: null,
    reviewedBy: null,
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: ts,
    marketingEmailConsent: true,
    marketingConsentAt: ts,
    creator: null,
    business: null,
  };

  // Creator referral credit (Jeff, 2026-10-18): a sign-up that arrived
  // through another creator's invite link (?ref=<handle>) is credited
  // to that handle. Sanitized to a short handle-shaped string.
  const referredBy = typeof b.referredBy === "string" ? b.referredBy.trim().replace(/^@/, "").slice(0, 40) : "";
  if (referredBy) user.referredBy = referredBy;

  // Signup source (Jeff, 2026-10-21): our own segment and channel
  // pages tag their claim links with ?src= (moms, students, dads,
  // foodies, linkedin, learn, market pages). The client persists it
  // like the referral credit and sends it at registration; here it
  // is sanitized to a short slug (lowercase, alphanumeric, dash,
  // underscore, 40 chars) and stored on the record as signupSource,
  // so admin can see which page produced each applicant. Absent or
  // unusable values store nothing.
  const signupSource = typeof b.signupSource === "string" ? b.signupSource.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) : "";
  if (signupSource) user.signupSource = signupSource;

  if (role === "creator" && quickClaim) {
    // Step one of the two-step claim: the record carries the
    // handle, the four agreements, and defaults for everything
    // else. The gate fields (home city, audience counts,
    // categories, local audience %) stay empty on purpose, so
    // profileComplete computes false until the creator finishes
    // step two after approval. City for a listed market is a
    // completion step; an unlisted claim already carries its
    // typed city on the user record from the market block above.
    user.creator = {
      handle: claimHandle,
      instagramUrl: `https://instagram.com/${claimHandle}`,
      tiktokHandle: null,
      tiktokUrl: null,
      youtubeChannel: null,
      facebookUrl: null,
      xHandle: null,
      xUrl: null,
      linkedinUrl: null,
      followerCount: 0,
      audienceStack: {},
      totalAudience: 0,
      avgViews: 0,
      tierBand: tierForFollowers(0),
      suggestedTier: tierForFollowers(0),
      computedTier: tierForFollowers(0),
      categories: [],
      compCategories: [],
      openToPaidCampaigns: false,
      compOpen: true,
      paidRate: null,
      bio: "",
      bestWork: [],
      maxVisitsPerWeek: 3,
      neighborhood: "",
      university: normalizeUniversity(b.university),
      topAudienceCities: [],
      localAudiencePct: null,
      localAudienceSource: null,
      localAudienceAsOf: null,
      agreedHonestPosts: true,
      agreedFtcDisclosure: true,
      agreedPostCompliance: true,
      agreedAt: ts,
      agreedTerms: true,
      termsVersion: TERMS_VERSION,
      marketingEmailConsent: true,
      marketingConsentAt: ts,
      hasPhoto: false,
      photoUploadedAt: null,
      igConnected: false,
    };
  } else if (role === "creator") {
    // The founding creator profile builder. Required: Instagram handle,
    // home city inside the chosen market, follower count, at least one
    // content category, self-reported local audience %, and both rule
    // acknowledgments (honest posts, FTC disclosure).
    const handle = (b.handle || "").replace(/^@/, "").trim();
    if (!handle) return err(400, "Your Instagram handle is required");
    const city = unlisted ? customCity : (b.city || "").trim();
    if (!unlisted && (!city || !market.cities.includes(city))) return err(400, `Choose your home city in the ${market.name} market`);
    if (b.followerCount === undefined || b.followerCount === null || b.followerCount === "") return err(400, "Your follower count is required");
    const followers = Math.max(0, parseInt(b.followerCount, 10) || 0);
    const categories = cleanStringList(b.categories, CREATOR_CATEGORIES, 8);
    if (!categories.length) return err(400, "Pick at least one category you create in");
    if (b.localAudiencePct === undefined || b.localAudiencePct === null || b.localAudiencePct === "") {
      return err(400, "Your self-reported local audience percentage is required. It is always labeled Self-reported on your profile.");
    }
    const localPct = Math.max(0, Math.min(100, Number(b.localAudiencePct)));
    if (Number.isNaN(localPct)) return err(400, "Local audience percentage must be a number from 0 to 100");
    if (b.agreedHonestPosts !== true) return err(400, "Please confirm the honest-post rule: no business can ever require a positive post.");
    if (b.agreedFtcDisclosure !== true) return err(400, "Please confirm you will disclose every comp in your posts, as the FTC requires.");
    if (b.agreedPostCompliance !== true) return err(400, "Please confirm the post rule: post within 48 hours of a comped visit for full credit and paste the post link in the app. One week is the hard stop: a redeemed visit with no post pauses your account at one week and closes it at two.");
    if (b.agreedTerms !== true) return err(400, "Please agree to the Terms of Service and Privacy Policy, and to receiving account and marketing emails from SIGNL.");
    // Audience stacking (Jeff, 2026-10-19): the sign-up's follower
    // count is the Instagram count; any other platform counts the
    // creator reports join the stack, and the tier reads the stacked
    // TOTAL. The band is FULLY AUTOMATIC (Jeff, 2026-10-19 01:46):
    // it is always tierForFollowers(totalAudience). A client-sent
    // tierBand (including the ?tier= claim-link prefill, which is
    // still accepted as a param) never sets the band; nobody picks
    // or confirms their own category.
    const stack = normalizeAudienceStack(b.audienceStack);
    let igFollowers = followers;
    if (stack.instagram) igFollowers = stack.instagram;
    else if (igFollowers > 0) stack.instagram = igFollowers;
    const totalAudience = Object.values(stack).reduce((s, n) => s + n, 0);
    const suggestedTier = tierForFollowers(totalAudience);
    const tier = suggestedTier;
    const tiktok = (b.tiktokHandle || "").replace(/^@/, "").trim();
    const youtube = (b.youtubeChannel || "").trim();
    const socials = normalizeSocials(b);
    user.city = city;
    user.creator = {
      handle,
      instagramUrl: `https://instagram.com/${handle}`,
      tiktokHandle: tiktok || null,
      tiktokUrl: tiktok ? `https://www.tiktok.com/@${tiktok}` : null,
      youtubeChannel: youtube || null,
      facebookUrl: socials.facebookUrl,
      xHandle: socials.xHandle,
      xUrl: socials.xUrl,
      linkedinUrl: socials.linkedinUrl,
      followerCount: igFollowers,
      audienceStack: stack,
      totalAudience,
      avgViews: Math.max(0, parseInt(b.avgViews, 10) || 0),
      tierBand: tier,
      suggestedTier,
      computedTier: suggestedTier,
      categories,
      compCategories: (() => {
        const list = cleanStringList(b.compCategories, COMP_CATEGORIES, 8);
        // Paid cash campaigns are a Headliners-tier (15k+) option only.
        if (tier === "Headliners" && Array.isArray(b.compCategories) && b.compCategories.includes(PAID_COMP) && !list.includes(PAID_COMP)) list.push(PAID_COMP);
        return list;
      })(),
      openToPaidCampaigns: tier === "Headliners" && Array.isArray(b.compCategories) && b.compCategories.includes(PAID_COMP),
      // Paid lane (Jeff, 2026-10-19): every creator starts open to
      // comp visits (the default driver) with NO paid rate listed.
      // Both are hers to change in profile settings: compOpen false
      // means paid-only, paidRate (minimum $50) lists her for paid
      // bookings at that rate.
      compOpen: true,
      paidRate: null,
      bio: (b.bio || "").trim(),
      // Best work links (up to 3) are added in profile edit, not at
      // sign-up; the field exists from day one so every payload and
      // card can rely on it.
      bestWork: [],
      // Weekly visit cap (Jeff, 2026-10-19 r2): default 3, the
      // creator can set 1-7 in profile edit.
      maxVisitsPerWeek: 3,
      // Neighborhood / area inside the home city (Jeff, 2026-10-19:
      // businesses shop by neighborhood: Oceanfront, Ghent, Carytown).
      // Optional free text; never required, never validated against a
      // list, because neighborhoods are local knowledge.
      neighborhood: typeof b.neighborhood === "string" ? b.neighborhood.trim().slice(0, 80) : "",
      university: normalizeUniversity(b.university),
      topAudienceCities: cleanStringList(b.topAudienceCities, null, 5),
      localAudiencePct: localPct,
      localAudienceSource: "Self-reported",
      localAudienceAsOf: ts.slice(0, 10),
      agreedHonestPosts: true,
      agreedFtcDisclosure: true,
      agreedPostCompliance: true,
      agreedAt: ts,
      agreedTerms: true,
      termsVersion: TERMS_VERSION,
      marketingEmailConsent: true,
      marketingConsentAt: ts,
      hasPhoto: false,
      photoUploadedAt: null,
      igConnected: false,
    };
  } else {
    if (b.agreedTerms !== true) return err(400, "Please agree to the Terms of Service and Privacy Policy, and to receiving account and marketing emails from SIGNL.");
    if (!b.businessName) return err(400, "Business name is required");
    const bizCity = (b.city || "").trim();
    if (bizCity && market.cities.length && !market.cities.includes(bizCity)) return err(400, `Choose your city in the ${market.name} market`);
    if (bizCity) user.city = bizCity;
    const plan = planById(b.planId || "self-service") || PLANS[0];
    user.business = {
      businessName: String(b.businessName).trim(),
      category: BUSINESS_CATEGORIES.includes(b.category) ? b.category : "Other",
      // Profile fields a creator sees when weighing an offer:
      // neighborhood/area and a short about, editable any time
      // from the profile settings.
      neighborhood: typeof b.neighborhood === "string" ? b.neighborhood.trim().slice(0, 80) : "",
      about: typeof b.about === "string" ? b.about.trim().slice(0, 600) : "",
      plan: plan.id,
      planName: `${plan.name} $${plan.priceMonthly}/mo`,
      planPriceMonthly: plan.priceMonthly,
      planMinMonths: plan.minMonths,
      billingStatus: "Founding billing: plan recorded, no card charged. Billing starts at launch.",
      planSelectedAt: ts,
      // Founding-list access state: no product access until an
      // admin activates this business by hand. No payment link is
      // stored or shown; payment is concierge at activation.
      accessState: "founding",
      activatedAt: null,
      activatedBy: null,
      // Public review-page links (Google, Yelp, TripAdvisor,
      // Facebook): empty at sign-up, set from the Plan tab or by an
      // admin; host-validated at write time (validateReviewLinks).
      reviewLinks: {},
      // Audience-code discounts: OFF at sign-up, always. The
      // business may turn them on and pick a percentage (5..50)
      // from the Plan tab or via an admin; bookings stamp 0 until
      // they do. The creator code is still issued for counting.
      discountEnabled: false,
      discountPct: null,
      // Managed talent budget: every business record carries the
      // field; it only spends on the Managed plan. Not a deposit.
      monthlyTalentBudget: MANAGED_TALENT_BUDGET_DEFAULT,
    };
  }

  if (role === "creator") {
    // Mirror the campus field at the user-record level as well as
    // on the creator profile: signup, admin, and referral cohort
    // reads can then find the same canonical school in either
    // place, and profile edit keeps the two in sync.
    user.university = normalizeUniversity(user.creator.university);
    user.creator.university = user.university;
    // The stored completeness flag, computed from the record by
    // the same rule the roster gates read: a full-form
    // registration lands complete, a quick claim lands incomplete.
    const completeNow = profileCompleteOf(user);
    user.creator.profileComplete = completeNow;
    user.creator.profileCompletedAt = completeNow ? ts : null;
    user.creator.signupPath = quickClaim ? "quick_claim" : "full";
  }

  await store.set(`user:${id}`, user);
  await store.set(`email:${email}`, { userId: id });
  await logEvent({
    type: "application_submitted",
    actorId: id,
    actorRole: role,
    subjectId: id,
    market: user.market,
    data:
      role === "creator"
        ? { quickClaim: !!quickClaim, profileComplete: user.creator.profileComplete === true, handle: user.creator.handle, city: user.city, neighborhood: user.creator.neighborhood, university: user.creator.university, state: user.state, country: user.country, unlisted: user.market === UNLISTED, followerCount: user.creator.followerCount, audienceStack: user.creator.audienceStack, totalAudience: user.creator.totalAudience, tierBand: normalizeTierBand(user.creator.tierBand), suggestedTier: normalizeTierBand(user.creator.suggestedTier), localAudiencePct: user.creator.localAudiencePct, localAudienceSource: user.creator.localAudienceSource, categories: user.creator.categories, compCategories: user.creator.compCategories, openToPaidCampaigns: user.creator.openToPaidCampaigns, agreedPostCompliance: true, termsVersion: TERMS_VERSION, marketingEmailConsent: true, ...(user.referredBy ? { referredBy: user.referredBy } : {}), ...(user.signupSource ? { signupSource: user.signupSource } : {}) }
        : { businessName: user.business.businessName, category: user.business.category, plan: user.business.plan, planPriceMonthly: user.business.planPriceMonthly, ...(user.referredBy ? { referredBy: user.referredBy } : {}), ...(user.signupSource ? { signupSource: user.signupSource } : {}) },
  });
  if (role === "creator" && !quickClaim) {
    // A full-form registration IS the complete profile build: the
    // profile fields are all collected up front, so this fires
    // here. A quick claim fires NO profile_completed event: the
    // profile is finished later, and that flip is logged by the
    // profile save when it lands. A photo can still be added
    // afterwards (profile_photo_uploaded).
    await logEvent({
      type: "profile_completed",
      actorId: id,
      actorRole: "creator",
      subjectId: id,
      market: user.market,
      data: {
        handle: user.creator.handle,
        city: user.city,
        neighborhood: user.creator.neighborhood,
        university: user.creator.university,
        followerCount: user.creator.followerCount,
        audienceStack: user.creator.audienceStack,
        totalAudience: user.creator.totalAudience,
        avgViews: user.creator.avgViews,
        tierBand: normalizeTierBand(user.creator.tierBand),
        localAudiencePct: user.creator.localAudiencePct,
        localAudienceSource: user.creator.localAudienceSource,
        categories: user.creator.categories,
        compCategories: user.creator.compCategories,
        topAudienceCities: user.creator.topAudienceCities,
        hasTiktok: !!user.creator.tiktokHandle,
        hasYoutube: !!user.creator.youtubeChannel,
        facebookUrl: user.creator.facebookUrl,
        xHandle: user.creator.xHandle,
        xUrl: user.creator.xUrl,
        linkedinUrl: user.creator.linkedinUrl,
        hasPhoto: false,
        agreedHonestPosts: true,
        agreedFtcDisclosure: true,
        agreedPostCompliance: true,
        agreedTerms: true,
        termsVersion: TERMS_VERSION,
        marketingEmailConsent: true,
        openToPaidCampaigns: user.creator.openToPaidCampaigns,
      },
    });
  }
  if (role === "business") {
    await logEvent({
      type: "plan_selected",
      actorId: id,
      actorRole: "business",
      subjectId: id,
      market: user.market,
      data: { plan: user.business.plan, planPriceMonthly: user.business.planPriceMonthly, source: "registration", billingStatus: user.business.billingStatus },
    });
  }

  if (role === "creator") {
    // Sign-up confirmation email (Jeff, 2026-10-18). Queued as an event
    // always; sent immediately when the SMTP transport is configured.
    // Email trouble must never fail a registration, hence the try/catch.
    try {
      const summary = await foundingSummary(user);
      const band = foundingBand(summary && summary.queuePosition);
      const mail = quickClaim ? claimConfirmationEmail(user, band) : signupConfirmationEmail(user, band);
      await deliverEmail("signup_confirmation", user, mail.subject, mail.text, band);
    } catch (e) { /* email is best-effort; the queued events tell the story */ }
  }

  const token = await auth.createSession(id);
  const secure = (event.headers["x-forwarded-proto"] || "").includes("https");
  return json(201, { user: await withFounding(user) }, { "Set-Cookie": auth.sessionCookie(token, secure) });
}

const loginAttempts = new Map();
async function handleLogin(event) {
  const b = parseBody(event);
  const email = (b.email || "").toLowerCase();
  const ip = (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown").toString();
  const key = `${email}|${ip}`;
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (attempts.length >= 10) return err(429, "Too many sign-in attempts. Try again in a few minutes.");
  attempts.push(now);
  loginAttempts.set(key, attempts);

  const idx = await store.get(`email:${email}`);
  if (!idx) return err(401, "Email or password did not match");
  const user = await store.get(`user:${idx.userId}`);
  if (!user || !auth.verifyPassword(b.password || "", user.passwordSalt, user.passwordHash)) {
    return err(401, "Email or password did not match");
  }
  await logEvent({ type: "user_signed_in", actorId: user.id, actorRole: user.role, subjectId: user.id, market: user.market || null, data: {} });
  const token = await auth.createSession(user.id);
  const secure = (event.headers["x-forwarded-proto"] || "").includes("https");
  return json(200, { user: await withFounding(user) }, { "Set-Cookie": auth.sessionCookie(token, secure) });
}

async function handleLogout(event, ctx) {
  if (ctx.token) await auth.destroySession(ctx.token);
  const secure = (event.headers["x-forwarded-proto"] || "").includes("https");
  return json(200, { ok: true }, { "Set-Cookie": auth.clearCookie(secure) });
}

// ---------- main router ----------

async function route(event) {
  const method = event.httpMethod || "GET";
  let path = event.path || "/";
  const qIndex = path.indexOf("?");
  if (qIndex > -1) path = path.slice(0, qIndex);
  const apiIdx = path.indexOf("/api");
  if (apiIdx > -1) path = path.slice(apiIdx + 4);
  const seg = path.split("/").filter(Boolean);
  const query = event.queryStringParameters || {};

  await auth.ensureAdmin(logEvent);
  // One-time recruiter kit email: fires on the first request after
  // deploy, guarded by a claimed blob flag, and never repeats. It
  // must never break a request, hence the try/catch.
  try { await maybeSendRecruiterKit(); } catch (e) { /* kit email is best-effort */ }
  // One-time profileComplete backfill: recomputes the stored flag
  // for records written before the two-step claim shipped, guarded
  // by its own claimed flag, audit logged as an event.
  try { await maybeRunProfileBackfill(); } catch (e) { /* backfill is best-effort on the request path */ }
  // Profile completion reminders: same throttled opportunistic
  // pattern as the compliance sweep below.
  try { await maybeRunProfileReminderSweep(); } catch (e) { /* reminder sweep is best-effort on the request path */ }
  // Post-compliance sweep: drives the 48h reminders, the day-8 pause,
  // and the day-9 ban. Throttled to roughly hourly here (the Netlify
  // scheduled function and the admin endpoint are the explicit
  // triggers), and it must never break a request either.
  try { await maybeRunComplianceSweep(); } catch (e) { /* sweep is best-effort on the request path */ }
  // Offer lifecycle sweep: same opportunistic pattern (selection
  // SLA releases, backfill advancement, offer expiry, the 48 hour
  // coaching nudge).
  try { await maybeRunOfferSweep(); } catch (e) { /* sweep is best-effort on the request path */ }
  // Campaign sweep: same opportunistic pattern (Jeff fix, 2026-10-19).
  // The scheduled function alone never fired in production: the armed
  // founding-creator campaign sat at 0 sends for hours with no error
  // recorded anywhere. Running a throttled pass on ordinary API
  // traffic makes sending independent of Netlify's scheduler and of
  // the sweep token, exactly like compliance above.
  try { await maybeRunCampaignSweep(); } catch (e) { /* sweep is best-effort on the request path */ }
  const ctx = await getAuthUser(event);
  const user = ctx.user;

  // Public bootstrap: static config plus the launch state. Deliberately
  // contains NO creator or business data; the roster is never public.
  if (method === "GET" && seg.length === 1 && seg[0] === "bootstrap") {
    return json(200, {
      markets: MARKETS,
      tiers: TIERS,
      creatorCategories: CREATOR_CATEGORIES,
      compCategories: COMP_CATEGORIES,
      businessCategories: BUSINESS_CATEGORIES,
      universities: UNIVERSITY_OPTIONS,
      plans: PLANS,
      paidCampaignsComp: PAID_COMP,
      unlistedMarket: UNLISTED,
      standardVisit: STANDARD_VISIT,
      roasModel: { ...ROAS_MODEL, label: ROAS_LABEL },
      audiencePlatforms: AUDIENCE_PLATFORMS,
      termsVersion: TERMS_VERSION,
      email: { enabled: emailEnabled() },
      launch: {
        creatorSignupOpen: true,
        businessSignupOpen: true,
        launchWindow: LAUNCH_WINDOW_TEXT,
        marketLive: await marketLiveMap(),
      },
      // Offer composer guidance (offer flow v2): tier comp floors
      // and typical ranges, the paid floor, the selection SLA, and
      // the play templates, so the composer and the server enforce
      // the same numbers from one source.
      offerGuidance: {
        compGuidance: COMP_GUIDANCE,
        paidFloor: PAID_LANE.minRate,
        paidBusinessFeePct: PAID_LANE.businessFeePct,
        paidCreatorKeepPct: 100 - PAID_LANE.creatorFeePct,
        selectionSlaHours: SELECTION_SLA_HOURS,
        backfillAcceptHours: BACKFILL_ACCEPT_HOURS,
        applicationStackPerSpot: APPLICATION_STACK_PER_SPOT,
        templates: OFFER_TEMPLATES,
      },
    });
  }

  // Public creator profile: GET /api/c/<handle>. No sign-in required;
  // approved creators only, whitelist payload (see publicProfilePayload).
  if (method === "GET" && seg[0] === "c" && seg.length === 2) {
    const handleKey = sanitizePublicHandle(seg[1]);
    const target = handleKey
      ? (await allUsers())
          // A banned creator's page stops resolving, exactly like a
          // pending or rejected one: they are not bookable, so the
          // public page comes down until an admin reinstates them.
          .filter((u) => isRosterCreator(u) && profileCompleteOf(u) && standingState(u) !== "banned" && u.creator && String(u.creator.handle || "").toLowerCase() === handleKey)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0]
      : null;
    if (!target) return err(404, "Creator not found");
    return json(200, { profile: await publicProfilePayload(target) });
  }

  // Creator photo serving (Jeff, 2026-10-19). An APPROVED creator's
  // photo is part of their public profile - the /c/<handle> page shows
  // it - so it is served without sign-in for approved creators. Before
  // approval (or after rejection) the photo stays locked down: the
  // owner, the admin, or an approved business whose market is live.
  // This route deliberately sits BEFORE the sign-in wall below.
  if (method === "GET" && seg[0] === "users" && seg.length === 3 && seg[2] === "photo") {
    const target = await store.get(`user:${seg[1]}`);
    if (!target || target.role !== "creator") return err(404, "Photo not found");
    // Public while approved and in good/paused standing; a banned
    // creator's photo locks down with their profile page. A tester's
    // photo locks down the same way: their profile is not public.
    // An unfinished profile's photo locks down too: the /c/ page it
    // would illustrate does not resolve yet.
    let allowed = target.status === "approved" && !isTester(target) && profileCompleteOf(target) && standingState(target) !== "banned";
    if (!allowed && user) {
      allowed =
        user.id === target.id ||
        user.role === "admin" ||
        (user.role === "business" && user.status === "approved" && businessAccessState(user) === "active" && (await isMarketLive(user.market)));
    }
    if (!allowed) return err(user ? 403 : 401, user ? "That photo is not public" : "Sign in required");
    const photo = await store.get(`photo:${target.id}`);
    if (!photo) return err(404, "Photo not found");
    return {
      statusCode: 200,
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=300" },
      body: photo.dataBase64,
      isBase64Encoded: true,
    };
  }

  // Auth
  if (method === "POST" && seg[0] === "auth" && seg[1] === "register") return handleRegister(event);
  if (method === "POST" && seg[0] === "auth" && seg[1] === "login") return handleLogin(event);
  if (method === "POST" && seg[0] === "auth" && seg[1] === "logout") return handleLogout(event, ctx);
  if (method === "GET" && seg[0] === "auth" && seg[1] === "me") {
    if (!user) return err(401, "Not signed in");
    return json(200, { user: await withFounding(user) });
  }

  // Campaign sweep trigger. This route deliberately sits BEFORE the
  // sign-in wall below: the Netlify scheduled function
  // (netlify/functions/campaign-sweep.mjs) POSTs here every 30
  // minutes with no session, carrying the x-signl-sweep-token header
  // when SIGNL_SWEEP_TOKEN is set. Without a matching token, only an
  // admin session may trigger it. A `now` in the body is honored
  // ONLY in TEST_MODE (the verify suites time-travel the send window
  // with it); production always uses the real clock.
  if (method === "POST" && seg[0] === "admin" && seg[1] === "campaign" && seg[2] === "sweep") {
    const token = process.env.SIGNL_SWEEP_TOKEN;
    const tokenOk = !!token && (event.headers["x-signl-sweep-token"] || event.headers["X-Signl-Sweep-Token"]) === token;
    if (!tokenOk && (!user || user.role !== "admin")) return err(403, "Admin only");
    const b = parseBody(event);
    const opts = {};
    if (TEST_MODE && b.now) {
      const d = new Date(b.now);
      if (!Number.isNaN(d.getTime())) opts.now = d;
    }
    const summary = await runCampaignSweep(opts);
    return json(200, { ok: true, sweep: summary });
  }

  // ---------- staff redemption mode (Jeff, 2026-10-20 late) ----------
  // These routes sit BEFORE the sign-in wall on purpose: a staff
  // session is not a user account. Entry trades the business's
  // staff PIN for a scoped 12 hour token in its own cookie; the
  // lookup and redeem routes accept ONLY that token and only for
  // that one business. A staff token presented anywhere else in
  // the API resolves as "not signed in", because getSessionUser
  // never sees it: different cookie, different record namespace.
  // Staff mode works only for ACTIVATED businesses in LIVE
  // markets, the same ground the owner Counter tab stands on
  // (the founding gate plus the market gate): a founding or
  // pre-launch business has no visits to redeem.
  const staffCtx = await getStaffContext(event);
  const staffSecure = (event.headers["x-forwarded-proto"] || "").includes("https");

  if (method === "GET" && seg[0] === "staff" && seg[1] === "business") {
    // Public on purpose: the name behind a staff code, so the PIN
    // screen can show which business staff are signing in to
    // before anyone types the PIN. The code is the printed
    // identifier on the register card; the PIN is the secret.
    const biz = await businessByStaffCode(query.code || "");
    if (!biz) return err(404, "That business code does not match a SIGNL business. Check the code on the register card and try again.");
    return json(200, { businessName: biz.business.businessName, market: biz.market });
  }

  if (method === "POST" && seg[0] === "staff" && seg[1] === "enter") {
    const b = parseBody(event);
    let biz = null;
    if (b.businessCode) biz = await businessByStaffCode(b.businessCode);
    else if (user && user.role === "business") biz = user;
    if (!biz) return err(400, "Enter the business code from the register card first.");
    if (businessAccessState(biz) !== "active") return err(403, FOUNDING_BUSINESS_MESSAGE);
    if (!(await isMarketLive(biz.market))) return err(403, `The ${biz.market} market has not launched yet, so there are no creator visits to redeem.`);
    const pinRec = await staffPinRecord(biz.id);
    if (!pinRec) return err(403, "The owner has not set a staff PIN yet. Ask the owner to set one under Plan, then Staff redemption.");
    if (await staffPinLock(biz.id)) return err(429, "Too many wrong PIN tries. Staff sign-in is locked for 15 minutes. Ask the owner if the PIN changed.");
    const pin = String(b.pin || "");
    if (!/^\d{4,6}$/.test(pin) || !auth.verifyPassword(pin, pinRec.salt, pinRec.hash)) {
      const g = await staffPinFail(biz.id);
      if (g.lockedUntil && Date.now() < Date.parse(g.lockedUntil)) return err(429, "Too many wrong PIN tries. Staff sign-in is locked for 15 minutes. Ask the owner if the PIN changed.");
      return err(401, "That PIN did not match. Check with the owner and try again.");
    }
    await store.del(`staffguard:${biz.id}`);
    const token = await createStaffSession(biz.id);
    await logEvent({ type: "staff_session_started", actorId: biz.id, actorRole: "business", subjectId: biz.id, market: biz.market, data: { via: user && user.id === biz.id ? "owner_signed_in" : "staff_entry" } });
    return json(200, { businessName: biz.business.businessName, expiresAt: new Date(Date.now() + STAFF_SESSION_TTL_MS).toISOString() }, { "Set-Cookie": staffCookie(token, staffSecure) });
  }

  if (method === "GET" && seg[0] === "staff" && seg[1] === "session") {
    if (!staffCtx) return json(200, { active: false });
    return json(200, { active: true, businessName: staffCtx.business.business.businessName, market: staffCtx.business.market, expiresAt: staffCtx.expiresAt });
  }

  if (method === "POST" && seg[0] === "staff" && seg[1] === "exit") {
    if (staffCtx) {
      await store.del(`staffsession:${staffCtx.token}`);
      await logEvent({ type: "staff_session_ended", actorId: staffCtx.businessId, actorRole: "business", subjectId: staffCtx.businessId, market: staffCtx.business.market, data: {} });
    }
    return json(200, { ok: true }, { "Set-Cookie": clearStaffCookie(staffSecure) });
  }

  if (method === "POST" && seg[0] === "staff" && (seg[1] === "lookup" || seg[1] === "redeem")) {
    if (!staffCtx) return err(401, "Your staff session has ended. Enter the staff PIN to keep going.");
    const biz = staffCtx.business;
    if (businessAccessState(biz) !== "active" || !(await isMarketLive(biz.market))) {
      return err(403, "Staff redemption is not open for this business right now.");
    }
    if (!staffLookupAllowed(staffCtx.token)) return err(429, "Too many code lookups in a row. Wait a few minutes and try again.");
    const b = parseBody(event);
    const code = (b.code || "").trim().toUpperCase();
    if (!code) return err(400, "Enter the creator's code");
    const idx = await store.get(`code:${code}`);
    if (!idx) return err(404, "That code does not match any booking. Check the code and try again.");
    const booking = await store.get(`booking:${idx.bookingId}`);
    if (!booking) return err(404, "That code does not match any booking. Check the code and try again.");
    if (booking.businessId !== biz.id) return err(403, "That code is for a different business. Check the code and try again.");
    if (seg[1] === "lookup") {
      return json(200, { booking: staffBookingView(booking) });
    }
    if (booking.codeStatus === "burned" || booking.redeemedAt) {
      return err(409, `This code was already redeemed at ${booking.redeemedAt}`);
    }
    if (booking.status === "expired" || (booking.redeemBy && Date.now() > Date.parse(booking.redeemBy))) {
      return err(409, "This visit's redemption window has passed, so this code can no longer be redeemed.");
    }
    const done = await performCounterRedeem(booking, { id: biz.id, role: "business", via: "staff" });
    return json(200, { booking: staffBookingView(done) });
  }

  if (!user) return err(401, "Sign in required");

  // ---------- profile ----------
  if (method === "PATCH" && seg[0] === "me" && seg[1] === "profile") {
    const b = parseBody(event);
    const ts = nowIso();
    if (user.role === "creator" && user.creator) {
      const c = { ...user.creator };
      const changes = {};
      // Display name: a quick claim starts out named by its
      // handle; the completion flow is where the real name lands.
      if (b.name !== undefined) {
        const nn = String(b.name || "").trim().slice(0, 80);
        if (nn) { changes.name = [user.name, nn]; user.name = nn; }
      }
      if (b.handle) { changes.handle = [c.handle, String(b.handle).replace(/^@/, "").trim()]; c.handle = changes.handle[1]; c.instagramUrl = `https://instagram.com/${c.handle}`; }
      // Audience counts, stacked (Jeff, 2026-10-19). Sending
      // audienceStack replaces the whole stack; sending followerCount
      // alone updates the Instagram row (its historical meaning). The
      // tier band is FULLY AUTOMATIC (Jeff, 2026-10-19 01:46): it
      // always derives from the stacked TOTAL whenever the counts
      // change, exactly as at sign-up. A tierBand sent with a save is
      // ignored; nobody picks their own band anywhere.
      const countsTouched = b.audienceStack !== undefined || b.followerCount !== undefined;
      if (countsTouched) {
        let stack;
        if (b.audienceStack !== undefined) {
          stack = normalizeAudienceStack(b.audienceStack);
        } else {
          stack = audienceStackOf(c);
          const fc = Math.max(0, parseInt(b.followerCount, 10) || 0);
          if (fc > 0) stack.instagram = Math.min(AUDIENCE_COUNT_CAP, fc);
          else delete stack.instagram;
        }
        changes.followerCount = [c.followerCount, stack.instagram || 0];
        changes.totalAudience = [audienceTotalOf(c), Object.values(stack).reduce((s, n) => s + n, 0)];
        c.audienceStack = stack;
        c.followerCount = stack.instagram || 0;
        c.totalAudience = changes.totalAudience[1];
        c.computedTier = tierForFollowers(c.totalAudience);
        c.suggestedTier = c.computedTier;
        // Fully automatic: the band always follows the new total.
        c.tierBand = c.computedTier;
      }
      if (b.avgViews !== undefined) c.avgViews = Math.max(0, parseInt(b.avgViews, 10) || 0);
      if (b.maxVisitsPerWeek !== undefined) {
        const mv = Math.round(Number(b.maxVisitsPerWeek));
        c.maxVisitsPerWeek = Number.isFinite(mv) ? Math.min(7, Math.max(1, mv)) : 3;
      }
      // Paid lane settings (Jeff, 2026-10-19): compOpen is the
      // comp-trade toggle (default true; false = paid-only, which
      // the settings copy warns brings fewer offers). paidRate is
      // optional: null/empty means no paid bookings; when set it
      // must clear the $50 floor (below that, processing and
      // support cost more than the booking returns). The rate is
      // HERS: businesses book at exactly this number.
      if (b.compOpen !== undefined) {
        c.compOpen = b.compOpen !== false;
        changes.compOpen = [user.creator.compOpen !== false, c.compOpen];
      }
      if (b.paidRate !== undefined) {
        if (b.paidRate === null || b.paidRate === "") {
          changes.paidRate = [c.paidRate == null ? null : c.paidRate, null];
          c.paidRate = null;
        } else {
          const rate = Math.round(Number(b.paidRate) * 100) / 100;
          if (!Number.isFinite(rate) || rate < PAID_LANE.minRate) {
            return err(400, `Your paid rate must be at least $${PAID_LANE.minRate}, or left blank for no paid bookings. Below that, the payment processing and support cost more than the booking is worth.`);
          }
          if (rate > 100000) return err(400, "That rate is too large to list. Set the rate a business actually books at.");
          changes.paidRate = [c.paidRate == null ? null : c.paidRate, rate];
          c.paidRate = rate;
        }
      }
      if (Array.isArray(b.categories)) c.categories = b.categories.filter((x) => CREATOR_CATEGORIES.includes(x));
      if (Array.isArray(b.compCategories)) {
        // Paid cash campaigns stay selectable only while the creator is
        // in the Headliners tier; dropping a tier drops the option.
        c.compCategories = b.compCategories.filter((x) => COMP_CATEGORIES.includes(x) || (x === PAID_COMP && c.tierBand === "Headliners"));
        c.openToPaidCampaigns = c.compCategories.includes(PAID_COMP);
      }
      if (c.tierBand !== "Headliners" && Array.isArray(c.compCategories) && c.compCategories.includes(PAID_COMP)) {
        c.compCategories = c.compCategories.filter((x) => x !== PAID_COMP);
        c.openToPaidCampaigns = false;
      }
      if (b.tiktokHandle !== undefined) { const tk = String(b.tiktokHandle).replace(/^@/, "").trim(); c.tiktokHandle = tk || null; c.tiktokUrl = tk ? `https://www.tiktok.com/@${tk}` : null; }
      if (b.youtubeChannel !== undefined) c.youtubeChannel = String(b.youtubeChannel).trim() || null;
      if (b.facebookUrl !== undefined || b.xHandle !== undefined || b.xUrl !== undefined || b.linkedinUrl !== undefined) {
        const socials = normalizeSocials({
          facebookUrl: b.facebookUrl !== undefined ? b.facebookUrl : c.facebookUrl || "",
          xHandle: b.xHandle !== undefined ? b.xHandle : c.xHandle || "",
          xUrl: b.xUrl !== undefined ? b.xUrl : "",
          linkedinUrl: b.linkedinUrl !== undefined ? b.linkedinUrl : c.linkedinUrl || "",
        });
        c.facebookUrl = socials.facebookUrl;
        c.xHandle = socials.xHandle;
        c.xUrl = socials.xUrl;
        c.linkedinUrl = socials.linkedinUrl;
      }
      if (b.topAudienceCities !== undefined) c.topAudienceCities = cleanStringList(b.topAudienceCities, null, 5);
      if (b.city !== undefined) {
        const newCity = String(b.city).trim().slice(0, 60);
        if (user.market === UNLISTED) {
          // Unlisted creators type their own city; it can be corrected.
          if (newCity) { changes.city = [user.city, newCity]; user.city = newCity; }
        } else {
          const mkt = marketByName(user.market);
          if (mkt && mkt.cities.includes(newCity)) { changes.city = [user.city, newCity]; user.city = newCity; }
        }
      }
      if (b.state !== undefined && user.market === UNLISTED) {
        let ns = String(b.state).trim().slice(0, 60);
        if (ns.length === 2) ns = ns.toUpperCase();
        if (ns) user.state = ns;
      }
      if (b.country !== undefined && user.market === UNLISTED) {
        const nc = String(b.country).trim().slice(0, 60);
        if (nc) user.country = nc;
      }
      if (b.bio !== undefined) c.bio = String(b.bio).trim();
      if (b.bestWork !== undefined) {
        const v = validateBestWork(b.bestWork);
        if (!v.ok) return err(400, v.error);
        changes.bestWork = [(c.bestWork || []).length, v.links.length];
        c.bestWork = v.links;
      }
      if (b.neighborhood !== undefined) {
        const nb = String(b.neighborhood || "").trim().slice(0, 80);
        changes.neighborhood = [c.neighborhood || "", nb];
        c.neighborhood = nb;
      }
      if (b.university !== undefined) {
        const university = normalizeUniversity(b.university);
        changes.university = [universityOfRecord(user), university];
        c.university = university;
        user.university = university;
      }
      if (b.localAudiencePct !== undefined) {
        const pct = b.localAudiencePct === null || b.localAudiencePct === "" ? null : Math.max(0, Math.min(100, Number(b.localAudiencePct)));
        changes.localAudiencePct = [c.localAudiencePct, pct];
        c.localAudiencePct = pct;
        c.localAudienceSource = pct === null ? null : "Self-reported";
        c.localAudienceAsOf = pct === null ? null : ts.slice(0, 10);
      }
      user.creator = c;
      // Two-step claim (Jeff, 2026-10-20): completeness recomputes
      // on every save, from the record, and the stored flag follows
      // it. The flip to complete is the step-two finish line: it
      // stamps profileCompletedAt, and clearing a gate field flips
      // the creator back to incomplete (the roster gates read the
      // computed value, so they follow immediately).
      const wasComplete = c.profileComplete === true;
      const nowComplete = profileCompleteOf(user);
      c.profileComplete = nowComplete;
      if (nowComplete && !wasComplete) c.profileCompletedAt = ts;
      if (!nowComplete) c.profileCompletedAt = null;
      user.updatedAt = ts;
      await store.set(`user:${user.id}`, user);
      await logEvent({ type: "profile_updated", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { changes } });
      if (nowComplete && !wasComplete) {
        await logEvent({ type: "profile_completed", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { via: "completion_flow", handle: c.handle, city: user.city, neighborhood: c.neighborhood, university: c.university, followerCount: c.followerCount, audienceStack: c.audienceStack, totalAudience: c.totalAudience, avgViews: c.avgViews, tierBand: normalizeTierBand(c.tierBand), localAudiencePct: c.localAudiencePct, localAudienceSource: c.localAudienceSource, categories: c.categories, compCategories: c.compCategories, topAudienceCities: c.topAudienceCities, hasTiktok: !!c.tiktokHandle, hasYoutube: !!c.youtubeChannel, facebookUrl: c.facebookUrl, xHandle: c.xHandle, xUrl: c.xUrl, linkedinUrl: c.linkedinUrl, hasPhoto: !!c.hasPhoto, openToPaidCampaigns: c.openToPaidCampaigns } });
      }
      if (changes.localAudiencePct) {
        await logEvent({ type: "local_audience_updated", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { from: changes.localAudiencePct[0], to: changes.localAudiencePct[1], source: "Self-reported" } });
      }
      return json(200, { user: await withFounding(user) });
    }
    if (user.role === "business" && user.business) {
      const bz = { ...user.business };
      if (b.businessName) bz.businessName = String(b.businessName).trim();
      if (b.category && BUSINESS_CATEGORIES.includes(b.category)) bz.category = b.category;
      if (b.neighborhood !== undefined) bz.neighborhood = String(b.neighborhood || "").trim().slice(0, 80);
      if (b.about !== undefined) bz.about = String(b.about || "").trim().slice(0, 600);
      // Public review-page links: host-validated, optional, shown
      // to creators as a courtesy block. No points ever attach.
      if (b.reviewLinks !== undefined) {
        const v = validateReviewLinks(b.reviewLinks);
        if (!v.ok) return err(400, v.error);
        bz.reviewLinks = v.links;
      }
      // Audience-code discounts: the business's opt-in and its
      // own percentage. Off unless they turn it on; the code is
      // issued for counting either way.
      if (b.discountEnabled !== undefined || b.discountPct !== undefined) {
        const v = validateDiscountSetting({ enabled: b.discountEnabled, pct: b.discountPct }, bz);
        if (!v.ok) return err(400, v.error);
        bz.discountEnabled = v.enabled;
        bz.discountPct = v.pct;
      }
      // Managed talent budget: a cap + authorization, not a
      // deposit. Editable any time; spends only on Managed.
      if (b.monthlyTalentBudget !== undefined) {
        const budget = Math.round(Number(b.monthlyTalentBudget));
        if (!Number.isFinite(budget) || budget < 0 || budget > 1000000) return err(400, "Monthly talent budget must be a whole dollar amount, 0 or more");
        bz.monthlyTalentBudget = budget;
      }
      user.business = bz;
      if (b.city !== undefined) user.city = String(b.city).trim();
      user.updatedAt = ts;
      await store.set(`user:${user.id}`, user);
      await logEvent({ type: "profile_updated", actorId: user.id, actorRole: "business", subjectId: user.id, market: user.market, data: {} });
      return json(200, { user: publicUser(user) });
    }
    return err(400, "Nothing to update for this account type");
  }

  // ---------- profile photo ----------
  // Upload is a JSON body { dataUrl: "data:image/png;base64,..." } and
  // the bytes live in their own record: photo:{userId}. Serving lives
  // with the public routes above (approved creators' photos are on
  // their public profile; everyone else's stay locked down).
  if (method === "POST" && seg[0] === "me" && seg[1] === "photo") {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    const b = parseBody(event);
    const m = typeof b.dataUrl === "string" && b.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return err(400, "Send the photo as a PNG, JPEG, or WebP data URL");
    const bytes = Math.floor((m[2].length * 3) / 4);
    if (bytes > MAX_PHOTO_BYTES) return err(413, "That photo is too large. Please use one under 2.5 MB.");
    const ts = nowIso();
    await store.set(`photo:${user.id}`, { contentType: m[1], dataBase64: m[2], bytes, uploadedAt: ts });
    user.creator.hasPhoto = true;
    user.creator.photoUploadedAt = ts;
    user.updatedAt = ts;
    await store.set(`user:${user.id}`, user);
    await logEvent({ type: "profile_photo_uploaded", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { contentType: m[1], bytes } });
    return json(200, { ok: true, photoUrl: `/api/users/${user.id}/photo` });
  }

  // ---------- plan selection (business) ----------
  if (method === "POST" && seg[0] === "me" && seg[1] === "plan") {
    if (user.role !== "business") return err(403, "Businesses only");
    const b = parseBody(event);
    const plan = planById(b.planId || "");
    if (!plan) return err(400, "Unknown plan");
    user.business = {
      ...user.business,
      plan: plan.id,
      planName: `${plan.name} $${plan.priceMonthly}/mo`,
      planPriceMonthly: plan.priceMonthly,
      planMinMonths: plan.minMonths,
      billingStatus: "Founding billing: plan recorded, no card charged. Billing starts at launch.",
      planSelectedAt: nowIso(),
      // Normalize the Managed talent budget onto records that
      // predate the field (suggested default $500).
      monthlyTalentBudget: talentBudgetOf(user.business),
    };
    delete user.business.paymentLink;
    user.updatedAt = nowIso();
    await store.set(`user:${user.id}`, user);
    await logEvent({ type: "plan_selected", actorId: user.id, actorRole: "business", subjectId: user.id, market: user.market, data: { plan: plan.id, planPriceMonthly: plan.priceMonthly, source: "dashboard", billingStatus: user.business.billingStatus } });
    return json(200, { user: publicUser(user) });
  }

  // ---------- staff redemption settings (owner) ----------
  // Owner-login only: set or rotate the staff PIN, read the
  // business's staff code and register link, and sign out every
  // staff device. The PIN lives in its own record (staffpin:),
  // never on the user record, so it cannot leak through a payload.
  // PIN controls work for any approved business (an owner can set
  // up before activation); staff ENTRY stays gated on activation
  // plus a live market at the /staff/enter route above.
  if (seg[0] === "me" && seg[1] === "staff") {
    if (user.role !== "business" || !user.business) return err(403, "Businesses only");
    if (method === "GET" && seg.length === 2) {
      const cfg = await ensureStaffCode(user);
      const pinRec = await staffPinRecord(user.id);
      const sessions = (await store.list("staffsession:")).filter((r) => r.value && r.value.businessId === user.id && Date.parse(r.value.expiresAt) > Date.now());
      const base = process.env.APP_URL || "https://app.joinsignl.com";
      return json(200, {
        staffPinSet: !!pinRec,
        staffPinSetAt: pinRec ? pinRec.setAt : null,
        staffCode: cfg.staffCode,
        staffLink: cfg.staffCode ? `${base}/redeem/${cfg.staffCode}` : null,
        activeStaffSessions: sessions.length,
        businessName: user.business.businessName,
      });
    }
    if (method === "POST" && seg[2] === "pin") {
      const b = parseBody(event);
      const pin = String(b.pin || "");
      if (!/^\d{4,6}$/.test(pin)) return err(400, "The staff PIN must be 4 to 6 digits, numbers only.");
      const { salt, hash } = auth.hashPassword(pin);
      const existing = await staffPinRecord(user.id);
      const ts = nowIso();
      await store.set(`staffpin:${user.id}`, { salt, hash, setAt: existing ? existing.setAt : ts, updatedAt: ts });
      await ensureStaffCode(user);
      await logEvent({ type: existing ? "staff_pin_rotated" : "staff_pin_set", actorId: user.id, actorRole: "business", subjectId: user.id, market: user.market, data: {} });
      return json(200, { ok: true, staffPinSet: true });
    }
    if (method === "POST" && seg[2] === "signout-all") {
      const cfg = (await store.get(`staffcfg:${user.id}`)) || { staffCode: null, epoch: 0 };
      cfg.epoch = (cfg.epoch || 0) + 1;
      cfg.updatedAt = nowIso();
      await store.set(`staffcfg:${user.id}`, cfg);
      const rows = await store.list("staffsession:");
      let killed = 0;
      for (const r of rows) {
        if (r.value && r.value.businessId === user.id) {
          await store.del(r.key);
          killed += 1;
        }
      }
      await logEvent({ type: "staff_sessions_revoked", actorId: user.id, actorRole: "business", subjectId: user.id, market: user.market, data: { killed } });
      return json(200, { ok: true, killed });
    }
    if (method === "GET" && seg[2] === "register-card-qr") {
      const cfg = await ensureStaffCode(user);
      try {
        const qrcode = require("qrcode-generator");
        const qr = qrcode(0, "M");
        const base = process.env.APP_URL || "https://app.joinsignl.com";
        qr.addData(`${base}/redeem/${cfg.staffCode}`);
        qr.make();
        const svg = qr.createSvgTag({ cellSize: 6, margin: 8, scalable: true });
        return { statusCode: 200, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" }, body: svg };
      } catch (e) {
        return err(501, "QR generation is unavailable on this deployment; the printed link works on its own.");
      }
    }
    return err(404, "Unknown staff settings route");
  }

  // ---------- admin ----------
  // The compliance sweep also accepts the scheduled-function token:
  // netlify/functions/compliance-sweep.mjs POSTs here on a schedule
  // with the x-signl-sweep-token header when SIGNL_SWEEP_TOKEN is
  // set. Without the env var, only an admin session can trigger it.
  if (method === "POST" && seg[0] === "admin" && seg[1] === "compliance" && seg[2] === "sweep") {
    const token = process.env.SIGNL_SWEEP_TOKEN;
    const tokenOk = !!token && (event.headers["x-signl-sweep-token"] || event.headers["X-Signl-Sweep-Token"]) === token;
    if (!tokenOk && (!user || user.role !== "admin")) return err(403, "Admin only");
    const summary = await runComplianceSweep();
    await store.set("config:complianceSweep", { lastRunAt: nowIso() });
    // The scheduled trigger also drives the offer lifecycle, so
    // the SLA and backfill never depend on ordinary app traffic.
    const offerSweep = await runOfferSweep();
    await store.set("config:offerSweep", { lastRunAt: nowIso() });
    // And the profile completion reminders, so the day-3 nudge
    // rides the same scheduled clock. A `now` in the body is
    // honored ONLY in TEST_MODE (the verify suites time-travel).
    const b = parseBody(event);
    const remOpts = {};
    if (TEST_MODE && b.now) {
      const d = new Date(b.now);
      if (!Number.isNaN(d.getTime())) remOpts.now = d;
    }
    const profileReminders = await runProfileCompletionReminderSweep(remOpts);
    await store.set("config:profileReminderSweep", { lastRunAt: nowIso() });
    return json(200, { ok: true, sweep: summary, offerSweep, profileReminders });
  }
  // Offer lifecycle sweep: same trigger discipline as compliance
  // (scheduled token or admin session). Drives the selection SLA,
  // backfill advancement, offer expiry, and the coaching nudge.
  if (method === "POST" && seg[0] === "admin" && seg[1] === "offers" && seg[2] === "sweep") {
    const token = process.env.SIGNL_SWEEP_TOKEN;
    const tokenOk = !!token && (event.headers["x-signl-sweep-token"] || event.headers["X-Signl-Sweep-Token"]) === token;
    if (!tokenOk && (!user || user.role !== "admin")) return err(403, "Admin only");
    const summary = await runOfferSweep();
    await store.set("config:offerSweep", { lastRunAt: nowIso() });
    return json(200, { ok: true, sweep: summary });
  }
  if (seg[0] === "admin") {
    if (user.role !== "admin") return err(403, "Admin only");
    if (method === "GET" && seg[1] === "applications") {
      const all = await allUsers();
      const users = all.filter((u) => u.role !== "admin");
      const { approvedRank, pendingRank } = creatorRanks(all);
      const [allBk, allPo, allRv, allBz] = await Promise.all([allBookings(), allPosts(), allReviews(), allBizReviews()]);
      const momentum = createMomentum({ users: all, bookings: allBk, posts: allPo, reviews: allRv, bizReviews: allBz });
      const attach = (u) => {
        const pub = publicUser(u);
        if (u.role === "creator") {
          pub.university = universityOfRecord(u);
          pub.campusBadge = campusBadgeText(pub.university);
          if (pub.creator) pub.creator = { ...pub.creator, university: pub.university };
          pub.foundingPriority = approvedRank.get(u.id) || null;
          pub.queuePosition = pendingRank.get(u.id) || null;
          pub.momentum = momentum.summaryFor(u);
        }
        return pub;
      };
      const pending = users.filter((u) => u.status === "pending").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const decided = users.filter((u) => u.status !== "pending").sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1));
      return json(200, { pending: pending.map(attach), decided: decided.map(attach) });
    }
    if (method === "GET" && seg[1] === "leaderboard") {
      // Recruiter leaderboard (Jeff, 2026-10-18): every creator with
      // at least one credited sign-up, best Momentum first.
      const all = await allUsers();
      const [lbBk, lbPo, lbRv, lbBz] = await Promise.all([allBookings(), allPosts(), allReviews(), allBizReviews()]);
      const momentum = createMomentum({ users: all, bookings: lbBk, posts: lbPo, reviews: lbRv, bizReviews: lbBz });
      const rows = [];
      for (const u of all) {
        if (u.role !== "creator" || !u.creator || !u.creator.handle) continue;
        const m = momentum.summaryFor(u);
        if (m.signups < 1) continue;
        rows.push({
          userId: u.id,
          name: u.name,
          handle: u.creator.handle,
          market: u.market,
          city: u.city || "",
          status: u.status,
          createdAt: u.createdAt,
          signups: m.signups,
          approved: m.approved,
          points: m.points,
        });
      }
      rows.sort((a, b) => b.points - a.points || b.approved - a.approved || (a.createdAt < b.createdAt ? -1 : 1));
      return json(200, { leaderboard: rows });
    }
    if (method === "GET" && seg[1] === "markets") {
      const all = await allUsers();
      const flags = await getMarketFlags();
      const out = MARKETS.map((m) => {
        const inMarket = all.filter((u) => u.market === m.name && u.role !== "admin");
        return {
          id: m.id,
          name: m.name,
          label: m.label,
          country: m.country || "United States",
          live: TEST_MODE ? true : !!flags[m.name],
          creatorsApproved: inMarket.filter((u) => u.role === "creator" && u.status === "approved" && !isTester(u)).length,
          creatorsPending: inMarket.filter((u) => u.role === "creator" && u.status === "pending").length,
          businessesApproved: inMarket.filter((u) => u.role === "business" && u.status === "approved").length,
          businessesFounding: inMarket.filter((u) => u.role === "business" && u.status === "approved" && businessAccessState(u) !== "active").length,
          businessesActive: inMarket.filter((u) => u.role === "business" && u.status === "approved" && businessAccessState(u) === "active").length,
        };
      });
      return json(200, { markets: out, testMode: TEST_MODE });
    }
    if (method === "POST" && seg[1] === "markets" && seg[2] === "toggle") {
      const b = parseBody(event);
      const market = marketByName(b.market || "");
      if (!market) return err(400, "Unknown market");
      const live = b.live === true;
      await setMarketLive(market.name, live);
      await logEvent({
        type: live ? "market_activated" : "market_deactivated",
        actorId: user.id,
        actorRole: "admin",
        subjectId: null,
        market: market.name,
        data: { market: market.name, label: market.label },
      });
      return json(200, { market: market.name, label: market.label, live });
    }
    if (method === "POST" && seg[1] === "review") {
      const b = parseBody(event);
      const target = await store.get(`user:${b.userId}`);
      if (!target || target.role === "admin") return err(404, "Application not found");
      if (b.decision !== "approve" && b.decision !== "reject") return err(400, "decision must be approve or reject");
      target.status = b.decision === "approve" ? "approved" : "rejected";
      target.reviewedAt = nowIso();
      target.reviewedBy = user.id;
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: b.decision === "approve" ? "application_approved" : "application_rejected", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { applicantRole: target.role, email: target.email } });
      if (b.decision === "approve" && target.role === "creator") {
        // Approval email auto-triggers (Jeff, 2026-10-18): queued as an
        // event always, sent when the SMTP transport is configured.
        try {
          const { approvedRank } = creatorRanks(await allUsers());
          const band = foundingBand(approvedRank.get(target.id));
          const mail = approvalEmail(target, band);
          await deliverEmail("approval", target, mail.subject, mail.text, band);
        } catch (e) { /* email is best-effort */ }
      }
      return json(200, { user: publicUser(target) });
    }
    // Profile backfill on demand (Jeff, 2026-10-20): recompute the
    // stored profileComplete flags from the records themselves and
    // return the audit (who is complete, who is not, and which
    // approved creators are still unfinished). The same pass runs
    // once on its own after deploy; this endpoint re-runs it and
    // reports, for the launch checklist.
    if (method === "POST" && seg[1] === "profile-backfill") {
      const audit = await runProfileBackfill();
      return json(200, { ok: true, audit });
    }
    // Business activation (Jeff, 2026-10-20 correction): approval
    // puts a business on the founding list; ACTIVATION is a
    // separate admin action that flips accessState to "active"
    // and opens browse, favorites, and draft offers. Publishing
    // and bookings stay behind the market live flag exactly as
    // before. This is how pilot businesses get in by hand before
    // a market launch. Flipping a market live never calls this:
    // activation is never silent or automatic.
    if (method === "POST" && seg[1] === "businesses" && seg[2] === "activate") {
      const b = parseBody(event);
      const target = b.userId ? await store.get(`user:${b.userId}`) : null;
      if (!target || target.role !== "business" || !target.business) return err(404, "Business not found");
      if (target.status !== "approved") return err(400, "Approve the business application first. Activation opens product access for an approved founding business.");
      if (businessAccessState(target) === "active") return json(200, { user: publicUser(target), alreadyActive: true });
      target.business = { ...target.business, accessState: "active", activatedAt: nowIso(), activatedBy: user.id };
      delete target.business.paymentLink;
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "business_activated", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { businessName: target.business.businessName, plan: target.business.plan, via: "admin_action" } });
      return json(200, { user: publicUser(target) });
    }
    // Bulk activation for a market launch: activate every approved
    // founding business in one market. Still an explicit admin
    // action (the market toggle above never does this), and each
    // business gets its own business_activated event.
    if (method === "POST" && seg[1] === "businesses" && seg[2] === "activate-market") {
      const b = parseBody(event);
      const market = marketByName(b.market || "");
      if (!market) return err(400, "Unknown market");
      const all = await allUsers();
      const targets = all.filter((u) => u.role === "business" && u.business && u.market === market.name && u.status === "approved" && businessAccessState(u) !== "active");
      const activated = [];
      for (const target of targets) {
        target.business = { ...target.business, accessState: "active", activatedAt: nowIso(), activatedBy: user.id };
        delete target.business.paymentLink;
        target.updatedAt = nowIso();
        await store.set(`user:${target.id}`, target);
        await logEvent({ type: "business_activated", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { businessName: target.business.businessName, plan: target.business.plan, via: "bulk_market_activation" } });
        activated.push(publicUser(target));
      }
      return json(200, { market: market.name, activatedCount: activated.length, businesses: activated });
    }
    // Tester designation (Jeff, 2026-10-19): move an approved creator
    // between the active roster and Tester. A tester keeps full
    // creator-side access for testing the app, but discovery, the
    // public /c/ page, campaign sends, and every roster/approved
    // count exclude them (see isTester / isRosterCreator).
    if (method === "POST" && seg[1] === "tester") {
      const b = parseBody(event);
      const target = await store.get(`user:${b.userId}`);
      if (!target || target.role !== "creator") return err(404, "Creator not found");
      if (typeof b.tester !== "boolean") return err(400, "tester must be true or false");
      target.tester = b.tester;
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: b.tester ? "creator_marked_tester" : "creator_unmarked_tester", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { email: target.email, tester: b.tester } });
      return json(200, { user: publicUser(target) });
    }
    if (method === "GET" && seg[1] === "events") {
      const events = await listEvents({ limit: Math.min(2000, parseInt(query.limit, 10) || 500) });
      const filtered = query.type ? events.filter((e) => e.type === query.type) : events;
      return json(200, { events: filtered, total: filtered.length });
    }
    if (method === "GET" && seg[1] === "stats") {
      const users = (await allUsers()).filter((u) => u.role !== "admin");
      const offers = await allOffers();
      const bookings = await allBookings();
      const posts = await allPosts();
      const perMarket = {};
      for (const m of MARKETS) perMarket[m.name] = { creators: 0, businesses: 0, bookings: 0, posts: 0 };
      for (const u of users) {
        if (!perMarket[u.market]) continue;
        if (u.role === "creator" && u.status === "approved" && !isTester(u)) perMarket[u.market].creators += 1;
        if (u.role === "business" && u.status === "approved") perMarket[u.market].businesses += 1;
      }
      // Demand signal outside the listed markets (Jeff, 2026-10-18):
      // how many creators signed up per unlisted city, biggest first.
      // Places are city + country; older records without a country fall
      // back to their stored state so nothing disappears from the view.
      const unlistedMap = {};
      for (const u of users) {
        if (u.role === "creator" && u.market === UNLISTED) {
          const region = u.country || u.state || "";
          const place = `${u.city || "Unknown"}${region ? ", " + region : ""}`;
          if (!unlistedMap[place]) unlistedMap[place] = { place, city: u.city || "Unknown", country: u.country || null, creators: 0 };
          unlistedMap[place].creators += 1;
        }
      }
      const unlistedByCity = Object.values(unlistedMap).sort((a, b) => b.creators - a.creators);
      for (const bk of bookings) if (perMarket[bk.market]) perMarket[bk.market].bookings += 1;
      for (const p of posts) {
        const bk = bookings.find((x) => x.id === p.bookingId);
        if (bk && perMarket[bk.market]) perMarket[bk.market].posts += 1;
      }
      const onTime = posts.filter((p) => p.onTime).length;
      return json(200, {
        users: {
          creators: users.filter((u) => u.role === "creator").length,
          businesses: users.filter((u) => u.role === "business").length,
          pending: users.filter((u) => u.status === "pending").length,
          // Approved is a roster number: tester accounts are approved
          // but are not roster creators, so they never inflate it.
          // They are reported separately so the count stays honest.
          approved: users.filter((u) => u.status === "approved" && !isTester(u)).length,
          testers: users.filter((u) => isTester(u)).length,
        },
        offers: offers.length,
        bookings: {
          total: bookings.length,
          redeemed: bookings.filter((b) => b.redeemedAt).length,
          completed: bookings.filter((b) => b.status === "completed").length,
        },
        posts: { total: posts.length, onTime, late: posts.length - onTime, onTimeRate: posts.length ? Math.round((onTime / posts.length) * 100) : null },
        perMarket,
        unlistedByCity,
      });
    }
    // Creator outreach campaigns (Jeff, 2026-10-19): status,
    // import, arm, disarm. Sending itself lives in
    // runCampaignSweep (scheduled function + sweep endpoint above);
    // these routes only manage the queue and the arm switch.
    if (method === "GET" && seg[1] === "campaign" && !seg[2]) {
      const campaignId = validCampaignId(query.campaignId) ? query.campaignId : DEFAULT_CAMPAIGN_ID;
      const cfg = await getCampaignConfig(campaignId);
      const recipients = await listCampaignRecipients(campaignId);
      const counts = campaignCounts(recipients);
      const recentSends = recipients
        .filter((r) => r.status === "sent")
        .sort((a, b) => ((a.sentAt || "") < (b.sentAt || "") ? 1 : -1))
        .slice(0, 10)
        .map((r) => ({ email: r.email, name: r.name || "", handle: r.handle || "", market: r.market || "", sentAt: r.sentAt || null, messageRef: r.messageRef || null }));
      const sentToday = await campaignSentToday(new Date());
      return json(200, { campaign: campaignView(cfg, counts, sentToday), counts, recentSends });
    }
    if (method === "POST" && seg[1] === "campaign" && seg[2] === "import") {
      const b = parseBody(event);
      const campaignId = b.campaignId === undefined ? DEFAULT_CAMPAIGN_ID : b.campaignId;
      if (!validCampaignId(campaignId)) return err(400, "campaignId must be lowercase letters, numbers, and dashes");
      if (!Array.isArray(b.recipients)) return err(400, "recipients must be a list");
      if (b.recipients.length > 500) return err(400, "Import at most 500 recipients at a time");
      const skipSet = new Set();
      for (const raw of [...(Array.isArray(b.skipEmails) ? b.skipEmails : []), ...(Array.isArray(b.blocklist) ? b.blocklist : [])]) {
        const e = String(raw || "").trim().toLowerCase();
        if (e) skipSet.add(e);
      }
      let cfg = await getCampaignConfig(campaignId);
      if (!cfg.createdAt) {
        cfg.createdAt = nowIso();
        await saveCampaignConfig(cfg);
      }
      // Tester accounts never receive campaign sends (Jeff,
      // 2026-10-19): a recipient whose email belongs to a tester
      // account is recorded as skipped at import, exactly like a
      // blocklist address, and never enters the queue.
      const testerEmails = new Set((await allUsers()).filter((u) => isTester(u)).map((u) => String(u.email || "").toLowerCase()));
      let imported = 0;
      let duplicates = 0;
      let skipped = 0;
      let crossCampaign = 0;
      const invalid = [];
      for (const raw of b.recipients) {
        const item = raw && typeof raw === "object" ? raw : {};
        const email = String(item.email || "").trim().toLowerCase();
        const handle = String(item.handle || "").trim().replace(/^@/, "").slice(0, 40);
        const market = String(item.market || "").trim().slice(0, 60);
        const opener = String(item.opener || "").trim().slice(0, 280);
        const name = String(item.name || "").trim().slice(0, 120);
        if (!isEmail(email)) { invalid.push({ email: email || null, reason: "invalid email" }); continue; }
        if (!handle) { invalid.push({ email, reason: "handle is required" }); continue; }
        if (!market) { invalid.push({ email, reason: "market is required" }); continue; }
        if (!opener) { invalid.push({ email, reason: "opener is required" }); continue; }
        const key = `campaign-recipient:${campaignId}:${email}`;
        const existing = await store.get(key);
        if (existing) { duplicates += 1; continue; }
        const ts = nowIso();
        if (testerEmails.has(email)) {
          await store.set(key, { campaignId, email, name, handle, market, opener, status: "skipped", skipReason: "tester_account", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
          skipped += 1;
          continue;
        }
        if (skipSet.has(email)) {
          await store.set(key, { campaignId, email, name, handle, market, opener, status: "skipped", skipReason: "blocklist", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
          skipped += 1;
          continue;
        }
        // Cross-campaign dedupe (Jeff, 2026-10-19): the crossover
        // campaign never emails a creator the founding campaign
        // already has. The audiences overlap by design (the same
        // creator can sit on national platforms and on local
        // benches), and nobody gets two SIGNL outreach emails. The
        // address is recorded on the crossover campaign as skipped
        // with reason cross_campaign, so the tab shows it honestly.
        if (campaignId === CROSSOVER_CAMPAIGN_ID) {
          const foundingRec = await store.get(`campaign-recipient:${DEFAULT_CAMPAIGN_ID}:${email}`);
          if (foundingRec) {
            await store.set(key, { campaignId, email, name, handle, market, opener, status: "skipped", skipReason: "cross_campaign", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
            skipped += 1;
            crossCampaign += 1;
            continue;
          }
        }
        await store.set(key, { campaignId, email, name, handle, market, opener, status: "queued", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
        imported += 1;
      }
      const recipients = await listCampaignRecipients(campaignId);
      const counts = campaignCounts(recipients);
      await logEvent({ type: "campaign_recipients_imported", actorId: user.id, actorRole: "admin", subjectId: null, market: null, data: { campaignId, imported, duplicates, skipped, crossCampaign, invalid: invalid.length } });
      return json(200, { campaignId, imported, duplicates, skipped, crossCampaign, invalid, counts });
    }
    if (method === "POST" && seg[1] === "campaign" && (seg[2] === "arm" || seg[2] === "disarm")) {
      const b = parseBody(event);
      const campaignId = b.campaignId === undefined ? DEFAULT_CAMPAIGN_ID : b.campaignId;
      if (!validCampaignId(campaignId)) return err(400, "campaignId must be lowercase letters, numbers, and dashes");
      let cfg = await getCampaignConfig(campaignId);
      if (!cfg.createdAt) cfg.createdAt = nowIso();
      if (seg[2] === "arm") {
        cfg.armed = true;
        cfg.armedAt = nowIso();
        cfg.armedBy = user.id;
        cfg.disarmReason = null;
        await saveCampaignConfig(cfg);
        await logEvent({ type: "campaign_armed", actorId: user.id, actorRole: "admin", subjectId: null, market: null, data: { campaignId } });
      } else {
        cfg.armed = false;
        cfg.disarmedAt = nowIso();
        cfg.disarmReason = "manual";
        await saveCampaignConfig(cfg);
        await logEvent({ type: "campaign_disarmed", actorId: user.id, actorRole: "admin", subjectId: null, market: null, data: { campaignId } });
      }
      const recipients = await listCampaignRecipients(campaignId);
      const counts = campaignCounts(recipients);
      const sentToday = await campaignSentToday(new Date());
      return json(200, { campaign: campaignView(cfg, counts, sentToday), counts });
    }
    // Post compliance (Jeff, 2026-10-19): every redeemed visit and
    // where it stands in the post-or-pay-the-price timeline. Read
    // only; the sweep does the transitions.
    if (method === "GET" && seg[1] === "compliance") {
      const allBk = await allBookings();
      const bookings = allBk.filter((b) => b.redeemedAt || b.honorReportedAt || b.status === "expired");
      const posts = await allPosts();
      const postByBooking = new Map(posts.map((p) => [p.bookingId, p]));
      const rows = [];
      for (const b of bookings) {
        const creator = await store.get(`user:${b.creatorId}`);
        const post = postByBooking.get(b.id) || null;
        const status = complianceStatusFor(b, post, creator ? standingState(creator) : "good");
        rows.push({
          bookingId: b.id,
          creatorId: b.creatorId,
          creatorName: b.creatorName || (creator ? creator.name : ""),
          creatorHandle: b.creatorHandle || (creator && creator.creator ? creator.creator.handle : ""),
          creatorStanding: creator ? standingState(creator) : "good",
          businessId: b.businessId,
          businessName: b.businessName || "",
          market: b.market || "",
          title: b.title || "",
          redeemedAt: b.redeemedAt,
          postDeadline: b.postDeadline,
          banAt: status.banAt,
          pauseAt: status.pauseAt,
          status: status.status,
          proofUrl: post ? post.url : null,
          proofSubmittedAt: post ? post.submittedAt : null,
          reminders: {
            reminder1At: (b.compliance && b.compliance.reminder1At) || null,
            reminder2At: (b.compliance && b.compliance.reminder2At) || null,
            reminder3At: (b.compliance && b.compliance.reminder3At) || null,
          },
          redeemBy: b.redeemBy || null,
          honorReportedAt: b.honorReportedAt || null,
          honorReason: b.honorReason || null,
        });
      }
      rows.sort((a, b) => ((a.redeemedAt || "") < (b.redeemedAt || "") ? -1 : 1));
      // Honor reports aggregate per business (admin only, never a
      // public surface): two or more reports raise the warning flag.
      const byBiz = new Map();
      for (const b of allBk) {
        if (!b.honorReportedAt) continue;
        const cur = byBiz.get(b.businessId) || { businessId: b.businessId, businessName: b.businessName || "", reports: 0, lastReason: "", lastAt: null };
        cur.reports += 1;
        if (!cur.lastAt || b.honorReportedAt > cur.lastAt) { cur.lastAt = b.honorReportedAt; cur.lastReason = b.honorReason || ""; }
        byBiz.set(b.businessId, cur);
      }
      const businesses = [...byBiz.values()].map((x) => ({ ...x, warning: x.reports >= 2 })).sort((a, b) => b.reports - a.reports);
      const counts = {};
      for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
      return json(200, { visits: rows, businesses, counts });
    }
    // Reinstate a banned (or paused) creator by hand. A late post
    // after a ban never does this automatically: a person decides.
    if (method === "POST" && seg[1] === "compliance" && seg[2] === "reinstate") {
      const b = parseBody(event);
      const target = await store.get(`user:${b.userId}`);
      if (!target || target.role !== "creator") return err(404, "Creator not found");
      const previous = standingState(target);
      if (previous === "good") return err(409, "This creator is already in good standing");
      const wasStrikePause = strikePaused(target);
      target.standing = { state: "good", reason: null, at: nowIso(), bookingId: null, reinstatedBy: user.id, previousState: previous };
      // Strike probation (refinement bundle, 2026-10-20): a creator
      // reinstated from a strike pause restarts at
      // STRIKE_PROBATION_COUNT (one short of the limit), so exactly
      // one more expired window pauses the account again. The pause
      // email told the creator precisely this. Reinstatement from
      // any other pause or ban leaves the strike count untouched.
      if (wasStrikePause) target.noShowStrikes = STRIKE_PROBATION_COUNT;
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "account_reinstated", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { previousState: previous, note: String(b.note || "").slice(0, 300), strikePause: wasStrikePause, strikesAfter: noShowStrikesOf(target) } });
      return json(200, { user: publicUser(target) });
    }
    // Business Preview (Jeff, 2026-10-19): the admin walks the real
    // business journey inside the live app - plans, discovery with
    // the full filter set, the rich creator profile - to test-run
    // what a business will see. Discovery and profiles are the exact
    // code businesses get (discoverCards / publicCreator), minus the
    // market-live gate, so every market can be test-driven before it
    // opens. Offers are SIMULATED: the composer validates exactly
    // like the real one and returns a confirmation object, but
    // nothing is written to the store and no event is logged, so a
    // preview offer can never reach a creator, a count, or a metric.
    if (method === "GET" && seg[1] === "preview" && seg[2] === "discover") {
      const creators = await discoverCards(query, { id: "__preview__", role: "business", market: null });
      return json(200, { creators, preview: true });
    }
    if (method === "GET" && seg[1] === "preview" && seg[2] === "creator" && seg[3]) {
      const target = await store.get(`user:${seg[3]}`);
      if (!target || target.role !== "creator" || target.status !== "approved") return err(404, "Creator not found");
      const { users, momentum } = await momentumContext();
      const { approvedRank } = creatorRanks(users);
      const card = await publicCreator(target, { id: "__preview__", role: "business", market: null }, approvedRank.get(target.id) || null);
      card.momentum = momentum.summaryFor(target);
      card.standing = standingState(target);
      return json(200, { creator: card, preview: true });
    }
    if (method === "POST" && seg[1] === "preview" && seg[2] === "offers") {
      const b = parseBody(event);
      if (!b.title || !b.whatComped) return err(400, "Title and what is comped are required");
      const dollarCap = parseInt(b.dollarCap, 10);
      const spots = parseInt(b.spots, 10);
      if (!dollarCap || dollarCap <= 0) return err(400, "Dollar cap must be a positive number");
      if (!spots || spots <= 0) return err(400, "Spots must be a positive number");
      let targetCreator = null;
      if (b.creatorId) {
        targetCreator = await store.get(`user:${b.creatorId}`);
        if (!targetCreator || targetCreator.role !== "creator" || targetCreator.status !== "approved") return err(400, "Target creator is not an approved creator");
        if (!profileCompleteOf(targetCreator)) return err(400, "That creator has not finished their founding profile yet, so they cannot receive offers. They get the checklist and a reminder from us; pick another creator for now.");
        if (standingState(targetCreator) === "banned") return err(400, "That creator redeemed a comp and never posted, so they cannot be booked again.");
        if (standingState(targetCreator) === "paused") return err(400, pausedPickMessage(targetCreator));
      }
      // SIMULATION ONLY: build the confirmation and return it. No
      // store.set and no logEvent below this line - that is the whole
      // point of preview mode.
      const simulated = {
        id: `preview-${crypto.randomUUID()}`,
        preview: true,
        businessId: user.id,
        businessName: "Preview Business",
        market: targetCreator ? targetCreator.market : String(b.market || "Hampton Roads"),
        creatorId: targetCreator ? targetCreator.id : null,
        creatorHandle: targetCreator && targetCreator.creator ? targetCreator.creator.handle : null,
        title: String(b.title).trim(),
        whatComped: String(b.whatComped).trim(),
        covers: coversOf(b),
        paidBrief: null,
        dollarCap,
        visitWindow: String(b.visitWindow || "").trim(),
        windowMode: b.windowMode === "thisweek" ? "thisweek" : "7days",
        spots,
        status: "preview-sent",
        createdAt: nowIso(),
      };
      return json(201, { offer: simulated, preview: true });
    }
    // Preview ad use: the same simulation discipline as preview
    // offers. Validates the target and the plan's right, returns a
    // flagged confirmation, and writes NOTHING: no ad_use_declared
    // event, no notification, no Momentum.
    if (method === "POST" && seg[1] === "preview" && seg[2] === "ad-use") {
      const b = parseBody(event);
      const plan = planById(b.planId || "") || PLANS[0];
      if (!visitRightsForPlan(plan.id).adUse) return err(400, "The Self-Service plan does not include ad use. Growth and Managed do.");
      let targetCreator = null;
      if (b.creatorId) {
        targetCreator = await store.get(`user:${b.creatorId}`);
        if (!targetCreator || targetCreator.role !== "creator" || targetCreator.status !== "approved") return err(400, "Target creator is not an approved creator");
      }
      return json(201, {
        preview: true,
        adUse: {
          preview: true,
          creatorId: targetCreator ? targetCreator.id : null,
          creatorHandle: targetCreator && targetCreator.creator ? targetCreator.creator.handle : null,
          plan: plan.id,
          declaredAt: nowIso(),
          note: "Simulation only: no event logged, the creator is not notified, and no Momentum points are awarded.",
        },
      });
    }
    // Preview paid booking: the paid lane, simulated with the same
    // discipline. Validates the creator and her listed rate, runs
    // the REAL fee math, returns a flagged simulated booking, and
    // writes NOTHING: no booking, no code, no event, no escrow.
    if (method === "POST" && seg[1] === "preview" && seg[2] === "paid-booking") {
      const b = parseBody(event);
      const targetCreator = b.creatorId ? await store.get(`user:${b.creatorId}`) : null;
      if (!targetCreator || targetCreator.role !== "creator" || targetCreator.status !== "approved" || isTester(targetCreator)) return err(400, "Target creator is not an approved creator");
      const rate = Number(targetCreator.creator && targetCreator.creator.paidRate);
      if (!Number.isFinite(rate) || rate < PAID_LANE.minRate) return err(400, "That creator has not listed a paid rate, so there is no paid booking to preview.");
      const math = paidMath(rate);
      return json(201, {
        preview: true,
        booking: {
          id: `preview-${crypto.randomUUID()}`,
          preview: true,
          kind: "paid",
          creatorId: targetCreator.id,
          creatorHandle: targetCreator.creator ? targetCreator.creator.handle : null,
          rate: math.rate,
          businessTotal: math.businessTotal,
          creatorNet: math.creatorNet,
          platformFee: math.platformFee,
          escrowState: "held",
          paymentNote: PAID_LANE.paymentNote,
          note: "Simulation only: no booking saved, no code issued, no payment recorded, and the creator is not contacted.",
        },
      });
    }
    // Preview code redemptions (Jeff, 2026-10-19): the register
    // side of the SIGNL ROAS Score, simulated with the same
    // discipline as every preview action. Rebuilds the simulated
    // dashboard in memory, applies the reported tally to the one
    // simulated booking, and returns the recomputed scores. The
    // dashboard builder only reads, this handler writes NOTHING
    // and logs NOTHING, and the next dashboard load shows the
    // original simulated tallies again.
    if (method === "POST" && seg[1] === "preview" && seg[2] === "code-redemptions") {
      const b = parseBody(event);
      const count = Number(b.count);
      if (!Number.isInteger(count) || count < 0 || count > 1000000) return err(400, "Redemption count must be a whole number, 0 or more");
      const basketTotal = Number(b.basketTotal);
      if (!Number.isFinite(basketTotal) || basketTotal < 0 || basketTotal > 100000000) return err(400, "Basket total must be a dollar amount, 0 or more");
      const dash = await previewDashboard();
      const target = (dash.bookings || []).find((x) => x.id === b.bookingId);
      if (!target) return err(404, "Simulated booking not found");
      if (!target.post) return err(400, "In this simulation, redemption tallies report against a delivered visit");
      target.redemptions = { count, basketTotal: roasRound2(basketTotal), discountPct: typeof target.discountPct === "number" ? target.discountPct : 0 };
      if (b.compCostActual !== undefined && b.compCostActual !== null && b.compCostActual !== "") {
        const cost = Number(b.compCostActual);
        if (!Number.isFinite(cost) || cost < 0 || cost > 100000000) return err(400, "Comp cost must be a dollar amount, 0 or more");
        target.compCostActual = roasRound2(cost);
      }
      const plan = dash.plan || {};
      const planAllocation = plan.priceMonthly && plan.visitsPerMonth ? plan.priceMonthly / plan.visitsPerMonth : undefined;
      target.roas = roasFor([{ ...target, planAllocation }]);
      const deliveredNow = (dash.bookings || []).filter((x) => x.post);
      const aggregate = roasFor(deliveredNow.map((x) => (x.id === target.id ? { ...target, planAllocation } : { ...x, planAllocation })));
      return json(200, {
        preview: true,
        booking: { id: target.id, creatorCode: target.creatorCode, redemptions: target.redemptions, compCostActual: target.compCostActual, roas: target.roas },
        roas: aggregate,
        note: "Simulation only: nothing was saved, no tally was recorded, and the dashboard still shows its original simulated numbers on the next load.",
      });
    }
    // Admin: set a business's public review-page links (the
    // founding-application/admin side of the field; businesses can
    // also edit their own from the Plan tab). Host-validated.
    if (method === "POST" && seg[1] === "review-links") {
      const b = parseBody(event);
      const target = b.userId ? await store.get(`user:${b.userId}`) : null;
      if (!target || target.role !== "business" || !target.business) return err(404, "Business not found");
      const v = validateReviewLinks(b.links || {});
      if (!v.ok) return err(400, v.error);
      target.business = { ...target.business, reviewLinks: v.links };
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "business_review_links_updated", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { platforms: Object.keys(v.links) } });
      return json(200, { business: { userId: target.id, reviewLinks: v.links, reviewLinksView: reviewLinksView(target.business) } });
    }
    // Admin: set a business's audience-code discount setting
    // (the founding-application/admin side of the field; the
    // business can also set its own from the Plan tab). Discounts
    // are the business's opt-in: off unless enabled here or by
    // the business, at the business's own percentage (5..50).
    if (method === "POST" && seg[1] === "discount-setting") {
      const b = parseBody(event);
      const target = b.userId ? await store.get(`user:${b.userId}`) : null;
      if (!target || target.role !== "business" || !target.business) return err(404, "Business not found");
      const v = validateDiscountSetting({ enabled: b.enabled, pct: b.pct }, target.business);
      if (!v.ok) return err(400, v.error);
      target.business = { ...target.business, discountEnabled: v.enabled, discountPct: v.pct };
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "business_discount_setting_updated", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { enabled: v.enabled, pct: v.pct } });
      return json(200, { business: { userId: target.id, discount: discountSettingOf(target.business) } });
    }
    // Business Preview dashboard (Jeff, 2026-10-19): the business
    // home - booked creators, visit codes, redemption, the post
    // clock, delivered posts, performance and returns - as ONE
    // simulated Growth-plan business over the real approved roster.
    // previewDashboard() only reads and computes; like every preview
    // route it writes nothing and logs nothing.
    if (method === "GET" && seg[1] === "preview" && seg[2] === "dashboard") {
      const dashboard = await previewDashboard();
      return json(200, { dashboard, preview: true });
    }
    return err(404, "Unknown admin route");
  }

  // ---------- founding business gate ----------
  // A business that has not been activated by an admin is on the
  // founding list, whatever its application's review state or its
  // market's live flag: browse, favorites, offers (drafts
  // included), applications, bookings, the counter, posts, and
  // messages all refuse server-side with a pointer at its
  // Founding Status page. Hiding the UI is not the enforcement;
  // this check is. Business Home has the same check at its
  // handler below. This sits ahead of the approved-account gate
  // so a founding business always gets the founding answer.
  const MARKETPLACE_SECTIONS = ["discover", "favorites", "offers", "applications", "open-offers", "bookings", "counter", "posts", "messages"];
  if (user.role !== "admin" && isFoundingBusiness(user) && MARKETPLACE_SECTIONS.includes(seg[0])) {
    return err(403, FOUNDING_BUSINESS_MESSAGE);
  }

  // Everything below requires an approved account.
  if (!requireApproved(user) && user.role !== "admin") {
    return err(403, "Your application is still under review");
  }

  // ---------- founding status (creators) ----------
  // The approved creator's home until their market activates: their
  // completed profile, founding standing, priority position, and the
  // launch window. Viewed events are logged at most once per creator
  // per day so the log stays meaningful.
  if (method === "GET" && seg[0] === "me" && seg[1] === "founding") {
    if (user.role !== "creator") return err(403, "Creators only");
    const summaryRaw = await foundingSummary(user);
    const summary = publicFounding(summaryRaw);
    const { approvedRank } = creatorRanks(await allUsers());
    const card = await publicCreator(user, user, approvedRank.get(user.id) || null);
    const today = nowIso().slice(0, 10);
    if (user.foundingViewedOn !== today) {
      user.foundingViewedOn = today;
      user.updatedAt = nowIso();
      await store.set(`user:${user.id}`, user);
      await logEvent({ type: "founding_status_viewed", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { priorityPosition: summaryRaw.priorityPosition, marketLive: summaryRaw.marketLive } });
    }
    return json(200, { founding: summary, card });
  }

  // ---------- market activation gate ----------
  // Bookings, the counter, posts, and messages only operate in
  // markets an admin has activated, for everyone. Creators are
  // gated on everything marketplace-shaped until their market
  // launches (their founding home is their world until then). An
  // ACTIVATED business in a market that has not launched yet can
  // still browse the roster, favorite creators, and build DRAFT
  // offers, so the day the market flips live it is ready to
  // publish. Publishing, selecting, and every booking flow stay
  // behind the live flag, enforced in the handlers.
  if (user.role !== "admin" && MARKETPLACE_SECTIONS.includes(seg[0])) {
    if (!(await isMarketLive(user.market))) {
      const businessPrelaunchOk = user.role === "business" && businessAccessState(user) === "active" && (
        seg[0] === "favorites" ||
        (seg[0] === "discover" && method === "GET") ||
        (seg[0] === "offers" && (method === "GET" || method === "POST" || method === "PATCH"))
      );
      if (!businessPrelaunchOk) {
        return err(403, `The ${user.market} market has not launched yet. Founding creators keep priority in the order they signed up, and ${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}.`);
      }
    }
  }

  // ---------- discovery ----------
  // Business-facing creator search (spec: files/signl-business-search-
  // spec.md in the goal workspace). Every filter reads a field stored
  // on the creator record; nothing is computed from outside data.
  //   ?market=        market name (default: the business's own market)
  //   ?neighborhood=  case-insensitive text match on the creator's
  //                   neighborhood/area (also matches their city)
  //   ?tier=          tier band (Neighbors / Locals / Headliners)
  //   ?category=      a creator content category
  //   ?compCategory=  a comp category the creator accepts (business
  //                   category fit: "what would they take from us")
  //   ?followersMin= / ?followersMax=   follower-count range
  //   ?minLocalPct=   minimum % of the creator's followers in market
  //                   (the lead differentiator: no major platform
  //                   shows an SMB this number)
  //   ?paid=1         only creators open to paid cash campaigns
  //   ?q=             name or handle text search
  //   ?sort=          founding (default) | score | momentum
  if (method === "GET" && seg[0] === "discover") {
    // The query itself lives in discoverCards() so the admin Business
    // Preview answers with the identical roster, filters, and sorts.
    return json(200, { creators: await discoverCards(query, user) });
  }

  // ---------- favorites ----------
  if (seg[0] === "favorites") {
    if (user.role !== "business") return err(403, "Businesses only");
    if (method === "GET") {
      const rows = await store.list(`favorite:${user.id}:`);
      const out = [];
      for (const r of rows) {
        const creatorId = r.key.split(":")[2];
        const c = await store.get(`user:${creatorId}`);
        if (c && profileCompleteOf(c)) out.push(await publicCreator(c, user));
      }
      return json(200, { favorites: out });
    }
    if (method === "POST") {
      const b = parseBody(event);
      const creator = await store.get(`user:${b.creatorId}`);
      if (!creator || creator.role !== "creator") return err(404, "Creator not found");
      const key = `favorite:${user.id}:${creator.id}`;
      const existing = await store.get(key);
      // Adding a favorite needs a roster creator; removing one is
      // always allowed, even if the creator later unfinished their
      // profile (their card simply stops rendering above).
      if (!existing && !profileCompleteOf(creator)) return err(404, "Creator not found");
      if (existing) {
        await store.del(key);
        await logEvent({ type: "favorite_removed", actorId: user.id, actorRole: "business", subjectId: creator.id, market: creator.market, data: {} });
        return json(200, { isFavorite: false });
      }
      await store.set(key, { createdAt: nowIso() });
      await logEvent({ type: "favorite_added", actorId: user.id, actorRole: "business", subjectId: creator.id, market: creator.market, data: {} });
      return json(200, { isFavorite: true });
    }
  }

  // ---------- offers ----------
  if (seg[0] === "offers") {
    // Rebook is matched before the :id routes below.
    if (method === "POST" && seg.length === 2 && seg[1] === "rebook") {
      if (user.role !== "business") return err(403, "Businesses only");
      if (!(await isMarketLive(user.market))) return err(403, "Rebooking opens when your market launches. Your favorites and visit history are saved and waiting.");
      const b = parseBody(event);
      const creator = await store.get(`user:${b.creatorId}`);
      if (!creator || creator.role !== "creator" || creator.status !== "approved") return err(400, "That creator is not on the roster");
      if (!profileCompleteOf(creator)) return err(400, "That creator has not finished their founding profile yet, so they cannot take offers. They get the checklist and a reminder from us; pick another creator for now.");
      if (standingState(creator) === "banned") return err(400, "That creator redeemed a comp and never posted, so they cannot be booked again.");
      if (standingState(creator) === "paused") return err(400, pausedPickMessage(creator));
      // Prefill from the business's most recent delivered visit
      // with this creator when there is one; otherwise a sensible
      // blank direct offer the business can adjust before sending.
      const myBookings = (await allBookings()).filter((bk) => bk.businessId === user.id && bk.creatorId === creator.id);
      const posts = await allPosts();
      const delivered = myBookings.filter((bk) => posts.some((p) => p.bookingId === bk.id)).sort((a, b2) => (a.createdAt < b2.createdAt ? 1 : -1))[0];
      const last = delivered || myBookings.sort((a, b2) => (a.createdAt < b2.createdAt ? 1 : -1))[0];
      const ts = nowIso();
      const offer = {
        id: crypto.randomUUID(),
        businessId: user.id,
        businessName: user.business.businessName,
        market: user.market,
        category: user.business.category,
        creatorId: creator.id,
        creatorHandle: creator.creator ? creator.creator.handle : null,
        lane: "direct",
        kind: "comp",
        covers: last ? coversOf(last) : 1,
        paidBrief: null,
        cashRate: null,
        targetTiers: null,
        title: String(b.title || (last ? last.title : `Visit us again: ${user.business.businessName}`)).trim().slice(0, 140),
        whatComped: String(b.whatComped || (last ? last.whatComped : "")).trim(),
        includes: String(b.includes || (last ? last.whatComped : "")).trim(),
        experience: "",
        dollarCap: Math.max(1, parseInt(b.dollarCap, 10) || (last ? last.dollarCap : 75)),
        visitWindow: String(b.visitWindow || "").trim(),
        windowMode: b.windowMode === "thisweek" ? "thisweek" : "7days",
        spots: 1,
        status: "open",
        rebookOfBookingId: last ? last.id : null,
        createdAt: ts,
        updatedAt: ts,
      };
      if (!offer.whatComped) return err(400, "Say what is comped on the invite. It prefilled from your last visit when there is one; this creator has none yet, so add it.");
      await store.set(`offer:${offer.id}`, offer);
      await logEvent({ type: "offer_created", actorId: user.id, actorRole: "business", subjectId: offer.id, market: offer.market, data: { title: offer.title, dollarCap: offer.dollarCap, spots: 1, targeted: true, creatorId: creator.id, category: offer.category, windowMode: offer.windowMode, lane: "direct", kind: "comp", via: "rebook" } });
      await logEvent({ type: "rebook_sent", actorId: user.id, actorRole: "business", subjectId: offer.id, market: offer.market, data: { creatorId: creator.id, fromBookingId: last ? last.id : null, fromFavorite: !!(await store.get(`favorite:${user.id}:${creator.id}`)) } });
      await notifyUser(creator.id, "offer_received", `${user.business.businessName} invited you back: "${offer.title}". It is under your Offers.`, { offerId: offer.id });
      return json(201, { offer });
    }

    if (method === "POST" && seg.length === 1) {
      if (user.role !== "business") return err(403, "Businesses only");
      const b = parseBody(event);
      if (!b.title || !b.whatComped) return err(400, "Title and what is comped are required");
      const spots = parseInt(b.spots, 10);
      if (!spots || spots <= 0) return err(400, "Spots must be a positive number");
      const lane = b.creatorId ? "direct" : "open";
      const kind = b.kind === "paid" ? "paid" : "comp";
      let cashRate = null;
      let dollarCap = parseInt(b.dollarCap, 10);
      if (kind === "paid") {
        cashRate = Math.round(Number(b.cashRate || b.dollarCap) * 100) / 100;
        if (!Number.isFinite(cashRate) || cashRate < PAID_LANE.minRate) return err(400, `A cash offer for the Standard Visit package starts at $${PAID_LANE.minRate}. Below that, the payment processing and support cost more than the booking is worth. Comp offers have no minimum beyond the dignity floor for the tiers you target.`);
        dollarCap = Math.round(cashRate);
      } else if (!dollarCap || dollarCap <= 0) {
        return err(400, "Dollar cap must be a positive number");
      }
      // Target tiers (open lane): validated against the tier list;
      // the dignity floor soft-blocks a comp that underprices a
      // targeted tier, with the reason stated, never silent.
      let targetTiers = null;
      if (Array.isArray(b.targetTiers) && b.targetTiers.length) {
        const valid = b.targetTiers.filter((t) => Object.keys(COMP_GUIDANCE).includes(t));
        targetTiers = valid.length ? valid : null;
      }
      let targetCreator = null;
      if (b.creatorId) {
        targetCreator = await store.get(`user:${b.creatorId}`);
        if (!targetCreator || targetCreator.role !== "creator" || targetCreator.status !== "approved") return err(400, "Target creator is not an approved creator");
        if (!profileCompleteOf(targetCreator)) return err(400, "That creator has not finished their founding profile yet, so they cannot receive offers. They get the checklist and a reminder from us; pick another creator for now.");
        if (standingState(targetCreator) === "banned") return err(400, "That creator redeemed a comp and never posted, so they cannot be booked again.");
        if (standingState(targetCreator) === "paused") return err(400, pausedPickMessage(targetCreator));
      }
      if (kind === "comp") {
        // The dignity floor (see COMP_GUIDANCE): targeted open
        // offers soft-block per targeted tier; untargeted offers
        // carry the $25 absolute minimum and let eligibility keep
        // small comps in front of the tiers they fit; direct
        // offers warn in the composer only.
        if (!targetCreator && targetTiers) {
          const block = dignityBlock(dollarCap, targetTiers);
          if (block) return err(400, `A $${dollarCap} comp is below the dignity floor for ${block.tier} (floor $${block.floor}, typical $${COMP_GUIDANCE[block.tier].typicalLow} to $${COMP_GUIDANCE[block.tier].typicalHigh}). Raise the comp value to $${block.floor} or more, or remove ${block.tier} from who can apply. Token comps burn the roster's trust, so SIGNL does not send them.`);
        }
        if (!targetCreator && !targetTiers && dollarCap < COMP_GUIDANCE.Neighbors.floor) {
          return err(400, `A comp offer starts at $${COMP_GUIDANCE.Neighbors.floor} of value. Below that it is a token, and token comps burn the roster's trust. Raise the value, or send a direct offer to one creator instead.`);
        }
      }
      // Covers + paid brief (refinement bundle, 2026-10-20): a comp
      // offer must say how many people the comp covers; a paid
      // offer may carry short key points for the creator. A brief
      // on a comp offer is refused outright: paid buys direction,
      // comp does not.
      let covers = null;
      let paidBrief = null;
      if (kind === "comp") {
        covers = coversOf(b);
        if (String(b.paidBrief || "").trim()) return err(400, "Key points are a paid visit feature, so a comp offer cannot carry them. " + PAID_BRIEF_GUIDANCE);
      } else {
        paidBrief = String(b.paidBrief || "").trim().slice(0, PAID_BRIEF_MAX) || null;
      }
      const marketLive = await isMarketLive(user.market);
      const wantsDraft = b.draft === true || !marketLive;
      const ts = nowIso();
      const offer = {
        id: crypto.randomUUID(),
        businessId: user.id,
        businessName: user.business.businessName,
        market: user.market,
        category: user.business.category,
        creatorId: targetCreator ? targetCreator.id : null,
        creatorHandle: targetCreator && targetCreator.creator ? targetCreator.creator.handle : null,
        lane,
        kind,
        covers,
        paidBrief,
        cashRate,
        targetTiers,
        title: String(b.title).trim().slice(0, 140),
        whatComped: String(b.whatComped).trim(),
        includes: String(b.includes || b.whatComped).trim().slice(0, 600),
        experience: String(b.experience || "").trim().slice(0, 600),
        templateId: typeof b.templateId === "string" ? b.templateId.slice(0, 40) : null,
        dollarCap,
        visitWindow: String(b.visitWindow || "").trim(),
        windowMode: b.windowMode === "thisweek" ? "thisweek" : "7days",
        spots,
        status: wantsDraft ? "draft" : "open",
        createdAt: ts,
        updatedAt: ts,
        publishedAt: wantsDraft ? null : ts,
        nudgeSentAt: null,
      };
      if (lane === "open") {
        const tl = offerTimeline({ applyWindowDays: b.applyWindowDays, windowDays: b.windowDays, windowStartAt: b.windowStartAt }, Date.parse(ts));
        Object.assign(offer, tl);
        if (wantsDraft) {
          // Drafts carry the timeline they WOULD publish with, so
          // the composer preview is honest before the market opens.
          offer.draftTimeline = true;
        }
      }
      await store.set(`offer:${offer.id}`, offer);
      await logEvent({ type: "offer_created", actorId: user.id, actorRole: "business", subjectId: offer.id, market: offer.market, data: { title: offer.title, dollarCap, spots, targeted: !!targetCreator, creatorId: offer.creatorId, category: offer.category, windowMode: offer.windowMode, lane, kind, cashRate, covers, hasBrief: !!paidBrief, targetTiers, templateId: offer.templateId, status: offer.status, strength: offerStrength(offer).score } });
      if (targetCreator) await notifyUser(targetCreator.id, "offer_received", `${user.business.businessName} sent you an offer: "${offer.title}". It is under your Offers.`, { offerId: offer.id });
      return json(201, { offer });
    }

    if (method === "GET" && seg.length === 1) {
      const offers = await allOffers();
      const bookings = await allBookings();
      const apps = await allApplications();
      let out = offers.map((o) => ({
        ...o,
        lane: laneOf(o),
        kind: kindOf(o),
        bookedCount: bookings.filter((bk) => bk.offerId === o.id).length,
        filledCount: filledCountFor(o.id, bookings),
        applicationCount: apps.filter((a) => a.offerId === o.id && a.status !== "withdrawn").length,
        strength: offerStrength(o),
      }));
      if (user.role === "business") out = out.filter((o) => o.businessId === user.id);
      else if (user.role === "creator") {
        out = out.filter((o) => o.market === user.market && o.status === "open" && (!o.creatorId || o.creatorId === user.id));
        // The creator's checklist ("They can / They can't") depends on
        // the business's plan (rights follow the plan; see
        // visitRightsForPlan). Attach both per offer, plus the
        // business's public review-page links when it has set them
        // (the "Their review pages" courtesy block).
        const bizIds = [...new Set(out.map((o) => o.businessId))];
        const plans = {};
        const reviewLinks = {};
        for (const id of bizIds) {
          const biz = await store.get(`user:${id}`);
          plans[id] = biz && biz.business ? biz.business.plan : null;
          reviewLinks[id] = biz && biz.business ? reviewLinksView(biz.business) : null;
        }
        out = out.map((o) => ({ ...o, businessPlan: plans[o.businessId] || null, visitRights: visitRightsForPlan(plans[o.businessId] || null), businessReviewLinks: reviewLinks[o.businessId] || null }));
      }
      out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return json(200, { offers: out });
    }

    // Publish a draft (the market must be live: drafts are how a
    // founding business gets ready before launch day).
    if (method === "POST" && seg.length === 3 && seg[2] === "publish") {
      if (user.role !== "business") return err(403, "Businesses only");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.businessId !== user.id) return err(404, "Offer not found");
      if (offer.status !== "draft") return err(409, "Only a draft can be published");
      if (!(await isMarketLive(user.market))) return err(403, `Offers go live when your market opens. ${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}; your draft is saved and ready to publish that day.`);
      if (kindOf(offer) === "comp" && Array.isArray(offer.targetTiers) && offer.targetTiers.length) {
        const block = dignityBlock(offer.dollarCap, offer.targetTiers);
        if (block) return err(400, `A $${offer.dollarCap} comp is below the dignity floor for ${block.tier} (floor $${block.floor}). Raise the comp value or remove ${block.tier} from who can apply before publishing.`);
      }
      const ts = nowIso();
      offer.status = "open";
      offer.publishedAt = ts;
      offer.updatedAt = ts;
      if (laneOf(offer) === "open") Object.assign(offer, offerTimeline(offer, Date.parse(ts)));
      await store.set(`offer:${offer.id}`, offer);
      await logEvent({ type: "offer_published", actorId: user.id, actorRole: "business", subjectId: offer.id, market: offer.market, data: { lane: laneOf(offer), kind: kindOf(offer) } });
      if (offer.creatorId) await notifyUser(offer.creatorId, "offer_received", `${user.business.businessName} sent you an offer: "${offer.title}". It is under your Offers.`, { offerId: offer.id });
      return json(200, { offer });
    }

    // One-tap fixes and edits while an offer is a draft or open:
    // title, comp text, value (dignity floor re-checked), cash
    // rate, spots (can grow), and the redemption window end (the
    // widen-window fix extends it).
    if (method === "PATCH" && seg.length === 2) {
      if (user.role !== "business") return err(403, "Businesses only");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.businessId !== user.id) return err(404, "Offer not found");
      if (offer.status !== "draft" && offer.status !== "open") return err(409, "This offer can no longer be edited");
      const b = parseBody(event);
      const changes = {};
      if (b.title) { changes.title = [offer.title, String(b.title).trim().slice(0, 140)]; offer.title = changes.title[1]; }
      if (b.whatComped) { changes.whatComped = [offer.whatComped, String(b.whatComped).trim()]; offer.whatComped = changes.whatComped[1]; }
      if (b.includes !== undefined) offer.includes = String(b.includes).trim().slice(0, 600);
      if (b.experience !== undefined) offer.experience = String(b.experience).trim().slice(0, 600);
      if (b.dollarCap !== undefined && kindOf(offer) === "comp") {
        const cap = parseInt(b.dollarCap, 10);
        if (!cap || cap <= 0) return err(400, "Dollar cap must be a positive number");
        if (Array.isArray(offer.targetTiers) && offer.targetTiers.length) {
          const block = dignityBlock(cap, offer.targetTiers);
          if (block) return err(400, `A $${cap} comp is below the dignity floor for ${block.tier} (floor $${block.floor}). Raise the comp value to $${block.floor} or more, or remove ${block.tier} from who can apply.`);
        } else if (laneOf(offer) === "open" && cap < COMP_GUIDANCE.Neighbors.floor) {
          return err(400, `A comp offer starts at $${COMP_GUIDANCE.Neighbors.floor} of value.`);
        }
        changes.dollarCap = [offer.dollarCap, cap];
        offer.dollarCap = cap;
      }
      if (b.cashRate !== undefined && kindOf(offer) === "paid") {
        const rate = Math.round(Number(b.cashRate) * 100) / 100;
        if (!Number.isFinite(rate) || rate < PAID_LANE.minRate) return err(400, `A cash offer starts at $${PAID_LANE.minRate}.`);
        changes.cashRate = [offer.cashRate, rate];
        offer.cashRate = rate;
        offer.dollarCap = Math.round(rate);
      }
      if (b.spots !== undefined) {
        const s = parseInt(b.spots, 10);
        if (!s || s <= 0) return err(400, "Spots must be a positive number");
        changes.spots = [offer.spots, s];
        offer.spots = s;
      }
      if (b.windowEndAt && offer.windowStartAt) {
        const endMs = Date.parse(b.windowEndAt);
        if (Number.isNaN(endMs) || endMs <= Date.parse(offer.windowStartAt)) return err(400, "The window end must be after the window start");
        changes.windowEndAt = [offer.windowEndAt, new Date(endMs).toISOString()];
        offer.windowEndAt = changes.windowEndAt[1];
      }
      if (b.targetTiers !== undefined && kindOf(offer) === "comp") {
        const valid = Array.isArray(b.targetTiers) ? b.targetTiers.filter((t) => Object.keys(COMP_GUIDANCE).includes(t)) : [];
        const block = dignityBlock(offer.dollarCap, valid.length ? valid : null);
        if (block) return err(400, `A $${offer.dollarCap} comp is below the dignity floor for ${block.tier} (floor $${block.floor}). Raise the comp value or remove ${block.tier} from who can apply.`);
        offer.targetTiers = valid.length ? valid : null;
      }
      if (b.covers !== undefined && kindOf(offer) === "comp") {
        changes.covers = [coversOf(offer), coversOf(b)];
        offer.covers = changes.covers[1];
      }
      if (b.paidBrief !== undefined) {
        if (kindOf(offer) !== "paid") {
          if (String(b.paidBrief || "").trim()) return err(400, "Key points are a paid visit feature, so a comp offer cannot carry them. " + PAID_BRIEF_GUIDANCE);
        } else {
          changes.paidBrief = [offer.paidBrief || null, String(b.paidBrief || "").trim().slice(0, PAID_BRIEF_MAX) || null];
          offer.paidBrief = changes.paidBrief[1];
        }
      }
      offer.updatedAt = nowIso();
      await store.set(`offer:${offer.id}`, offer);
      await logEvent({ type: "offer_updated", actorId: user.id, actorRole: "business", subjectId: offer.id, market: offer.market, data: { changes } });
      return json(200, { offer });
    }

    // Close an offer: everyone still waiting is released with a
    // notification, never left hanging.
    if (method === "POST" && seg.length === 3 && seg[2] === "close") {
      if (user.role !== "business") return err(403, "Businesses only");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.businessId !== user.id) return err(404, "Offer not found");
      if (offer.status === "closed" || offer.status === "expired") return err(409, "This offer is already closed");
      offer.status = "closed";
      offer.updatedAt = nowIso();
      await store.set(`offer:${offer.id}`, offer);
      await logEvent({ type: "offer_closed", actorId: user.id, actorRole: "business", subjectId: offer.id, market: offer.market, data: {} });
      const mine = (await allApplications()).filter((a) => a.offerId === offer.id && (a.status === "applied" || a.status === "backfill_offered"));
      for (const app of mine) await releaseApplication(app, "offer_closed", { id: user.id, role: "business" });
      return json(200, { offer });
    }

    // The applicant stack for one of the business's open offers,
    // ranked (local fit, Impact, Momentum, reliability, founding
    // order tiebreak), with each applicant's attached profile card.
    if (method === "GET" && seg.length === 3 && seg[2] === "applications") {
      if (user.role !== "business") return err(403, "Businesses only");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.businessId !== user.id) return err(404, "Offer not found");
      const bookings = await allBookings();
      const mine = (await allApplications()).filter((a) => a.offerId === offer.id && a.status !== "withdrawn");
      const ranked = await rankApplications(mine);
      return json(200, { offer: { ...offer, filledCount: filledCountFor(offer.id, bookings) }, applications: ranked });
    }

    // Select an applicant: creates the booking through the same
    // code path as a direct accept. When the last spot fills, the
    // offer closes to the stack and everyone still waiting is
    // released with a notification.
    if (method === "POST" && seg.length === 3 && seg[2] === "select") {
      if (user.role !== "business") return err(403, "Businesses only");
      if (!(await isMarketLive(user.market))) return err(403, "Selecting creators opens when your market launches.");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.businessId !== user.id) return err(404, "Offer not found");
      if (laneOf(offer) !== "open") return err(400, "Direct offers do not have an applicant stack");
      if (offer.status !== "open" && offer.status !== "filled") return err(409, "This offer is not taking selections");
      const b = parseBody(event);
      const app = await store.get(`application:${b.applicationId}`);
      if (!app || app.offerId !== offer.id) return err(404, "Application not found");
      if (app.status !== "applied" && app.status !== "backfill_offered") return err(409, "That application is no longer waiting");
      const bookings = await allBookings();
      if (filledCountFor(offer.id, bookings) >= offer.spots) return err(409, "All spots on this offer are filled");
      const creator = await store.get(`user:${app.creatorId}`);
      if (!creator || creator.role !== "creator" || creator.status !== "approved") return err(400, "That creator is no longer on the roster");
      if (!profileCompleteOf(creator)) return err(400, "That creator has not finished their founding profile yet, so they cannot take a visit. Pick the next applicant.");
      if (standingState(creator) === "banned" || standingState(creator) === "paused") return err(400, "That creator cannot take a visit right now (compliance standing). Pick the next applicant.");
      const cap = maxVisitsPerWeekOf(creator);
      if (visitsThisWeek(bookings, creator.id, Date.now()) >= cap) return err(409, `That creator is at their max of ${cap} visits this week. Pick the next applicant, or wait for next week.`);
      const booking = await createBookingForOffer({ offer, creator, via: "selection", applicationId: app.id });
      app.status = "selected";
      app.bookingId = booking.id;
      app.decidedAt = nowIso();
      app.updatedAt = nowIso();
      await store.set(`application:${app.id}`, app);
      await logEvent({ type: "application_selected", actorId: user.id, actorRole: "business", subjectId: app.id, market: offer.market, data: { offerId: offer.id, creatorId: creator.id, bookingId: booking.id } });
      await logEvent({ type: "offer_accepted", actorId: creator.id, actorRole: "creator", subjectId: offer.id, market: offer.market, data: { businessId: offer.businessId, visitDate: "", via: "selection" } });
      await notifyUser(creator.id, "application_selected", `You were picked for "${offer.title}" at ${offer.businessName}. Your visit code is in My Visits; redeem it inside the window and post within 48 hours of the visit.`, { offerId: offer.id, applicationId: app.id, bookingId: booking.id });
      const after = await allBookings();
      if (filledCountFor(offer.id, after) >= offer.spots) {
        offer.status = "filled";
        offer.updatedAt = nowIso();
        await store.set(`offer:${offer.id}`, offer);
        const waiting = (await allApplications()).filter((a) => a.offerId === offer.id && a.status === "applied");
        for (const w of waiting) await releaseApplication(w, "spots_filled", { id: user.id, role: "business" });
      }
      return json(201, { booking: await withPostState(booking), application: app });
    }

    // Release one applicant by hand (they are told, with the
    // reason stated in plain copy).
    if (method === "POST" && seg.length === 3 && seg[2] === "release") {
      if (user.role !== "business") return err(403, "Businesses only");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.businessId !== user.id) return err(404, "Offer not found");
      const b = parseBody(event);
      const app = await store.get(`application:${b.applicationId}`);
      if (!app || app.offerId !== offer.id) return err(404, "Application not found");
      if (app.status !== "applied" && app.status !== "backfill_offered") return err(409, "That application already ended");
      await releaseApplication(app, "business_released", { id: user.id, role: "business" });
      return json(200, { application: app });
    }

    // One-tap apply (creator, open lane). No free-text pitch: the
    // application IS the creator's profile card, snapshotted here
    // and ranked live from the same records discovery uses.
    if (method === "POST" && seg.length === 3 && seg[2] === "apply") {
      if (user.role !== "creator") return err(403, "Creators only");
      if (standingState(user) === "banned") return err(403, "Your account was closed to offers after a comped visit was redeemed and no post was delivered. Contact hello@joinsignl.com if you believe this is wrong.");
      if (standingState(user) === "paused") return err(403, pausedSelfMessage(user));
      if (!profileCompleteOf(user)) return err(403, "Finish your founding profile before applying: businesses can only pick creators with finished profiles. Your checklist is on your dashboard, under Profile.");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || laneOf(offer) !== "open") return err(404, "Offer not available");
      if (offer.status !== "open") return err(409, "This offer is not taking applications right now");
      if (offer.market !== user.market) return err(403, "This offer is in a different market");
      if (offer.applicationsCloseAt && Date.now() > Date.parse(offer.applicationsCloseAt)) return err(409, "Applications for this offer have closed");
      const tier = normalizeTierBand(user.creator ? user.creator.tierBand : "");
      if (Array.isArray(offer.targetTiers) && offer.targetTiers.length && !offer.targetTiers.includes(tier)) return err(403, `This offer is for ${offer.targetTiers.join(", ")} creators. Your tier is ${tier}.`);
      if (kindOf(offer) === "comp" && !(Array.isArray(offer.targetTiers) && offer.targetTiers.length) && Number(offer.dollarCap) < (COMP_GUIDANCE[tier] || {}).floor) return err(403, `This comp is below your tier's guidance floor ($${(COMP_GUIDANCE[tier] || {}).floor}), so it is not shown to ${tier}. That floor exists to protect the roster from token comps.`);
      if (kindOf(offer) === "comp" && user.creator && user.creator.compOpen === false) return err(403, "This is a comp offer and your profile is set to paid visits only. Turn comp visits back on under Profile if you want comp offers.");
      const apps = await allApplications();
      const mine = apps.filter((a) => a.offerId === offer.id);
      if (mine.some((a) => a.creatorId === user.id && a.status !== "withdrawn" && a.status !== "released" && a.status !== "expired")) return err(409, "You already applied to this offer");
      const live = mine.filter((a) => ["applied", "selected", "backfill_offered", "backfill_accepted"].includes(a.status));
      const capApps = Math.max(offer.spots, offer.spots * APPLICATION_STACK_PER_SPOT);
      if (live.length >= capApps) return err(409, "This offer's application stack is full. Spots free up as the business decides; check the board again soon.");
      const bookings = await allBookings();
      if (bookings.some((bk) => bk.offerId === offer.id && bk.creatorId === user.id && bk.status !== "expired" && bk.status !== "cancelled")) return err(409, "You already have this visit booked");
      const ts = nowIso();
      const app = {
        id: crypto.randomUUID(),
        offerId: offer.id,
        businessId: offer.businessId,
        creatorId: user.id,
        market: offer.market,
        status: "applied",
        appliedAt: ts,
        createdAt: ts,
        updatedAt: ts,
        decidedAt: null,
        releaseReason: null,
        bookingId: null,
        backfillOfferedAt: null,
        backfillExpiresAt: null,
        snapshot: {
          handle: user.creator ? user.creator.handle : "",
          name: user.name,
          tierBand: tier,
          localAudiencePct: user.creator ? user.creator.localAudiencePct : null,
          totalAudience: audienceTotalOf(user.creator || {}),
          paidRate: user.creator && typeof user.creator.paidRate === "number" && user.creator.paidRate > 0 ? user.creator.paidRate : null,
        },
      };
      await store.set(`application:${app.id}`, app);
      await logEvent({ type: "application_submitted", actorId: user.id, actorRole: "creator", subjectId: app.id, market: offer.market, data: { offerId: offer.id, businessId: offer.businessId, tierBand: tier, localAudiencePct: app.snapshot.localAudiencePct, totalAudience: app.snapshot.totalAudience } });
      await notifyUser(offer.businessId, "application_received", `${user.name} (@${app.snapshot.handle}) applied to "${offer.title}". The stack is under My Offers.`, { offerId: offer.id, applicationId: app.id });
      return json(201, { application: app });
    }

    if (method === "POST" && seg.length === 3 && seg[2] === "accept") {
      if (user.role !== "creator") return err(403, "Creators only");
      // Compliance standing gates new bookings: a paused creator
      // delivers the missing post first; a banned creator is done.
      if (standingState(user) === "banned") return err(403, "Your account was closed to offers after a comped visit was redeemed and no post was delivered. Contact hello@joinsignl.com if you believe this is wrong.");
      if (standingState(user) === "paused") return err(403, pausedSelfMessage(user));
      if (!profileCompleteOf(user)) return err(403, "Finish your founding profile before accepting offers: businesses can only book creators with finished profiles. Your checklist is on your dashboard, under Profile.");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.status !== "open") return err(404, "Offer not available");
      if (offer.creatorId && offer.creatorId !== user.id) return err(403, "This offer was sent to a different creator");
      if (offer.market !== user.market) return err(403, "This offer is in a different market");
      const b = parseBody(event);
      const allBk = await allBookings();
      const existing = allBk.filter((bk) => bk.offerId === offer.id && bk.status !== "expired" && bk.status !== "cancelled");
      if (laneOf(offer) === "open") return err(400, "Open offers work by application: apply with one tap and the business picks from the stack. Your application is your profile card; no pitch needed.");
      if (existing.length >= offer.spots) return err(409, "All spots on this offer are booked");
      if (existing.some((bk) => bk.creatorId === user.id)) return err(409, "You already booked this offer");
      // Weekly visit cap (creator's own setting): offers still
      // arrive at cap, but accepting waits for next week.
      const cap = maxVisitsPerWeekOf(user);
      if (visitsThisWeek(allBk, user.id, Date.now()) >= cap) {
        return err(403, `You are at your max of ${cap} visit${cap === 1 ? "" : "s"} this week (your setting, under Profile). This offer stays in your Offers tab: accept it next week, or raise your weekly max if you want more.`);
      }
      const booking = await createBookingForOffer({ offer, creator: user, via: "direct_accept" });
      if (b.visitDate) {
        booking.visitDate = String(b.visitDate).trim();
        booking.updatedAt = nowIso();
        await store.set(`booking:${booking.id}`, booking);
      }
      await logEvent({ type: "offer_accepted", actorId: user.id, actorRole: "creator", subjectId: offer.id, market: offer.market, data: { businessId: offer.businessId, visitDate: booking.visitDate } });
      return json(201, { booking: await withPostState(booking) });
    }
    if (method === "POST" && seg.length === 3 && seg[2] === "decline") {
      if (user.role !== "creator") return err(403, "Creators only");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer) return err(404, "Offer not found");
      if (offer.creatorId !== user.id) return err(403, "Only the invited creator can decline this offer");
      offer.status = "declined";
      offer.updatedAt = nowIso();
      await store.set(`offer:${offer.id}`, offer);
      await logEvent({ type: "offer_declined", actorId: user.id, actorRole: "creator", subjectId: offer.id, market: offer.market, data: { businessId: offer.businessId } });
      await notifyUser(offer.businessId, "offer_declined", `${user.name} passed on "${offer.title}". Your favorites and past creators are one tap to re-invite under Discover.`, { offerId: offer.id });
      return json(200, { offer });
    }
  }

  // ---------- open offers board + my applications ----------
  if (method === "GET" && seg[0] === "open-offers") {
    if (user.role !== "creator") return err(403, "Creators only");
    const offers = await allOffers();
    const apps = await allApplications();
    const bookings = await allBookings();
    const tier = normalizeTierBand(user.creator ? user.creator.tierBand : "");
    const now = Date.now();
    const out = [];
    for (const o of offers) {
      if (laneOf(o) !== "open" || o.status !== "open" || o.market !== user.market) continue;
      if (Array.isArray(o.targetTiers) && o.targetTiers.length && !o.targetTiers.includes(tier)) continue;
      // Dignity eligibility: an untargeted comp reaches only the
      // tiers whose floor its value clears (see COMP_GUIDANCE).
      if (kindOf(o) === "comp" && !(Array.isArray(o.targetTiers) && o.targetTiers.length) && Number(o.dollarCap) < (COMP_GUIDANCE[tier] || {}).floor) continue;
      if (o.applicationsCloseAt && now > Date.parse(o.applicationsCloseAt)) continue;
      const mine = apps.filter((a) => a.offerId === o.id);
      const myApp = mine.find((a) => a.creatorId === user.id && a.status !== "withdrawn");
      const biz = await store.get(`user:${o.businessId}`);
      out.push({
        ...o,
        lane: "open",
        kind: kindOf(o),
        filledCount: filledCountFor(o.id, bookings),
        applicationCount: mine.filter((a) => ["applied", "selected", "backfill_offered", "backfill_accepted"].includes(a.status)).length,
        stackCap: Math.max(o.spots, o.spots * APPLICATION_STACK_PER_SPOT),
        myApplication: myApp ? { id: myApp.id, status: myApp.status } : null,
        strength: offerStrength(o),
        businessPlan: biz && biz.business ? biz.business.plan : null,
        visitRights: visitRightsForPlan(biz && biz.business ? biz.business.plan : null),
        businessReviewLinks: biz && biz.business ? reviewLinksView(biz.business) : null,
        businessAbout: biz && biz.business ? (biz.business.about || "") : "",
        businessNeighborhood: biz && biz.business ? (biz.business.neighborhood || "") : "",
        paidMath: kindOf(o) === "paid" ? paidMath(Number(o.cashRate)) : null,
      });
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return json(200, { offers: out });
  }

  if (seg[0] === "applications") {
    if (method === "GET" && seg.length === 1) {
      if (user.role !== "creator") return err(403, "Creators only");
      const apps = (await allApplications()).filter((a) => a.creatorId === user.id);
      const out = [];
      for (const a of apps) {
        const offer = await store.get(`offer:${a.offerId}`);
        if (!offer) continue;
        out.push({ ...a, offer: { id: offer.id, title: offer.title, businessName: offer.businessName, market: offer.market, kind: kindOf(offer), whatComped: offer.whatComped, dollarCap: offer.dollarCap, cashRate: offer.cashRate, windowStartAt: offer.windowStartAt || null, windowEndAt: offer.windowEndAt || null, status: offer.status } });
      }
      out.sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : -1));
      return json(200, { applications: out });
    }
    // Accept a backfill spot inside its 24 hour window: creates
    // the booking through the shared path and closes the chain.
    if (method === "POST" && seg.length === 3 && seg[2] === "accept-backfill") {
      if (user.role !== "creator") return err(403, "Creators only");
      if (standingState(user) === "banned") return err(403, "Your account was closed to offers after a comped visit was redeemed and no post was delivered.");
      if (standingState(user) === "paused") return err(403, pausedSelfMessage(user));
      if (!profileCompleteOf(user)) return err(403, "Finish your founding profile before taking this spot: businesses can only book creators with finished profiles. Your checklist is on your dashboard, under Profile.");
      const app = await store.get(`application:${seg[1]}`);
      if (!app || app.creatorId !== user.id) return err(404, "Application not found");
      if (app.status !== "backfill_offered") return err(409, "This backfill spot is no longer being offered to you");
      if (app.backfillExpiresAt && Date.now() > Date.parse(app.backfillExpiresAt)) return err(409, "The 24 hour window on this spot has passed");
      const offer = await store.get(`offer:${app.offerId}`);
      if (!offer || (offer.status !== "open" && offer.status !== "filled")) return err(409, "That offer is no longer active");
      const bookings = await allBookings();
      if (filledCountFor(offer.id, bookings) >= offer.spots) return err(409, "All spots on this offer are filled");
      const cap = maxVisitsPerWeekOf(user);
      if (visitsThisWeek(bookings, user.id, Date.now()) >= cap) return err(403, `You are at your max of ${cap} visits this week (your setting, under Profile).`);
      const booking = await createBookingForOffer({ offer, creator: user, via: "backfill", applicationId: app.id });
      app.status = "backfill_accepted";
      app.bookingId = booking.id;
      app.decidedAt = nowIso();
      app.updatedAt = nowIso();
      await store.set(`application:${app.id}`, app);
      await logEvent({ type: "backfill_accepted", actorId: user.id, actorRole: "creator", subjectId: app.id, market: offer.market, data: { offerId: offer.id, businessId: offer.businessId, bookingId: booking.id } });
      await logEvent({ type: "application_selected", actorId: null, actorRole: "system", subjectId: app.id, market: offer.market, data: { offerId: offer.id, creatorId: user.id, bookingId: booking.id, via: "backfill" } });
      await notifyUser(offer.businessId, "backfill_filled", `${user.name} took the backfilled spot on "${offer.title}". The visit is booked and the code is issued.`, { offerId: offer.id, applicationId: app.id, bookingId: booking.id });
      const after = await allBookings();
      if (filledCountFor(offer.id, after) >= offer.spots && offer.status !== "filled") {
        offer.status = "filled";
        offer.updatedAt = nowIso();
        await store.set(`offer:${offer.id}`, offer);
        const waiting = (await allApplications()).filter((a) => a.offerId === offer.id && a.status === "applied");
        for (const w of waiting) await releaseApplication(w, "spots_filled", { id: null, role: "system" });
      }
      return json(201, { booking: await withPostState(booking), application: app });
    }
    // Pass on a backfill spot: it advances to the next applicant
    // immediately instead of waiting out the window.
    if (method === "POST" && seg.length === 3 && seg[2] === "decline-backfill") {
      if (user.role !== "creator") return err(403, "Creators only");
      const app = await store.get(`application:${seg[1]}`);
      if (!app || app.creatorId !== user.id) return err(404, "Application not found");
      if (app.status !== "backfill_offered") return err(409, "This backfill spot is not open");
      await releaseApplication(app, "backfill_declined", { id: user.id, role: "creator" });
      const offer = await store.get(`offer:${app.offerId}`);
      if (offer) await maybeBackfill(offer);
      return json(200, { application: app });
    }
    // A selected creator gives the spot back before redemption:
    // the booking cancels and the spot backfills.
    if (method === "POST" && seg.length === 3 && seg[2] === "decline") {
      if (user.role !== "creator") return err(403, "Creators only");
      const app = await store.get(`application:${seg[1]}`);
      if (!app || app.creatorId !== user.id) return err(404, "Application not found");
      if (app.status !== "selected" && app.status !== "backfill_accepted") return err(409, "Only a selected application can be given back");
      const booking = app.bookingId ? await store.get(`booking:${app.bookingId}`) : null;
      if (booking && !booking.redeemedAt && booking.status === "booked") {
        booking.status = "cancelled";
        booking.codeStatus = "cancelled";
        booking.updatedAt = nowIso();
        await store.set(`booking:${booking.id}`, booking);
        await refundPaidEscrow(booking, "creator_declined", { escrowRefunded: 0 });
        await logEvent({ type: "booking_cancelled", actorId: user.id, actorRole: "creator", subjectId: booking.id, market: booking.market, data: { offerId: app.offerId, businessId: app.businessId, via: "application_decline" } });
      }
      app.status = "released";
      app.releaseReason = "creator_declined";
      app.decidedAt = nowIso();
      app.updatedAt = nowIso();
      await store.set(`application:${app.id}`, app);
      await logEvent({ type: "application_released", actorId: user.id, actorRole: "creator", subjectId: app.id, market: app.market, data: { offerId: app.offerId, creatorId: user.id, businessId: app.businessId, reason: "creator_declined" } });
      await notifyUser(app.businessId, "creator_declined", `${user.name} gave back the spot on the offer they were picked for. The spot backfills to the next applicant automatically.`, { offerId: app.offerId, applicationId: app.id });
      const offer = await store.get(`offer:${app.offerId}`);
      if (offer) await maybeBackfill(offer);
      return json(200, { application: app });
    }
    if (method === "POST" && seg.length === 3 && seg[2] === "withdraw") {
      if (user.role !== "creator") return err(403, "Creators only");
      const app = await store.get(`application:${seg[1]}`);
      if (!app || app.creatorId !== user.id) return err(404, "Application not found");
      if (app.status !== "applied") return err(409, "Only a waiting application can be withdrawn");
      app.status = "withdrawn";
      app.updatedAt = nowIso();
      await store.set(`application:${app.id}`, app);
      await logEvent({ type: "application_withdrawn", actorId: user.id, actorRole: "creator", subjectId: app.id, market: app.market, data: { offerId: app.offerId, businessId: app.businessId } });
      return json(200, { application: app });
    }
  }

  // ---------- notifications ----------
  if (seg[0] === "notifications") {
    if (method === "GET" && seg.length === 1) {
      const rows = await store.list(`note:${user.id}:`);
      const notes = rows.map((r) => r.value).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 40);
      return json(200, { notifications: notes, unreadCount: notes.filter((n) => !n.readAt).length });
    }
    if (method === "POST" && seg.length === 2 && seg[1] === "read") {
      const rows = await store.list(`note:${user.id}:`);
      for (const r of rows) {
        if (!r.value.readAt) {
          r.value.readAt = nowIso();
          await store.set(r.key, r.value);
        }
      }
      return json(200, { ok: true });
    }
  }

  // ---------- business home ----------
  if (method === "GET" && seg[0] === "me" && seg[1] === "business-home") {
    if (user.role !== "business") return err(403, "Businesses only");
    if (isFoundingBusiness(user)) return err(403, FOUNDING_BUSINESS_MESSAGE);
    return json(200, await businessHome(user));
  }

  // ---------- bookings and counter ----------
  if (seg[0] === "bookings" && method === "GET" && seg.length === 1) {
    let bookings = await allBookings();
    if (user.role === "creator") bookings = bookings.filter((b) => b.creatorId === user.id);
    else if (user.role === "business") bookings = bookings.filter((b) => b.businessId === user.id);
    bookings.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const out = [];
    for (const b of bookings) out.push(await withPostState(b));
    return json(200, { bookings: out });
  }

  // ---------- paid visits (Jeff, 2026-10-19) ----------
  // A business books a SPECIFIC creator at her own listed rate for
  // the same Standard Visit package. The booking is a normal
  // booking (same code, same redemption, same compliance ladder)
  // plus a paidLane object: the fee math, the escrow state, and the
  // founding-billing honesty label. SIGNL holds the payment:
  // escrow "held" at booking, "released" by the compliance sweep
  // once proof exists and the 48 hour post-proof hold passes,
  // "refunded" on a no-show or a ban. Paid bookings do NOT consume
  // the plan's monthly visit allowance: the plan buys the service,
  // a paid visit is a per-visit purchase on top.
  if (seg[0] === "bookings" && seg.length === 2 && seg[1] === "paid" && method === "POST") {
    if (user.role !== "business") return err(403, "Businesses only");
    if (!(await isMarketLive(user.market))) return err(403, "SIGNL is not live in your market yet, so paid bookings open with the market.");
    const b = parseBody(event);
    const creator = await store.get(`user:${b.creatorId}`);
    if (!creator || creator.role !== "creator" || creator.status !== "approved" || isTester(creator)) return err(400, "That creator is not on the roster");
    if (!profileCompleteOf(creator)) return err(400, "That creator has not finished their founding profile yet, so they cannot take bookings.");
    if (creator.market !== user.market) return err(400, "Paid bookings are inside your own market");
    if (standingState(creator) === "banned") return err(400, "That creator redeemed a comp and never posted, so they cannot be booked again.");
    if (standingState(creator) === "paused") return err(400, pausedPickMessage(creator));
    const rate = Number(creator.creator && creator.creator.paidRate);
    if (!Number.isFinite(rate) || rate < PAID_LANE.minRate) return err(400, "That creator has not listed a paid rate. Comp visits are always available; paid bookings need a creator who charges.");
    const allBk = await allBookings();
    const cap = maxVisitsPerWeekOf(creator);
    if (visitsThisWeek(allBk, creator.id, Date.now()) >= cap) {
      return err(409, `That creator is at their max of ${cap} visit${cap === 1 ? "" : "s"} this week. Try again next week.`);
    }
    const math = paidMath(rate);
    const code = await genCode();
    const creatorCode = await genCreatorCode(creator.creator ? creator.creator.handle : "");
    const ts = nowIso();
    const booking = {
      id: crypto.randomUUID(),
      offerId: null,
      kind: "paid",
      businessId: user.id,
      businessName: user.business.businessName,
      creatorId: creator.id,
      creatorName: creator.name,
      creatorHandle: creator.creator ? creator.creator.handle : "",
      market: user.market,
      category: user.business.category,
      title: `Paid visit: ${user.business.businessName}`,
      whatComped: String(b.whatComped || "The Standard Visit experience, as agreed with the business").trim().slice(0, 280),
      covers: null,
      paidBrief: String(b.paidBrief || "").trim().slice(0, PAID_BRIEF_MAX) || null,
      dollarCap: Math.round(rate),
      visitWindow: "Any time within 7 days of booking",
      windowMode: "7days",
      redeemBy: redeemByFor({ windowMode: "7days" }, new Date(ts)),
      visitDate: "",
      code,
      codeStatus: "issued",
      status: "booked",
      createdAt: ts,
      updatedAt: ts,
      checkinAt: null,
      redeemedAt: null,
      redeemMethod: null,
      postDeadline: null,
      replacementRequestedAt: null,
      // SIGNL ROAS (Jeff, 2026-10-19): paid visits carry an
      // audience code too, stamped with this business's own
      // discount opt-in (their percentage, or 0 when codes are
      // off). The cost basis is what the visit cost the business
      // (rate + the 3% business side); the tally works exactly
      // like a comp visit's.
      creatorCode,
      discountPct: discountPctForBooking(user.business),
      redemptions: null,
      compCostActual: math.businessTotal,
      paidLane: {
        rate: math.rate,
        businessTotal: math.businessTotal,
        creatorNet: math.creatorNet,
        platformFee: math.platformFee,
        escrowState: "held",
        paymentNote: PAID_LANE.paymentNote,
        bookedAt: ts,
        proofAt: null,
        releasedAt: null,
        refundedAt: null,
        refundReason: null,
      },
    };
    await store.set(`booking:${booking.id}`, booking);
    await store.set(`code:${code}`, { bookingId: booking.id });
    await store.set(`ccode:${creatorCode}`, { bookingId: booking.id });
    await logEvent({ type: "paid_booking_created", actorId: user.id, actorRole: "business", subjectId: booking.id, market: booking.market, data: { creatorId: creator.id, rate: math.rate, businessTotal: math.businessTotal, creatorNet: math.creatorNet, platformFee: math.platformFee, escrowState: "held", hasBrief: !!booking.paidBrief } });
    await logEvent({ type: "booking_code_issued", actorId: user.id, actorRole: "business", subjectId: booking.id, market: booking.market, data: { code, offerId: null, businessId: user.id, dollarCap: booking.dollarCap, kind: "paid", hasBrief: !!booking.paidBrief } });
    return json(201, { booking: await withPostState(booking) });
  }

  if (seg[0] === "bookings" && seg.length === 2 && method === "GET") {
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking) return err(404, "Booking not found");
    if (user.role !== "admin" && booking.creatorId !== user.id && booking.businessId !== user.id) return err(403, "Not your booking");
    return json(200, { booking: await withPostState(booking) });
  }

  // Creator visit screen QR: SVG of the counter URL for this booking code.
  if (seg[0] === "bookings" && seg.length === 3 && seg[2] === "qr" && method === "GET") {
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking) return err(404, "Booking not found");
    if (user.role !== "admin" && booking.creatorId !== user.id && booking.businessId !== user.id) return err(403, "Not your booking");
    try {
      const qrcode = require("qrcode-generator");
      const qr = qrcode(0, "M");
      const base = process.env.APP_URL || "https://app.joinsignl.com";
      qr.addData(`${base}/counter?code=${booking.code}`);
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 6, margin: 8, scalable: true });
      return { statusCode: 200, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" }, body: svg };
    } catch (e) {
      return err(501, "QR generation is unavailable on this deployment; the short code works on its own.");
    }
  }

  if (seg[0] === "bookings" && seg.length === 3 && seg[2] === "checkin" && method === "POST") {
    if (user.role !== "creator") return err(403, "Creators only");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.creatorId !== user.id) return err(404, "Booking not found");
    if (booking.status !== "booked") return err(409, "This visit is already under way or complete");
    booking.checkinAt = nowIso();
    booking.updatedAt = nowIso();
    await store.set(`booking:${booking.id}`, booking);
    await logEvent({ type: "creator_checked_in", actorId: user.id, actorRole: "creator", subjectId: booking.id, market: booking.market, data: { businessId: booking.businessId, code: booking.code } });
    await sendStaffNotice(booking, "checkin");
    return json(200, { booking: await withPostState(booking) });
  }

  if (seg[0] === "bookings" && seg.length === 3 && seg[2] === "confirm" && method === "POST") {
    if (user.role !== "business") return err(403, "Businesses only");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.businessId !== user.id) return err(404, "Booking not found");
    if (booking.redeemedAt) return err(409, "This visit was already confirmed");
    const ts = nowIso();
    booking.redeemedAt = ts;
    booking.redeemMethod = "business_confirm";
    booking.codeStatus = "burned";
    booking.status = "redeemed";
    booking.postDeadline = new Date(Date.parse(ts) + COMPLIANCE.onTimeHours * 3600 * 1000).toISOString();
    booking.updatedAt = ts;
    await store.set(`booking:${booking.id}`, booking);
    await logEvent({ type: "visit_confirmed_by_business", actorId: user.id, actorRole: "business", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, code: booking.code, postDeadline: booking.postDeadline } });
    await logEvent({ type: "code_redeemed", actorId: user.id, actorRole: "business", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, code: booking.code, method: "business_confirm", postDeadline: booking.postDeadline } });
    await sendStaffNotice(booking, "redeem");
    return json(200, { booking: await withPostState(booking) });
  }

  if (seg[0] === "bookings" && seg.length === 3 && seg[2] === "replacement" && method === "POST") {
    if (user.role !== "business") return err(403, "Businesses only");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.businessId !== user.id) return err(404, "Booking not found");
    const state = await withPostState(booking);
    if (state.postState !== "overdue") return err(409, "Replacements apply when a post is overdue");
    booking.replacementRequestedAt = nowIso();
    booking.updatedAt = nowIso();
    await store.set(`booking:${booking.id}`, booking);
    await logEvent({ type: "replacement_requested", actorId: user.id, actorRole: "business", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, code: booking.code } });
    return json(200, { booking: await withPostState(booking) });
  }

  // Counter: the business-side check-in desk.
  if (seg[0] === "counter" && method === "POST") {
    if (user.role !== "business" && user.role !== "admin") return err(403, "Businesses only");
    const b = parseBody(event);
    const code = (b.code || "").trim().toUpperCase();
    if (!code) return err(400, "Enter the booking code");
    const idx = await store.get(`code:${code}`);
    if (!idx) return err(404, "That code does not match any booking");
    const booking = await store.get(`booking:${idx.bookingId}`);
    if (!booking) return err(404, "Booking not found");
    if (user.role === "business" && booking.businessId !== user.id) return err(403, "That code belongs to a different business");
    if (seg[1] === "lookup") {
      return json(200, { booking: await withPostState(booking) });
    }
    if (seg[1] === "redeem") {
      if (booking.codeStatus === "burned" || booking.redeemedAt) {
        return err(409, `This code was already redeemed at ${booking.redeemedAt}`);
      }
      await performCounterRedeem(booking, { id: user.id, role: user.role, via: "owner" });
      return json(200, { booking: await withPostState(booking) });
    }
  }

  // ---------- posts ----------
  if (seg[0] === "posts" && method === "POST" && seg.length === 1) {
    if (user.role !== "creator") return err(403, "Creators only");
    const b = parseBody(event);
    const booking = await store.get(`booking:${b.bookingId}`);
    if (!booking || booking.creatorId !== user.id) return err(404, "Booking not found");
    if (!booking.redeemedAt) return err(409, "The visit has not been redeemed yet. The 48 hour clock starts at redemption.");
    if (booking.status === "completed") return err(409, "A post was already submitted for this visit");
    const url = (b.url || "").trim();
    // The pasted link IS the check-off (Jeff, 2026-10-19): proof of
    // the post, not a bare checkbox. It must be the Instagram post
    // or reel itself, host-validated the same way best-work links
    // are, so the business can open exactly what was delivered.
    if (bestWorkPlatform(url) !== "Instagram") return err(400, "Paste the full link to your Instagram post or reel. That link is your proof of delivery.");
    const ts = nowIso();
    const onTime = Date.parse(ts) <= Date.parse(booking.postDeadline);
    const post = {
      id: crypto.randomUUID(),
      bookingId: booking.id,
      creatorId: user.id,
      businessId: booking.businessId,
      url,
      submittedAt: ts,
      deadline: booking.postDeadline,
      redeemedAt: booking.redeemedAt,
      hoursAfterRedeem: Math.round(((Date.parse(ts) - Date.parse(booking.redeemedAt)) / 360000) ) / 10,
      onTime,
      includesDisclosure: !!b.includesDisclosure,
      verifiedAt: null,
      verifiedBy: null,
    };
    await store.set(`post:${post.id}`, post);
    booking.status = "completed";
    booking.updatedAt = ts;
    // Paid lane: proof starts the 48 hour escrow hold. The sweep
    // releases once the hold passes; the state stays "held" until
    // then, so both sides see exactly where the money is.
    if (booking.paidLane && booking.paidLane.escrowState === "held") booking.paidLane.proofAt = ts;
    await logEvent({ type: "post_submitted", actorId: user.id, actorRole: "creator", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, url, onTime, hoursAfterRedeem: post.hoursAfterRedeem, includesDisclosure: post.includesDisclosure, category: booking.category } });

    // Compliance bookkeeping for the proof (Jeff, 2026-10-19;
    // timeline final 01:34). Any proof at or before the ban moment
    // (day 14) counts as delivered: on time inside 48h, delivered
    // late up to the day-7 hard stop (+5/-10), and inside the ban
    // fuse (days 7-14) delivered late at +0/-10 with the missed
    // deadline mark staying on the record. A proof after day 14 is
    // recorded for the business but never saves the account.
    booking.compliance = booking.compliance || {};
    if (!booking.compliance.banAt) booking.compliance.banAt = banAtFor(booking);
    const banMs = Date.parse(booking.compliance.banAt);
    const submittedMs = Date.parse(ts);
    const wasBanned = standingState(user) === "banned";
    await logEvent({ type: "proof_submitted", actorId: user.id, actorRole: "creator", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, url, onTime, withinFuse: submittedMs <= banMs, whileBanned: wasBanned } });
    if (!onTime && submittedMs <= banMs) {
      // Delivered late, inside the fuse: counts, marked late.
      booking.compliance.lateDeliveredAt = ts;
      await logEvent({ type: "proof_late_accepted", actorId: user.id, actorRole: "creator", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, withinFuse: true } });
    } else if (!onTime && submittedMs > banMs) {
      // The proof arrived after the ban moment. It is recorded for
      // the business (the visit counts as delivered, late), but it
      // does not save the account: the ban the sweep would apply
      // lands here instead, and only an admin can reinstate.
      booking.compliance.proofAfterBanAt = ts;
      await logEvent({ type: "proof_late_accepted", actorId: user.id, actorRole: "creator", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, withinFuse: false } });
      if (!wasBanned) {
        if (!booking.compliance.bannedAt) booking.compliance.bannedAt = ts;
        user.standing = { state: "banned", reason: bannedNoticeReason(), at: ts, bookingId: booking.id };
        user.updatedAt = ts;
        await store.set(`user:${user.id}`, user);
        await logEvent({ type: "account_banned", actorId: null, actorRole: "system", subjectId: user.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, redeemedAt: booking.redeemedAt, banAt: booking.compliance.banAt, trigger: "proof_arrived_after_ban_moment" } });
      }
    }
    await store.set(`booking:${booking.id}`, booking);
    // A paused creator who delivers unpauses automatically; a banned
    // creator does not (reinstatement is a human decision).
    if (standingState(user) === "paused") {
      try { await unpauseIfClear(user, booking.id); } catch (e) { /* unpause is best-effort */ }
    }
    return json(201, { post, booking: await withPostState(booking) });
  }

  if (seg[0] === "posts" && seg.length === 3 && seg[2] === "verify" && method === "POST") {
    const post = await store.get(`post:${seg[1]}`);
    if (!post) return err(404, "Post not found");
    if (user.role !== "admin" && post.businessId !== user.id) return err(403, "Only the business can verify this post");
    post.verifiedAt = nowIso();
    post.verifiedBy = user.id;
    await store.set(`post:${post.id}`, post);
    const booking = await store.get(`booking:${post.bookingId}`);
    await logEvent({ type: "post_verified", actorId: user.id, actorRole: user.role, subjectId: post.id, market: booking ? booking.market : user.market, data: { bookingId: post.bookingId, creatorId: post.creatorId, onTime: post.onTime } });
    return json(200, { post });
  }

  // Ad use (Jeff, 2026-10-19): a Growth or Managed business declares
  // it is running a delivered post as an ad. The right exists only
  // while the business's account is active (it is the plan's right,
  // declared here so the use is on the record). Declaring logs
  // ad_use_declared, notifies the creator in-app (a message in their
  // thread), and awards the creator +25 Momentum, computed from this
  // stored declaration like every other point. No cash moves: paid
  // hero campaigns are the separate cash product. One declaration
  // per post.
  if (seg[0] === "posts" && seg.length === 3 && seg[2] === "ad-use" && method === "POST") {
    if (user.role !== "business") return err(403, "Businesses only");
    const post = await store.get(`post:${seg[1]}`);
    if (!post || post.businessId !== user.id) return err(404, "Post not found");
    const plan = user.business && user.business.plan;
    if (plan !== "growth" && plan !== "managed") {
      return err(403, "Ad use comes with the Growth and Managed plans. Your plan covers sharing the post natively, with the creator tagged.");
    }
    if (post.adUseDeclaredAt) return err(409, "This post is already declared for ad use");
    const ts = nowIso();
    post.adUseDeclaredAt = ts;
    post.adUseDeclaredBy = user.id;
    post.adUsePlan = plan;
    await store.set(`post:${post.id}`, post);
    const booking = await store.get(`booking:${post.bookingId}`);
    const bizName = (user.business && user.business.businessName) || post.businessName || "A SIGNL business";
    await logEvent({ type: "ad_use_declared", actorId: user.id, actorRole: "business", subjectId: post.id, market: booking ? booking.market : user.market, data: { bookingId: post.bookingId, creatorId: post.creatorId, plan, url: post.url } });
    // In-app notification: a message in the existing thread, so the
    // creator sees it in Messages and on the visit card.
    try {
      const threadId = [user.id, post.creatorId].sort().join("__");
      const msg = {
        id: crypto.randomUUID(),
        threadId,
        fromId: user.id,
        toId: post.creatorId,
        body: `Good news: ${bizName} is using your post in an ad. That is part of our ${plan === "managed" ? "Managed" : "Growth"} plan rights while our account is active, and it earned you +25 Momentum points. Your post: ${post.url}`,
        createdAt: ts,
      };
      await store.set(`message:${msg.id}`, msg);
      await logEvent({ type: "message_sent", actorId: user.id, actorRole: "business", subjectId: msg.id, market: user.market, data: { toId: post.creatorId, toRole: "creator", threadId, bodyLength: msg.body.length, system: "ad_use_notification" } });
    } catch (e) { /* the declaration stands even if the note fails */ }
    return json(200, { post });
  }

  if (seg[0] === "posts" && method === "GET") {
    let posts = await allPosts();
    if (user.role === "creator") posts = posts.filter((p) => p.creatorId === user.id);
    else if (user.role === "business") posts = posts.filter((p) => p.businessId === user.id);
    posts.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
    return json(200, { posts });
  }

  // ---------- business ratings of creators (post-visit) ----------
  // The business-to-creator RATING (Jeff, 2026-10-19 plumbing;
  // surfaced as a first-class score 2026-10-20 late): a business
  // whose visit completed (the post proof came in and the booking
  // completed) rates the creator ONCE per booking: 1-5 stars plus
  // an optional short comment (280 chars), attributed to the
  // business name, stored as review:{id} and logged as
  // business_review_left. Not editable after submit. The ratings
  // aggregate server-side into ratingAvg / ratingCount (see
  // ratingFieldsOf) and show next to Momentum on the discovery
  // card, the creator detail, the applicant stack, and the
  // creator's own profile; the public /c/ profile shows them only
  // at 3+ ratings (PUBLIC_RATING_MIN_COUNT). Ratings never mint
  // Momentum points for anyone and never change ordering. The
  // entry UI is the business's visit card (Visits & Posts); a
  // creator with no completed visits simply has no rating anywhere.
  if (method === "POST" && seg[0] === "bookings" && seg.length === 3 && seg[2] === "review") {
    if (user.role !== "business") return err(403, "Only businesses can review a completed visit");
    const b = parseBody(event);
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.businessId !== user.id) return err(404, "Booking not found");
    if (booking.status !== "completed") return err(409, "Reviews open once the visit is completed and the post is in");
    const existing = (await allReviews()).find((r) => r.bookingId === booking.id);
    if (existing) return err(409, "This visit already has a review");
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return err(400, "Stars must be a whole number from 1 to 5");
    const comment = String(b.comment == null ? "" : b.comment).trim().slice(0, 280);
    const review = {
      id: crypto.randomUUID(),
      bookingId: booking.id,
      creatorId: booking.creatorId,
      businessId: user.id,
      businessName: (user.business && user.business.businessName) || booking.businessName || "A SIGNL business",
      stars,
      comment,
      createdAt: nowIso(),
    };
    await store.set(`review:${review.id}`, review);
    await logEvent({ type: "business_review_left", actorId: user.id, actorRole: "business", subjectId: booking.creatorId, market: booking.market, data: { bookingId: booking.id, stars, hasComment: !!comment } });
    return json(201, { review: reviewDisplay(review) });
  }

  // ---------- creator reviews of businesses (Jeff, 2026-10-19) ----------
  // The mirror review: after a completed visit, the CREATOR may
  // review the BUSINESS in-app (1-5 stars plus a short note, one
  // per booking, stored as bizreview:{id}). Leaving one earns +10
  // Momentum at ANY star rating, computed from this record like
  // every other point: the points pay for honesty, never for
  // praise. This is separate from the business's public review
  // pages (Google, Yelp, and friends): those are a courtesy link
  // in the visit flow, carry no points, and are never required.
  if (method === "POST" && seg[0] === "bookings" && seg.length === 3 && seg[2] === "review-business") {
    if (user.role !== "creator") return err(403, "Creators review their own completed visits");
    const b = parseBody(event);
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.creatorId !== user.id) return err(404, "Booking not found");
    if (booking.status !== "completed") return err(409, "Reviews open once the visit is completed and your post is in");
    const existing = (await allBizReviews()).find((r) => r.bookingId === booking.id);
    if (existing) return err(409, "You already reviewed this visit");
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return err(400, "Stars must be a whole number from 1 to 5");
    const text = String(b.text == null ? "" : b.text).trim().slice(0, 500);
    const review = {
      id: crypto.randomUUID(),
      bookingId: booking.id,
      creatorId: user.id,
      businessId: booking.businessId,
      businessName: booking.businessName || "A SIGNL business",
      stars,
      text,
      createdAt: nowIso(),
    };
    await store.set(`bizreview:${review.id}`, review);
    await logEvent({ type: "creator_reviewed_business", actorId: user.id, actorRole: "creator", subjectId: booking.businessId, market: booking.market, data: { bookingId: booking.id, stars, hasText: !!text } });
    return json(201, { review: { stars: review.stars, text: review.text, businessName: review.businessName, createdAt: review.createdAt } });
  }

  // Post-performance report (Jeff, 2026-10-19 round 2): the creator
  // adds the post's views and likes after the day-7 email asks.
  // Optional fields, at least one required, one report per post.
  // The numbers live on the post record; Momentum's +5 is computed
  // from reportedAt, so it can only ever land once. Comments and
  // shares joined the report with the SIGNL ROAS Score (Jeff,
  // 2026-10-19): they are two of the four numbers the media side
  // of the score prices.
  if (method === "POST" && seg[0] === "bookings" && seg.length === 3 && seg[2] === "performance") {
    if (user.role !== "creator") return err(403, "Creators report their own post numbers");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.creatorId !== user.id) return err(404, "Booking not found");
    const post = (await allPosts()).find((p) => p.bookingId === booking.id);
    if (!post) return err(400, "No post proof on this visit yet");
    if (post.reportedAt) return err(409, "Post numbers already reported for this visit");
    const b = parseBody(event);
    const num = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 2000000000) return "invalid";
      return n;
    };
    const views = num(b.views);
    const likes = num(b.likes);
    const comments = num(b.comments);
    const shares = num(b.shares);
    if (views === "invalid" || likes === "invalid" || comments === "invalid" || shares === "invalid") return err(400, "Post numbers must be whole numbers, 0 or more");
    if (views === null && likes === null && comments === null && shares === null) return err(400, "Add at least one number: views, likes, comments, or shares");
    if (views !== null) post.views = views;
    if (likes !== null) post.likes = likes;
    if (comments !== null) post.comments = comments;
    if (shares !== null) post.shares = shares;
    post.reportedAt = nowIso();
    await store.set(`post:${post.id}`, post);
    await logEvent({ type: "post_performance_reported", actorId: user.id, actorRole: "creator", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, views: post.views == null ? null : post.views, likes: post.likes == null ? null : post.likes, comments: post.comments == null ? null : post.comments, shares: post.shares == null ? null : post.shares } });
    return json(200, { post });
  }

  // Code redemptions (Jeff, 2026-10-19): the register side of the
  // SIGNL ROAS Score. The creator's audience code is rung up at
  // the business's own register (no POS integration, ever); the
  // business reports the tally back against the booking: how many
  // customers used the code and the total basket value rung with
  // it. The report REPLACES the stored tally (it is the business's
  // current count, not an increment), snapshots the booking's
  // discount percentage, and can carry the business's own actual
  // comp cost when they state one. Businesses report on their own
  // bookings; admins can report for any founding business.
  if (method === "POST" && seg[0] === "bookings" && seg.length === 3 && seg[2] === "code-redemptions") {
    if (user.role === "creator") return err(403, "Businesses report code redemptions; creators share the code");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking) return err(404, "Booking not found");
    if (user.role === "business" && booking.businessId !== user.id) return err(404, "Booking not found");
    const b = parseBody(event);
    const count = Number(b.count);
    if (!Number.isInteger(count) || count < 0 || count > 1000000) return err(400, "Redemption count must be a whole number, 0 or more");
    const basketTotal = Number(b.basketTotal);
    if (!Number.isFinite(basketTotal) || basketTotal < 0 || basketTotal > 100000000) return err(400, "Basket total must be a dollar amount, 0 or more");
    // The tally snapshots the booking's stamped percentage. A
    // booking with no stamp promised no discount: 0, never a
    // default (codes are the business's opt-in).
    let discountPct = typeof booking.discountPct === "number" ? booking.discountPct : 0;
    if (b.discountPct !== undefined && b.discountPct !== null && b.discountPct !== "") {
      const pct = Number(b.discountPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return err(400, "Discount percent must be between 0 and 100");
      discountPct = pct;
      booking.discountPct = pct;
    }
    if (b.compCostActual !== undefined && b.compCostActual !== null && b.compCostActual !== "") {
      const cost = Number(b.compCostActual);
      if (!Number.isFinite(cost) || cost < 0 || cost > 100000000) return err(400, "Comp cost must be a dollar amount, 0 or more");
      booking.compCostActual = roasRound2(cost);
    }
    const ts = nowIso();
    booking.redemptions = { count, basketTotal: roasRound2(basketTotal), discountPct, reportedAt: ts, reportedBy: user.id };
    booking.updatedAt = ts;
    await store.set(`booking:${booking.id}`, booking);
    await logEvent({ type: "code_redemptions_reported", actorId: user.id, actorRole: user.role, subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, creatorCode: booking.creatorCode || null, count, basketTotal: booking.redemptions.basketTotal, discountPct, compCostActual: typeof booking.compCostActual === "number" ? booking.compCostActual : null } });
    return json(200, { booking: await withPostState(booking) });
  }

  // Business-didn't-honor report (Jeff, 2026-10-19 r2): the creator
  // showed up (or redeemed) and the business did not hold up its
  // end. Filing it logs business_honor_report, voids this visit's
  // compliance clock (no late, missed, pause, or ban can come out
  // of it, and Momentum skips it entirely), and flags the business
  // record. There is deliberately no public surface for it: the
  // admin Compliance view is the only place reports aggregate, and
  // two reports on one business raise a visible warning flag there.
  if (method === "POST" && seg[0] === "bookings" && seg.length === 3 && seg[2] === "honor-report") {
    if (user.role !== "creator") return err(403, "Creators report visits on their own bookings");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.creatorId !== user.id) return err(404, "Booking not found");
    if (booking.honorReportedAt) return err(409, "You already reported this visit");
    const post = (await allPosts()).find((p) => p.bookingId === booking.id);
    if (post) return err(409, "This visit already has a delivered post; there is nothing to report");
    const b = parseBody(event);
    const reason = String(b.reason || "").trim().slice(0, 280);
    if (!reason) return err(400, "Add a short reason: what happened at the business?");
    booking.honorReportedAt = nowIso();
    booking.honorReason = reason;
    booking.updatedAt = nowIso();
    await store.set(`booking:${booking.id}`, booking);
    // A paid visit voided by an honor report refunds the escrow:
    // the business did not hold up its end, so its money goes back.
    await refundPaidEscrow(booking, "business_did_not_honor");
    await logEvent({ type: "business_honor_report", actorId: user.id, actorRole: "creator", subjectId: booking.id, market: booking.market, data: { businessId: booking.businessId, creatorId: user.id, reason, wasRedeemed: !!booking.redeemedAt } });
    // Flag the business record with its running count.
    const bizUser = await store.get(`user:${booking.businessId}`);
    if (bizUser && bizUser.business) {
      const all = await allBookings();
      bizUser.business.honorReports = all.filter((x) => x.businessId === bizUser.id && x.honorReportedAt).length;
      bizUser.updatedAt = nowIso();
      await store.set(`user:${bizUser.id}`, bizUser);
    }
    return json(200, { booking: await withPostState(booking) });
  }

  // ---------- messages ----------
  if (seg[0] === "messages") {
    if (method === "GET" && seg.length === 1 && query.with) {
      const otherId = query.with;
      const threadId = [user.id, otherId].sort().join("__");
      const rows = await store.list("message:");
      const msgs = rows.map((r) => r.value).filter((m) => m.threadId === threadId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      return json(200, { messages: msgs });
    }
    if (method === "GET" && seg.length === 1) {
      const rows = await store.list("message:");
      const mine = rows.map((r) => r.value).filter((m) => m.fromId === user.id || m.toId === user.id);
      const byThread = {};
      for (const m of mine) {
        const otherId = m.fromId === user.id ? m.toId : m.fromId;
        if (!byThread[otherId] || byThread[otherId].lastMessage.createdAt < m.createdAt) {
          byThread[otherId] = { otherId, lastMessage: m, count: (byThread[otherId] ? byThread[otherId].count : 0) + 1 };
        } else {
          byThread[otherId].count += 1;
        }
      }
      const threads = [];
      for (const t of Object.values(byThread)) {
        const other = await store.get(`user:${t.otherId}`);
        threads.push({ ...t, otherName: other ? other.name : "Unknown", otherRole: other ? other.role : null, otherBusinessName: other && other.business ? other.business.businessName : null, otherHandle: other && other.creator ? other.creator.handle : null });
      }
      threads.sort((a, b) => (a.lastMessage.createdAt < b.lastMessage.createdAt ? 1 : -1));
      return json(200, { threads });
    }
    if (method === "POST" && seg.length === 1) {
      const b = parseBody(event);
      const other = await store.get(`user:${b.toUserId}`);
      if (!other || other.role === "admin") return err(404, "Recipient not found");
      if (other.status !== "approved") return err(400, "That account is not active yet");
      const body = (b.body || "").trim();
      if (!body) return err(400, "Message cannot be empty");
      const threadId = [user.id, other.id].sort().join("__");
      const msg = {
        id: crypto.randomUUID(),
        threadId,
        fromId: user.id,
        toId: other.id,
        body,
        createdAt: nowIso(),
      };
      await store.set(`message:${msg.id}`, msg);
      await logEvent({ type: "message_sent", actorId: user.id, actorRole: user.role, subjectId: msg.id, market: user.market, data: { toId: other.id, toRole: other.role, threadId, bodyLength: body.length } });
      return json(201, { message: msg });
    }
  }

  return err(404, "Route not found");
}

// The email builders are exported alongside the router so the verify
// suites can assert on the exact copy a creator receives.
module.exports = { route, approvalEmail, signupConfirmationEmail, claimConfirmationEmail, profileCompletionReminderEmail, recruiterKitEmail, strikePauseEmail, createMomentum, runComplianceSweep, runOfferSweep, runCampaignSweep, runProfileCompletionReminderSweep, runProfileBackfill, profileCompleteOf, profileCompletionFor, campaignEmail, crossoverEmail, campaignEmailFor, DEFAULT_CAMPAIGN_ID, CROSSOVER_CAMPAIGN_ID, STANDARD_VISIT, visitRightsForPlan, RECRUITER_KIT_FLAG_KEY, COMP_GUIDANCE, offerTimeline, dignityBlock, offerStrength, CREATOR_FREE_LINE, PAID_BRIEF_GUIDANCE, PAID_BRIEF_MAX, VISIT_GUARANTEE_LINE, STRIKE_LIMIT, STRIKE_PROBATION_COUNT, PREVIEW_STAFF_DEMO, coversOf, coversText, noShowStrikesOf, strikeStatusLine, REFERRAL_MILESTONES, ELITE_RULE, UNIVERSITY_OPTIONS, normalizeUniversity, universityOfRecord, sameUniversity, campusBadgeText };
