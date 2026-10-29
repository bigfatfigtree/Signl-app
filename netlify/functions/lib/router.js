// SIGNL API router. One Netlify Function (api.js) delegates here.
// All routes are under /api/*. Every state change writes an event via
// lib/events.js and stamps updatedAt on the record it touches.
const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { logEvent, listEvents } = require("./events");
const { MARKETS, normalizeMarketName, resolveTypedCity, TIERS, CREATOR_CATEGORIES, COMP_CATEGORIES, BUSINESS_CATEGORIES, PLANS, PROFESSIONS, LEGACY_PROFESSIONS, REALTOR_PROFESSION, canonicalFromList, tierForFollowers, normalizeTierBand } = require("./markets");
const { computeLocalImpactScore, summarizeHistory } = require("./score");
const { computeFit, buildFitNote } = require("./fit");
const { emailEnabled, sendEmail, senderProfile } = require("./email");
const claimEvidence = require("./claim-evidence");
const stripe = require("./stripe");
const connect = require("./connect");
const { runMetricsSync } = require("./metrics-sync");
const platformConnect = require("./platform-connect");
const { askSigAI } = require("./sigai");
const { buildProfilePageHtml } = require("./profile-meta");
const igPrefill = require("./ig-prefill");
const ZIP_CENTROIDS = require("./zip-centroids.json");

// ---------- Build -31: proximity, book-me page, Charter early access ----------
// Proximity (Jeff, 2026-10-29): creators and businesses each store
// a 5-digit ZIP only, never a street address for a creator.
// Distances are computed from ZIP centroids (US Census Gazetteer
// ZCTA interior points, public domain) and only ever SURFACED as
// coarse bands. No exact distance, no pin, no per-band count ever
// leaves the server.
const PROXIMITY_BANDS = ["Same neighborhood", "Under 2 miles", "Under 5 miles"];
function zipCentroid(zip) {
  const z = String(zip || "").trim();
  if (!/^\d{5}$/.test(z)) return null;
  const c = ZIP_CENTROIDS[z];
  return Array.isArray(c) ? { lat: c[0], lng: c[1] } : null;
}
function zipDistanceMiles(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
// The band a creator falls into for one business viewer, or null.
// A creator who turned "Show me in near-you results" off
// (proximityOptOut) never bands; they stay on the normal roster.
// "Same neighborhood" wins first: same ZIP, or the same typed
// neighborhood name on both records.
function proximityBandFor(businessUser, creatorUser) {
  const c = (creatorUser && creatorUser.creator) || {};
  if (c.proximityOptOut === true) return null;
  const bz = (businessUser && businessUser.business) || {};
  const bizZip = String(bz.zip || "").trim();
  const crZip = String(c.zip || "").trim();
  if (bizZip && crZip && bizZip === crZip) return "Same neighborhood";
  const bizNb = String(bz.neighborhood || "").trim().toLowerCase();
  const crNb = String(c.neighborhood || "").trim().toLowerCase();
  if (bizNb && crNb && bizNb === crNb) return "Same neighborhood";
  const a = zipCentroid(bizZip);
  const b = zipCentroid(crZip);
  if (a && b) {
    const d = zipDistanceMiles(a, b);
    if (d < 2) return "Under 2 miles";
    if (d < 5) return "Under 5 miles";
  }
  return null;
}
// Paid, active business (Amendment 2, Jeff, 2026-10-29): the
// business has been activated by an admin AND carries a live
// subscription on a founding plan. past_due is revenue on the
// partner ledger but it is not "paid", so it does not unlock.
function businessPaidActive(u) {
  if (!u || u.role !== "business" || !u.business) return false;
  if (businessAccessState(u) !== "active") return false;
  const sub = u.business.subscription;
  return !!sub && (sub.status === "active" || sub.status === "trialing");
}
// Charter 24-hour early access (Jeff, 2026-10-29): in a live
// market, a newly posted OPEN offer is visible to Charter
// (founding) creators for its first 24 hours before non-Charter
// creators see it. The window anchors on when the offer actually
// went open (publishedAt, falling back to createdAt). Direct
// offers are addressed to one named creator and are never
// windowed. The rule is scoped to live markets only: in a market
// that has not launched, no window applies.
const CHARTER_EARLY_ACCESS_MS = 24 * 60 * 60 * 1000;
function isCharterCreator(u) {
  return !!(u && u.creator && u.creator.charter === true);
}
function offerVisibleToCreator(offer, creatorUser, nowMs, marketLive) {
  if (!offer || laneOf(offer) !== "open") return true;
  if (!marketLive) return true;
  if (isCharterCreator(creatorUser)) return true;
  const anchor = Date.parse(offer.publishedAt || offer.createdAt || "");
  if (Number.isNaN(anchor)) return true;
  return nowMs >= anchor + CHARTER_EARLY_ACCESS_MS;
}
// Book-me page themes (SIGNL palette only) and featured posts.
const PAGE_THEMES = ["ink", "mint", "deep", "pale"];
function pageThemeOf(c) {
  return c && PAGE_THEMES.includes(c.pageTheme) ? c.pageTheme : "ink";
}
// Featured posts: up to 3 Instagram post/reel URLs the creator
// pasted. Returns the normalized list, or null when any entry is
// not an Instagram post link (the save is refused whole).
function normalizeFeaturedPosts(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const raw of list) {
    const url = String(raw || "").trim();
    if (!url) continue;
    const m = url.match(/^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels)\/([A-Za-z0-9_-]{5,24})\/?([?#].*)?$/);
    if (!m) return null;
    out.push(`https://www.instagram.com/${m[2] === "reels" ? "reel" : m[2]}/${m[3]}/`);
    if (out.length > 3) return null;
  }
  return [...new Set(out)];
}
// The social channels a Tier 2 (paid, active) business may see on
// a book-me page: only the channels on the creator's own record,
// only Instagram / TikTok / YouTube (Jeff's amendment list).
function creatorSocialLinks(c) {
  const links = [];
  const seen = new Set();
  const push = (platform, label, url) => {
    if (!url || seen.has(platform)) return;
    seen.add(platform);
    links.push({ platform, label, url });
  };
  const primary = primaryProfileOf(c);
  if (primary.platform === "instagram") push("instagram", "Instagram", primary.url);
  else if (c.instagramUrl) push("instagram", "Instagram", c.instagramUrl);
  if (primary.platform === "tiktok") push("tiktok", "TikTok", primary.url);
  else if (c.tiktokUrl) push("tiktok", "TikTok", c.tiktokUrl);
  if (c.youtubeChannel) {
    const yc = String(c.youtubeChannel).trim();
    push("youtube", "YouTube", /^https?:\/\//.test(yc) ? yc : `https://www.youtube.com/@${yc.replace(/^@/, "")}`);
  }
  return links;
}
// Non-circumvention reminder lines (Amendment 1, Jeff,
// 2026-10-29). One line, plain and friendly, at the two moments
// a booking relationship starts in-product.
const THREAD_STARTED_LINE = "This conversation started on SIGNL, so bookings from it run through SIGNL, where the Visit Guarantee and payment protection apply.";
const BOOKING_STARTED_LINE = "This booking started on SIGNL, so it runs through SIGNL, where the Visit Guarantee and payment protection apply.";

// ------------------------------------------------------------------
// Launch shape (Jeff, 2026-10-18): creator founding sign-up is the
// only public account type at launch. Business registration is
// disabled (businesses join the founding list on joinsignl.com), and
// the marketplace (discovery, offers, bookings, counter, posts,
// messages) stays inactive in a market until an admin flips that
// market's "live" flag. All 37 markets default to NOT live.
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
// Headliners tier (15k+) only: separate from comps, these creators can also be
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

// Creator photo gallery (Jeff, 2026-10-25): up to 6 photos per
// creator, ordered, first = cover. Records written before the
// gallery carry no photoCount: they migrate in place — hasPhoto
// means a gallery of one (the existing photo:{userId} record IS
// slot 0), never an orphaned photo.
const MAX_CREATOR_PHOTOS = 6;
function photoCountOf(creator) {
  const c = creator || {};
  if (Number.isInteger(c.photoCount) && c.photoCount >= 0) return Math.min(c.photoCount, MAX_CREATOR_PHOTOS);
  return c.hasPhoto ? 1 : 0;
}
function photoKey(userId, idx) {
  return idx === 0 ? `photo:${userId}` : `photo:${userId}:${idx}`;
}
function photoUrlsFor(u) {
  const n = photoCountOf(u && u.creator);
  const out = [];
  for (let i = 0; i < n; i++) out.push(i === 0 ? `/api/users/${u.id}/photo` : `/api/users/${u.id}/photo/${i}`);
  return out;
}

// Preview stock pool (Jeff, 2026-10-25): the V5 decks are
// photo-led, but the real founding roster mostly has no photos
// yet, so preview Discover was untestable. Inside PREVIEW ONLY
// (admin, labeled simulation end to end), a roster card without
// photos borrows this stock pool — each URL verified live when
// added. The substitution happens on the response object; stored
// records and every real surface are untouched, and the card is
// flagged previewPhoto so the UI labels it a sample.
const PREVIEW_STOCK_PHOTOS = [
  1640777, 1267320, 3184291, 4253302, 5638732, 3184183, 262978, 769289,
  958545, 3026802, 4346644, 3182812, 1854652, 1092730, 1437267, 699953,
].map((id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=800`);
function previewStockFor(seed, n) {
  const s = String(seed || "signl");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push(PREVIEW_STOCK_PHOTOS[(h + i) % PREVIEW_STOCK_PHOTOS.length]);
  return out;
}
function decoratePreviewCard(card) {
  if (!card) return card;
  if (!card.photoUrl) {
    const stock = previewStockFor(card.userId || card.name, 3);
    card.photoUrl = stock[0];
    card.photos = stock;
    card.previewPhoto = true;
  } else if (!Array.isArray(card.photos) || card.photos.length < 2) {
    card.photos = [card.photoUrl, ...previewStockFor(card.userId || card.name, 2)];
    card.previewPhoto = true;
  }
  return card;
}

// Simulated open offers for the creator-side preview deck.
// Dates are relative to now so the board always looks current.
function previewOpenOffers() {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const base = {
    lane: "open",
    market: "Virginia Beach",
    filledCount: 0,
    myApplication: null,
    fitNote: null,
    businessReviewLinks: null,
    businessReferralProgram: null,
    visitRights: null,
  };
  return [
    { ...base, id: "preview-offer-1", businessId: "__preview__", businessName: "Salt & Ember Kitchen", businessNeighborhood: "Oceanfront", businessAbout: "Chef-driven restaurant on the Oceanfront. Preview business: simulation only.", title: "Dinner for two, on us", kind: "comp", whatComped: "Dinner for two: two mains, two drinks, one dessert to share", covers: 2, dollarCap: 120, includes: "Two mains, two drinks, one dessert", experience: "Counter seats facing the open kitchen", spots: 4, applicationCount: 2, windowStartAt: iso(now + 2 * day), windowEndAt: iso(now + 9 * day), applicationsCloseAt: iso(now + 5 * day), visitWindow: "Any evening this week" },
    { ...base, id: "preview-offer-2", businessId: "__preview__", businessName: "Harbor Pilates", businessNeighborhood: "Ghent", businessAbout: "Reformer studio in Ghent. Preview business: simulation only.", title: "Reformer class for you + 1", kind: "comp", whatComped: "One reformer class for two people", covers: 2, dollarCap: 70, includes: "Grip socks and towels", experience: "Small-format class, six reformers", spots: 6, filledCount: 1, applicationCount: 3, windowStartAt: iso(now + 1 * day), windowEndAt: iso(now + 8 * day), applicationsCloseAt: iso(now + 4 * day), visitWindow: "Weekday mornings" },
    { ...base, id: "preview-offer-3", businessId: "__preview__", businessName: "The Daily Press", businessNeighborhood: "Downtown Norfolk", businessAbout: "Coffee bar and bakery. Preview business: simulation only.", title: "New menu shoot: paid visit", kind: "paid", cashRate: 150, paidMath: paidMath(150), paidBrief: "Feature the new fall menu: one reel at the bar, honest take.", spots: 2, applicationCount: 1, windowStartAt: iso(now + 3 * day), windowEndAt: iso(now + 10 * day), applicationsCloseAt: iso(now + 6 * day), visitWindow: "Before 11am" },
    { ...base, id: "preview-offer-4", businessId: "__preview__", businessName: "Salt & Ember Kitchen", businessNeighborhood: "Oceanfront", businessAbout: "Chef-driven restaurant on the Oceanfront. Preview business: simulation only.", title: "Brunch launch weekend", kind: "comp", whatComped: "Brunch for two with coffee", covers: 2, dollarCap: 60, includes: "Two brunch plates, coffee or juice", experience: "First weekend of the new brunch menu", spots: 3, filledCount: 2, applicationCount: 5, windowStartAt: iso(now + 4 * day), windowEndAt: iso(now + 11 * day), applicationsCloseAt: iso(now + 7 * day), visitWindow: "Saturday or Sunday" },
  ];
}


const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// ---------- The Standard Visit (Jeff, 2026-10-19) ----------
// The comped package, identical for every creator and every business,
// so a comped selection is never a negotiation: the creator posts
// within 48 hours of the visit and the post stays live at least 30
// days. Deliverables (Jeff, 2026-10-25): a comped visit is 1 post or
// reel + 1 story that shares the post. PAID bookings are negotiated,
// so their deliverables are set in the booking's own terms, never by
// this package. What the
// business may DO with the post follows the VISIT, never the plan
// (rights model adopted by Jeff, 2026-10-21; see
// visitRightsForVisit): a comp visit is native sharing only, with no
// downloads, no reposting the file, and no ad use, ever; a paid
// visit (the creator's own listed rate, a 6% service fee split 3% to
// the business and 3% to the creator) includes the one standard
// license: repost rights and ad use for 90 days from the post date,
// never perpetuity. A comped post can earn the same 90-day license
// when the creator grants a license request at their listed
// licensing fee (license standard locked by Jeff, 2026-10-26).
// The creator always owns their content, and nobody, on any visit,
// edits it. This object is the single source of
// truth: it ships in bootstrap, on public profiles, on discovery
// cards, in the offer composer, and in the creator's offer checklist.
const STANDARD_VISIT = {
  name: "The Standard Visit",
  postWithinHours: 48,
  deliverables: ["1 post or reel", "1 story that shares the post"],
  postStaysLiveDays: 30,
  creatorDoes: "Show up, enjoy the comp, and post within 48 hours of the visit: 1 post or reel + 1 story that shares the post. Honest opinion, comp disclosed.",
  businessGets: [
    "The post, tracked and proven in the dashboard",
    "The post stays live on the creator's profile for at least 30 days",
  ],
  summary:
    "Every SIGNL comped visit includes: 1 post or reel + 1 story that shares the post, within 48 hours of the visit, honest and disclosed, live at least 30 days, with tracked delivery proof. 48 hours is the standard creators are held to; a post inside one week still counts, as a late delivery. Paid bookings carry the deliverables set in the booking's own terms. Content rights follow the visit, never the plan: on a comp visit the business may share the post natively only, with the creator tagged; no downloads, no reposting the file, no ad use. On a paid visit the business may also repost the post and run it as an ad for 90 days from the post date, under the one standard license every paid booking includes. A comped post can be licensed the same way, for 90 days, at the creator's listed licensing fee and only with their approval. The creator always owns their content, and nobody can edit it.",
};

// ---------- The paid lane (Jeff, 2026-10-19) ----------
// Two lanes, one roster. The comp visit stays the default driver.
// A Paid Visit books a specific creator at their own listed rate;
// its deliverables are negotiated and set in the booking's terms.
// The platform fee is 6% of the
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
// V5 money discipline (Jeff, 2026-10-25), the server twin of the
// client's fmtMoney/fmtPrice: computed amounts and caps stated in
// sentences render with thousands separators + exactly two
// decimals (fmtMoneyS: $145.50); whole-dollar prices render clean
// (fmtPriceS: $150) and fall back to fmtMoneyS when a value
// actually carries cents. No server string ever emits a single
// decimal or a dropped trailing zero again.
function fmtMoneyS(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "n/a";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPriceS(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "n/a";
  const v = Number(n);
  if (Math.round(v * 100) / 100 === Math.round(v)) return Math.round(v).toLocaleString("en-US");
  return fmtMoneyS(v);
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
  return "Booked visit windows expired unused. The account is paused pending a SIGNL review.";
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
    ? "Your account is paused pending a SIGNL review after booked visit windows expired unused. The team reviews every pause by hand; questions: hello@joinsignl.com."
    : "Your account is paused until the late post from your last visit is checked off. Paste the post link under My Visits and offers open again.";
}

// The plain-language line a creator sees about their own strikes.
// AB1 (UX redesign, 2026-10-24): the internal ladder stays internal.
// The line states the count and the plain consequence, never the
// threshold that pauses the account.
function strikeStatusLine(user) {
  const n = noShowStrikesOf(user);
  if (!n) return null;
  return `Visit strikes: ${n}. Letting a booked visit window expire unused counts as a strike, and strikes can pause your account for review.`;
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
  Locals: { floor: 50, typicalLow: 75, typicalHigh: 250 },
  Headliners: { floor: 100, typicalLow: 250, typicalHigh: 750 },
};
const SELECTION_SLA_HOURS = 72;
const BACKFILL_ACCEPT_HOURS = 24;
const OFFER_NUDGE_HOURS = 48;
const APPLICATION_STACK_PER_SPOT = 3;
// Menu of Moments (Build -32, Jeff, 2026-10-29): the moment a
// business is booking for, asked in the offer flow and on the
// founding application, stored on the record. Packaging only:
// each moment names the play the First Month Plan frames itself
// as. No new offer machinery rides on this field.
const MOMENTS = [
  { id: "slow_weeknight", label: "A slow weeknight", play: "The Slow Tuesday Fix" },
  { id: "new_menu_drop", label: "A new menu or launch drop", play: "The First Taste" },
  { id: "reopening", label: "A reopening", play: "The Grand Reopening" },
  { id: "game_day", label: "Game day", play: "The Game Day Play" },
  { id: "tourist_weekend", label: "A tourist weekend", play: "The Tourist Weekend" },
  { id: "other", label: "Something else", play: "The First Month Play" },
];
function validMoment(v) {
  return MOMENTS.some((m) => m.id === v) ? v : null;
}
function momentPlay(id) {
  const m = MOMENTS.find((x) => x.id === id);
  return m ? m.play : null;
}

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

// Milestone fan-out (UX teardown, 2026-10-24): the visit loop's
// state changes were silent for the other side. A business heard
// nothing when a creator accepted its offer; a creator heard
// nothing when their code was redeemed and the 48 hour clock
// started; proof, verification, ratings, performance reports and
// paid bookings all landed with no signal at all. Jeff's harness
// run proved it end to end: across the full loop the creator got
// exactly one in-app note (offer_received) and the business got
// zero, and no milestone email fired past approval. A milestone
// now writes BOTH an in-app notification and an email through the
// same deliverEmail transport as every other lifecycle email, so
// the Admin event log shows each one fire. Email stays
// best-effort, exactly like the rest of the lifecycle mail.
async function notifyMilestone(userId, kind, noteText, subject, mailText, data = {}) {
  await notifyUser(userId, kind, noteText, data);
  try {
    const u = await store.get(`user:${userId}`);
    if (u && u.email) await deliverEmail(kind, u, subject, mailText, null);
  } catch (e) { /* best-effort; the in-app note is the guaranteed record */ }
}

function milestoneDeadlineText(iso) {
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
  } catch (e) { return String(iso || ""); }
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
  // Clean window times (UX redesign section 6, 2026-10-24): window
  // start and end sit on the hour, never on the publish minute, so
  // cards never show artifacts like "1:55 PM to 12:55 PM". Zero the
  // minutes/seconds/ms; if that would pull the start before
  // applications close, step forward to the next clean hour.
  const startDate = new Date(startMs);
  startDate.setUTCMinutes(0, 0, 0);
  startMs = startDate.getTime();
  if (startMs < applicationsCloseMs) startMs += 3600 * 1000;
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
  let estimatedRegisterValue = 0;
  let estimateUses = 0;
  let estimateTickets = new Set();
  let mediaValue = 0;
  let compCost = 0;
  let discountCost = 0;
  let planAllocation = 0;
  let planKnown = bookings.length > 0;
  let redemptionCount = 0;
  let basketTotalAll = 0;
  for (const b of bookings) {
    const red = b.redemptions || null;
    // Code-use estimate (UX redesign section 4, 2026-10-24): a
    // booking with NO register tally but with logged code uses
    // contributes an ESTIMATE, code uses times the business's
    // average ticket, kept apart from the tracked registerValue
    // (which stays the floor). The moment a tally exists for the
    // booking, the actual replaces the estimate for it entirely.
    if (!red) {
      const uses = Math.max(0, Math.floor(Number(b.codeUseCount) || 0));
      const ticket = typeof b.avgTicket === "number" && Number.isFinite(b.avgTicket) && b.avgTicket > 0 ? b.avgTicket : null;
      if (uses > 0 && ticket !== null) {
        estimatedRegisterValue += uses * ticket;
        estimateUses += uses;
        estimateTickets.add(ticket);
      }
    }
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
  estimatedRegisterValue = roasRound2(estimatedRegisterValue);
  mediaValue = roasRound2(mediaValue);
  compCost = roasRound2(compCost);
  discountCost = roasRound2(discountCost);
  planAllocation = roasRound2(planAllocation);
  const value = roasRound2(registerValue + estimatedRegisterValue + mediaValue);
  const costTotal = roasRound2(compCost + discountCost);
  const score = costTotal > 0 ? roasRound2(value / costTotal) : null;
  const allInScore = planKnown && roasRound2(costTotal + planAllocation) > 0 ? roasRound2(value / (costTotal + planAllocation)) : null;
  const registerSource = registerValue > 0 && estimatedRegisterValue > 0 ? "mixed" : registerValue > 0 ? "tracked" : estimatedRegisterValue > 0 ? "estimated" : "none";
  return {
    label: ROAS_LABEL,
    value,
    registerValue,
    estimatedRegisterValue,
    registerSource,
    registerEstimate: {
      uses: estimateUses,
      avgTicket: estimateTickets.size === 1 ? [...estimateTickets][0] : null,
      value: estimatedRegisterValue,
    },
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

// Code-use estimate inputs (UX redesign section 4, 2026-10-24):
// roasFor prices an estimate only when a booking carries BOTH a
// codeUseCount and the business's average ticket. This helper loads
// each distinct business once and stamps avgTicket (null when the
// business never set one, or is missing) plus a defaulted
// codeUseCount onto booking-shaped objects, in place. Preview and
// fixture paths pass objects whose businessId resolves to nothing:
// they simply get avgTicket null and no estimate, never a crash.
async function enrichRoasEstimateInputs(bookings) {
  const cache = new Map();
  for (const b of bookings) {
    if (!b || typeof b !== "object") continue;
    if (typeof b.codeUseCount !== "number" || !Number.isFinite(b.codeUseCount)) b.codeUseCount = Math.max(0, Math.floor(Number(b.codeUseCount) || 0));
    if (!b.businessId) { if (b.avgTicket === undefined) b.avgTicket = null; continue; }
    if (!cache.has(b.businessId)) {
      const bizUser = await store.get(`user:${b.businessId}`);
      const ticket = bizUser && bizUser.business ? bizUser.business.averageTicket : null;
      cache.set(b.businessId, typeof ticket === "number" && Number.isFinite(ticket) && ticket > 0 ? ticket : null);
    }
    b.avgTicket = cache.get(b.businessId);
  }
  return bookings;
}

// The rights a business holds over a delivered post, by VISIT TYPE
// (rights model adopted by Jeff, 2026-10-21; it supersedes the
// plan-based ladder of 2026-10-19). A comp visit gives the business
// native sharing only: no downloads, no reposting the file, no ad
// use, ever, on every plan. A paid visit includes the one standard
// license (Jeff, 2026-10-26): repost rights and ad use for 90 days
// from the post date, never perpetuity. A comped post reaches the
// same license only through a granted license request at the
// creator's listed licensing fee; its 90 days run from the grant.
// The creator always owns their content. The creator sees exactly
// this, for the specific offer, BEFORE accepting: rights are never
// a surprise.
const LICENSE_WINDOW_DAYS = 90;
function adUseWindowEnd(post) {
  const d = new Date((post && (post.submittedAt || post.createdAt)) || Date.now());
  d.setDate(d.getDate() + LICENSE_WINDOW_DAYS);
  return d;
}
function licenseWindowEnd(fromMs) {
  return new Date(fromMs + LICENSE_WINDOW_DAYS * DAY_MS);
}
function visitRightsForVisit(kind) {
  if (kind === "paid") {
    return {
      basis: "paid",
      can: ["Share your post natively, with you tagged", "Repost it on their own feed", "Run it as an ad for 90 days from the post date (never longer)"],
      cannot: ["Edit your post", "Use it in ads after the 90-day window"],
      adUse: true,
      licenseDays: LICENSE_WINDOW_DAYS,
    };
  }
  return {
    basis: "comp",
    can: ["Share your post natively, with you tagged"],
    cannot: ["Edit it", "Download it or post it as their own content", "Run it as an ad"],
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
  // Snapchat (Jeff, 2026-10-22): count-only. Dubai and younger
  // talent run Snapchat-first audiences, so the count stacks and
  // tiers like every other platform, but there is deliberately NO
  // Snapchat handle or profile-URL field anywhere: Snapchat has no
  // public profile pattern in our system.
  { id: "snapchat", label: "Snapchat" },
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

// ---------- Primary platform (Jeff, 2026-10-22) ----------
// Instagram was the assumed front door: the quick claim asked for
// an Instagram handle, period, and the creator's identity keyed
// off it. A creator's MAIN audience may live elsewhere, so signup
// now opens with a picker ("Where is your main audience?") and the
// handle is collected for the picked platform. The identity key
// stays the handle string (/c/<handle>, referral links, claim
// links, auto-decision evidence), unchanged. Records written
// before the picker carry no primaryPlatform and read as
// "instagram" everywhere (backfill on read, never a migration).
const PRIMARY_PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
];

function normalizePrimaryPlatform(raw) {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return PRIMARY_PLATFORMS.some((p) => p.id === s) ? s : "instagram";
}

// Handle normalization (Jeff, 2026-10-26): a creator may type a
// bare handle, an @handle, or paste a whole profile link
// (instagram.com/foo, https://www.tiktok.com/@foo/, x.com/foo).
// Every intake path stores the SAME clean handle, so the profile
// URLs built from it (primaryPlatformUrl) always point at the
// creator's real page, the one an admin or a business opens to
// verify it is them. A pasted URL keeps its LAST path segment:
// that is the handle on every supported platform, LinkedIn's
// /in/<handle> included.
function normalizeHandle(raw) {
  let h = String(raw == null ? "" : raw).trim();
  if (!h) return "";
  if (h.includes("/")) {
    h = h.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    const parts = h.split(/[/?#]/).map((x) => x.trim()).filter(Boolean);
    h = parts.length ? parts[parts.length - 1] : "";
  }
  return h.replace(/^@/, "").trim();
}

function primaryPlatformOf(creator) {
  const c = creator || {};
  return PRIMARY_PLATFORMS.some((p) => p.id === c.primaryPlatform) ? c.primaryPlatform : "instagram";
}

function primaryPlatformLabel(platform) {
  const meta = PRIMARY_PLATFORMS.find((p) => p.id === platform);
  return meta ? meta.label : "Instagram";
}

function primaryPlatformUrl(platform, handle) {
  const h = String(handle || "").replace(/^@/, "").trim();
  if (!h) return null;
  switch (platform) {
    case "tiktok": return `https://www.tiktok.com/@${h}`;
    case "youtube": return `https://www.youtube.com/@${h}`;
    case "facebook": return `https://www.facebook.com/${h}`;
    case "x": return `https://x.com/${h}`;
    case "linkedin": return `https://www.linkedin.com/in/${h}`;
    default: return `https://instagram.com/${h}`;
  }
}

// The one profile link every surface points at: the creator's
// primary platform profile. IG-primary (including every legacy
// record) resolves to the stored instagramUrl exactly as before.
function primaryProfileOf(creator) {
  const c = creator || {};
  const platform = primaryPlatformOf(c);
  let url = null;
  if (platform === "instagram") {
    url = c.instagramUrl || primaryPlatformUrl(platform, c.handle);
  } else {
    url = c.primaryProfileUrl || primaryPlatformUrl(platform, c.handle);
  }
  return { platform, label: primaryPlatformLabel(platform), url };
}

// Display/payload shape: total plus the per-platform breakdown,
// biggest first, only platforms the creator actually reported.
// A platform with a live Connect Accounts mirror on the record
// (creator.platformSync, written only by a real provider fetch)
// carries synced + syncedAt so business surfaces can show the
// Synced mark; every other entry stays unlabeled, which every
// surface reads as Self-reported. Records with no connection carry
// no platformSync and this output is byte-identical to before.
function audienceView(creator) {
  const stack = audienceStackOf(creator);
  const sync = (creator && creator.platformSync) || {};
  const platforms = AUDIENCE_PLATFORMS
    .filter((p) => stack[p.id])
    .map((p) => (sync[p.id] && sync[p.id].verified === true
      ? { platform: p.id, label: p.label, count: stack[p.id], synced: true, syncedAt: sync[p.id].lastSyncAt || null }
      : { platform: p.id, label: p.label, count: stack[p.id] }))
    .sort((a, b) => b.count - a.count);
  return { total: platforms.reduce((s, p) => s + p.count, 0), platforms };
}

// ---------- Connect Accounts: audience sync writes ----------
// A provider fetch produced a count for one connected platform.
// The synced value REPLACES that platform's stack entry (it is
// authoritative over anything typed), then total, followerCount
// mirror and the automatic tier band recompute exactly as they do
// on a profile save. The display mirror (platformSync) is stamped
// in the same write so no payload can show a Synced mark for a
// count the stack does not hold.
async function applySyncedAudienceCount(userId, conn, count) {
  const record = await store.get(`user:${userId}`);
  if (!record || !record.creator) return null;
  const c = record.creator;
  const stack = audienceStackOf(c);
  const clean = Math.floor(Number(count));
  if (Number.isFinite(clean) && clean > 0) stack[conn.platform] = Math.min(AUDIENCE_COUNT_CAP, clean);
  else delete stack[conn.platform];
  c.audienceStack = stack;
  c.followerCount = stack.instagram || 0;
  c.totalAudience = Object.values(stack).reduce((s, n) => s + n, 0);
  c.computedTier = tierForFollowers(c.totalAudience);
  c.suggestedTier = c.computedTier;
  c.tierBand = c.computedTier;
  c.platformSync = c.platformSync || {};
  c.platformSync[conn.platform] = {
    lastSyncAt: conn.lastSyncAt || nowIso(),
    lastCount: stack[conn.platform] || 0,
    accountLabel: conn.accountLabel || null,
    verified: true,
    syncStatus: "ok",
  };
  record.updatedAt = nowIso();
  await store.set(`user:${userId}`, record);
  return record;
}

// The connected-but-not-verified mirror: the connection exists but
// the provider cannot supply the count (today: a YouTube channel
// that hides its subscriber count). The row must show the
// connection honestly while the count stays the creator's own
// typed number, so the mirror lands with verified: false and
// audienceView never marks it Synced.
async function stampPlatformSyncMirror(userId, conn) {
  const record = await store.get(`user:${userId}`);
  if (!record || !record.creator) return null;
  const c = record.creator;
  c.platformSync = c.platformSync || {};
  c.platformSync[conn.platform] = {
    lastSyncAt: conn.lastSyncAt || nowIso(),
    lastCount: (c.audienceStack && c.audienceStack[conn.platform]) || conn.lastCount || 0,
    accountLabel: conn.accountLabel || null,
    verified: false,
    syncStatus: conn.lastSyncStatus || null,
  };
  record.updatedAt = nowIso();
  await store.set(`user:${userId}`, record);
  return record;
}

// Disconnect: the connection record is deleted by the caller; here
// the display mirror comes off the creator record. The last synced
// count STAYS in the stack as the creator's own number, editable
// again and Self-reported from this moment (that is the deal the
// disconnect copy states).
async function clearPlatformSyncMirror(userId, platform) {
  const record = await store.get(`user:${userId}`);
  if (!record || !record.creator) return null;
  if (record.creator.platformSync) {
    delete record.creator.platformSync[platform];
    record.updatedAt = nowIso();
    await store.set(`user:${userId}`, record);
  }
  return record;
}

// One connection, one sync attempt. The provider module persists
// the fresh count on the connection record; on success the count
// is applied to the creator record in the same pass.
async function syncYouTubeForConnection(conn) {
  const res = await platformConnect.fetchYouTubeSubscriberCount(conn);
  const fresh = (await platformConnect.getConnection(conn.userId, conn.platform)) || conn;
  if (res.status !== "ok") {
    // "hidden" is a permanent property of the channel, so the
    // mirror is re-stamped unverified and the count stays typed.
    // A plain provider "error" is transient: the last synced
    // count (and its verified mark) stands untouched.
    if (res.status === "hidden") await stampPlatformSyncMirror(conn.userId, fresh);
    return { ok: false, status: res.status };
  }
  await applySyncedAudienceCount(conn.userId, fresh, res.count);
  return { ok: true, status: "ok", count: res.count };
}

// The daily audience pass behind POST /api/admin/metrics/sync:
// walk every stored connection and sync each one. YouTube is the
// only live provider today; other platforms join this walk when
// their gates open, and the summary says what actually happened.
async function syncAllConnectedAudiences() {
  const conns = await platformConnect.listAllConnections();
  let synced = 0;
  let failed = 0;
  for (const conn of conns) {
    if (!conn || conn.platform !== "youtube") continue;
    try {
      const r = await syncYouTubeForConnection(conn);
      if (r.ok) synced += 1;
      else failed += 1;
    } catch (e) {
      failed += 1;
    }
  }
  return { providers: ["youtube"], connections: conns.length, synced, failed };
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
  "north carolina state university at raleigh": "NC State University",
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

function universityKey(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase().replace(/&/g, " and ").replace(/\./g, "").replace(/\s+/g, " ");
}

// Dataset-driven university resolution (Jeff, 2026-10-21): the
// bundled IPEDS institution directory (US Dept of Education, the
// College Scorecard source data; scripts/build-colleges.mjs) is
// the canonical list. A submitted value resolves, in order: the
// shipped alias map (our launch-market canonicals, so records
// from the 16-school era keep their stored names and cohorts),
// an exact dataset name, then a dataset alias. A hit stores the
// canonical name plus the dataset city/state and counts as
// verified. A miss is free entry: stored as typed and flagged
// universityUnverified so admin can see it was never matched.
let collegesCache = null;
function collegesData() {
  if (collegesCache) return collegesCache;
  let list = [];
  try { list = require("./us-colleges.json"); } catch (e) { list = []; }
  const byName = new Map();
  const byAlias = new Map();
  const byCanonical = new Map();
  for (const rec of Array.isArray(list) ? list : []) {
    byName.set(universityKey(rec.n), rec);
    for (const a of rec.a || []) {
      const k = universityKey(a);
      if (k && !byAlias.has(k)) byAlias.set(k, rec);
    }
    byCanonical.set(normalizeUniversity(rec.n), rec);
  }
  collegesCache = { list: Array.isArray(list) ? list : [], byName, byAlias, byCanonical };
  return collegesCache;
}

function resolveUniversity(value) {
  const clean = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 160) : "";
  if (!clean) return { name: "", verified: false, city: "", state: "" };
  const data = collegesData();
  const key = universityKey(clean);
  const aliasHit = UNIVERSITY_ALIASES[key];
  if (aliasHit) {
    const rec = data.byCanonical.get(aliasHit) || data.byName.get(universityKey(aliasHit));
    return { name: aliasHit, verified: true, city: rec ? rec.c : "", state: rec ? rec.s : "" };
  }
  const byName = data.byName.get(key);
  if (byName) return { name: byName.n, verified: true, city: byName.c, state: byName.s };
  const byAlias = data.byAlias.get(key);
  if (byAlias) return { name: normalizeUniversity(byAlias.n), verified: true, city: byAlias.c, state: byAlias.s };
  return { name: clean.slice(0, 120), verified: false, city: "", state: "" };
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

// Student status gate (Jeff, 2026-10-21): the campus badge is for
// CURRENT students only. The status is captured beside the
// university field, stored normalized on the user record and the
// creator profile (kept in sync like the university itself), and
// the badge computation reads it: university set AND status
// current_student earns the badge; alumni, not-a-student, and
// unset statuses earn none.
const UNIVERSITY_STATUSES = ["current_student", "alumni", "not_student"];
const UNIVERSITY_STATUS_LABELS = { current_student: "Current student", alumni: "Alumni", not_student: "Not a student" };

function normalizeUniversityStatus(value) {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["current_student", "current", "student"].includes(key)) return "current_student";
  if (["alumni", "alumnus", "alumna", "graduate"].includes(key)) return "alumni";
  if (["not_student", "not_a_student", "not", "none", "no"].includes(key)) return "not_student";
  return "";
}

function universityStatusOfRecord(user) {
  if (!user) return "";
  return normalizeUniversityStatus((user.creator && user.creator.universityStatus) || user.universityStatus || "");
}

function universityStatusLabel(status) {
  return UNIVERSITY_STATUS_LABELS[normalizeUniversityStatus(status)] || "";
}

function campusBadgeFor(user) {
  const university = universityOfRecord(user);
  if (!university) return null;
  return universityStatusOfRecord(user) === "current_student" ? `Campus: ${university}` : null;
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
  if (!name) return null;
  const canonical = normalizeMarketName(name);
  return MARKETS.find((m) => m.name === canonical || m.id === name) || null;
}

// Typed-city resolution (Jeff, 2026-10-23): a not-listed sign-up
// types a hometown that may already belong to a market's published
// city list (Portsmouth is a Virginia Beach market city). Run the
// resolver over the record's typed city with its state/country as
// hints and apply the outcome in place:
//   unique    - file the record under the metro (market replaced),
//               keep the typed city as the home city, and stamp
//               marketResolvedFrom/marketResolvedCity so the
//               pending screen can say why.
//   ambiguous - stay Not listed yet; store the candidate metros
//               (marketCandidates) so the person can pick with one
//               tap and admin can see the tie.
//   none      - stay Not listed yet; the typed city remains the
//               demand signal, and any stale resolution stamps go.
// New intakes call this at registration; existing records are
// NEVER moved by it silently - the only other callers are the
// person's own pending market fix / profile save, and admin's
// suggestion is applied solely through the file-market endpoint
// behind Jeff's tap.
function applyTypedCityResolution(user, typedCity) {
  const res = resolveTypedCity(typedCity || "", { state: user.state, country: user.country });
  if (res.status === "unique") {
    user.market = res.market;
    user.marketResolvedFrom = "typed_city";
    user.marketResolvedCity = res.city;
    delete user.marketCandidates;
  } else if (res.status === "ambiguous") {
    delete user.marketResolvedFrom;
    delete user.marketResolvedCity;
    user.marketCandidates = res.markets;
  } else {
    delete user.marketResolvedFrom;
    delete user.marketResolvedCity;
    delete user.marketCandidates;
  }
  return res;
}

function planById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

// ---------- Plan visit allowance + rollover (Jeff, 2026-10-26) ----------
// The server-side allowance counter for a business's plan visits.
// A "used" visit is a comp booking created in the month (paid
// bookings are a per-visit purchase on top and never consume the
// allowance; see the paid lane). ROLLOVER: visits the business did
// not use out of a month's BASE allowance roll into the next month
// and expire at the end of that month. Rolled visits never roll a
// second time, so the carry into any month is just the previous
// month's unused base, consumption is counted against the base
// first, and the allowance can never exceed base + one month of
// carry. Calendar months, matching the business home's cycle.
// History is read against the CURRENT plan's base (a plan change
// re-bases the allowance; there is no per-plan ledger). Months
// before the business's first booking contribute nothing.
function planAllowanceFor(bookings, plan, nowMs) {
  const base = plan ? plan.visitsPerMonth : 0;
  const now = new Date(nowMs);
  const curKey = now.getFullYear() * 12 + now.getMonth();
  const counts = new Map();
  let earliest = null;
  for (const b of bookings || []) {
    if (!b || b.kind === "paid") continue;
    const t = Date.parse(b.createdAt);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    const k = d.getFullYear() * 12 + d.getMonth();
    counts.set(k, (counts.get(k) || 0) + 1);
    if (earliest === null || k < earliest) earliest = k;
  }
  const used = counts.get(curKey) || 0;
  let carried = 0;
  if (earliest !== null && earliest < curKey) {
    carried = Math.max(0, base - Math.min(counts.get(curKey - 1) || 0, base));
  }
  const allowance = base + carried;
  return {
    base,
    carried,
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    // Rolled visits on the current allowance lapse when this month ends.
    carriedExpiresAt: carried > 0 ? new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() : null,
  };
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

// Founding launch bar (creator excitement layer, Jeff, 2026-10-29):
// the finished-profile count a market's founding roster is built
// to before businesses open there (the 25 to 30 finished-creator
// gate the launch plan runs on, stated at its floor). The city
// unlock meter on the creator founding home reads this number;
// it is a planning bar shown honestly as progress, not a promise
// that a market opens the day the count lands.
const FOUNDING_LAUNCH_BAR = 25;


// Neighborhood Anchor (Build -32, Jeff, 2026-10-29): the FIRST
// founding business in a category + neighborhood earns a
// permanent badge, "Founding Anchor" for that category and
// neighborhood. Computed from application order (createdAt)
// across business accounts; the stamp, once written, never
// moves and is never taken away. There is NO lockout: every
// other business joins normally, and nothing in any copy may
// imply exclusivity. A business only competes for the badge
// once it has both a category and a neighborhood on its record.
async function ensureBusinessAnchors(users) {
  const list = (users || []).filter((u) => u && u.role === "business" && u.business && u.status !== "rejected"
    && String(u.business.category || "").trim() && String(u.business.neighborhood || "").trim());
  const groups = new Map();
  for (const u of list) {
    const key = [normalizeMarketName(u.market || ""), String(u.business.category).trim().toLowerCase(), String(u.business.neighborhood).trim().toLowerCase()].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const first = group[0];
    if (first && !first.business.anchor) {
      first.business = Object.assign({}, first.business, {
        anchor: {
          category: first.business.category,
          neighborhood: first.business.neighborhood,
          label: `Founding Anchor \u2014 ${first.business.category}, ${first.business.neighborhood}`,
          at: nowIso(),
        },
      });
      try { await store.set(`user:${first.id}`, first); } catch (e) { /* the badge recomputes on the next read */ }
    }
  }
}

const FOUNDING_BUSINESS_MESSAGE = "Your business is on the founding list, so the creator roster and the product tools are not open yet. Every founding application gets a decision or a clear status within 2 business days. Your Founding Status page shows your plan, your place in line, and what happens next.";

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, passwordSalt, ...rest } = u;
  // Internal decision markers (standing-authority auto-decisions,
  // 2026-10-22) are server-side only: they never ride any client
  // payload. Admin surfaces re-add what they need from the raw
  // record behind admin auth.
  if (typeof rest.market === "string") rest.market = normalizeMarketName(rest.market);
  delete rest.approvedBy;
  delete rest.decisionReason;
  delete rest.decisionNote;
  delete rest.rejectionReason;
  if (rest.role === "business" && rest.business) {
    rest.business = { ...rest.business, accessState: businessAccessState(rest) };
    delete rest.business.paymentLink;
    // Stripe Connect (2026-10-26): the raw billing record carries
    // Stripe ids (customer, payment method). Client payloads get
    // the display shape only: a card brand + last4, never an id.
    if (rest.business.billing) {
      const card = rest.business.billing.card || null;
      rest.business.billing = {
        card: card ? { brand: card.brand || "card", last4: card.last4 || "----", expMonth: card.expMonth || null, expYear: card.expYear || null } : null,
      };
    }
  }
  if (rest.role === "creator" && rest.creator) {
    rest.creator = { ...rest.creator };
    // Same rule for payouts: the client sees the plain state
    // (status, ready, what's missing in plain words), never the
    // connected account id.
    const p = rest.creator.payouts || null;
    rest.creator.payouts = {
      status: p && p.status ? p.status : "not_started",
      ready: !!(p && p.ready),
      missing: p && Array.isArray(p.missing) ? p.missing : [],
      updatedAt: p && p.updatedAt ? p.updatedAt : null,
    };
  }
  if (rest.role === "partner" && rest.partner) {
    rest.partner = publicPartner(rest.partner);
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
  try {
    const rec = await store.get("config:markets");
    return (rec && rec.flags) || {};
  } catch (e) {
    // A store failure must not 500 the public bootstrap (its handler
    // reads this via marketLiveMap): degrade to "no markets live",
    // the founding state. See INCIDENT-2026-10-25.md.
    console.error("SIGNL getMarketFlags failed (treating all markets as not live):", e);
    return {};
  }
}

async function isMarketLive(marketName) {
  if (TEST_MODE) return true;
  if (!marketName) return false;
  const flags = await getMarketFlags();
  return !!flags[normalizeMarketName(marketName)];
}

// The launch fact itself, without the TEST_MODE override: has
// this market's live flag actually been set? Used where the
// record matters (the Charter stamp), not for display gating.
async function marketLaunchedByFlag(marketName) {
  if (!marketName) return false;
  const flags = await getMarketFlags();
  return !!flags[normalizeMarketName(marketName)];
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
    const key = c.market === UNLISTED ? `${c.city || ""}, ${c.country || c.state || ""}` : normalizeMarketName(c.market);
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
    const blank = { signups: 0, approvedReferrals: 0, milestones: blankMilestones, badges: [], next: null, elite: { qualified: false, onTimePosts: 0, ratingAvg: null, ratingCount: 0 }, campusLead: null };
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
    const campusLead = campusLeadFor(user);
    if (campusLead && campusLead.qualified) badges.push({ id: "campus_lead", name: "Campus Lead", kind: "campus", university: campusLead.university });
    return {
      signups: rec.signups,
      approvedReferrals: approvedList.length,
      milestones,
      badges,
      next,
      elite: { qualified, onTimePosts, ratingAvg: rating.ratingAvg, ratingCount: rating.ratingCount },
      campusLead,
    };
  }
  // Campus Lead (university layers U2, Jeff, 2026-10-28): a
  // per-school status riding the referral ladder's own rails.
  // A CURRENT student whose credited approved referrals (the
  // ladder's own list: approved, non-tester, self-referrals out)
  // include CAMPUS_LEAD_THRESHOLD or more CURRENT students at
  // the SAME university is that school's Campus Lead. Computed
  // on read like every ladder fact, never stored, and worth NO
  // Momentum points and no ledger entry: the same referrals
  // already earn the standard +3/+10 and count toward the
  // ordinary milestones, so the status itself is the reward.
  // Both sides must be current students; an alumnus referrer or
  // an alumnus referral never counts.
  const CAMPUS_LEAD_THRESHOLD = 5;
  function campusLeadFor(user) {
    if (!user || user.role !== "creator" || !user.creator) return null;
    const university = universityOfRecord(user);
    if (!university || universityStatusOfRecord(user) !== "current_student") return null;
    const count = approvedReferralList(user).filter((ref) => universityStatusOfRecord(ref) === "current_student" && sameUniversity(universityOfRecord(ref), university)).length;
    return { qualified: count >= CAMPUS_LEAD_THRESHOLD, university, count, needed: Math.max(0, CAMPUS_LEAD_THRESHOLD - count), threshold: CAMPUS_LEAD_THRESHOLD };
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
    const empty = { signups: 0, approved: 0, points: 0, ledger: [], checklist: [], floorApplied: false, campusCrew: null, campusLead: null };
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
    // Ad use (Jeff, 2026-10-19; rights model 2026-10-21): a business
    // running a paid visit's delivered post as an ad is a real
    // outcome for the creator: +25 per declared post, straight from
    // the stored declaration.
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

    // Deep-link targets for the two state-dependent earn rows
    // (Jeff, 2026-10-27): the client links a row only when its
    // action can be completed right now, so the payload names the
    // visit that completes it: the oldest completed visit still
    // missing its review, and the oldest post whose numbers were
    // asked for and not yet reported. Absent when nothing is due,
    // and the row then stays plain text.
    const reviewedBookingIds = new Set(myBizReviews.map((r) => r.bookingId).filter(Boolean));
    const reviewDueBooking = myBookings.find((b) => b.status === "completed" && !reviewedBookingIds.has(b.id));
    const perfDuePost = myPosts.find((p) => p.performanceRequestedAt && !p.reportedAt);

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
      { id: "reviews", label: "Review a business after a completed visit (+10 each, any star rating)", points: MOMENTUM_POINTS.reviewGiven, done: myBizReviews.length > 0, detail: `${myBizReviews.length} reviewed`, ...(reviewDueBooking ? { dueBookingId: reviewDueBooking.id } : {}) },
      { id: "aduse", label: "Have a paid-visit post run as an ad by the business (+25 each)", points: MOMENTUM_POINTS.adUse, done: myPosts.some((p) => p.adUseDeclaredAt), detail: `${myPosts.filter((p) => p.adUseDeclaredAt).length} posts ran as ads` },
      { id: "performance", label: "Report a post's views and likes when asked, 7 days after posting (+5 each)", points: MOMENTUM_POINTS.performanceReport, done: myPosts.some((p) => p.reportedAt), detail: `${myPosts.filter((p) => p.reportedAt).length} posts reported`, ...(perfDuePost ? { dueBookingId: perfDuePost.bookingId } : {}) },
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
      campusLead: campusLeadFor(user),
    };
  }

  function summaryFor(user) {
    const d = detailFor(user);
    return { signups: d.signups, approved: d.approved, points: d.points, campusCrew: d.campusCrew, campusLead: d.campusLead };
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
  const inMarket = users.filter((u) => u.role === "creator" && normalizeMarketName(u.market) === normalizeMarketName(user.market));
  return {
    market: normalizeMarketName(user.market),
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

// Creator excitement layer (Jeff, 2026-10-29): the numbers a
// founding creator's home celebrates with, computed live from
// stored records only. Two pieces:
//   localRank: the creator's rank in their market BY LOCAL REACH
//     (the ordering SIGNL sells), among approved, profile-complete
//     creators who have reported a local %. Ties break by founding
//     order (earliest sign-up first), the platform's standing
//     fairness rule. Null until the creator is approved, complete,
//     and has a local % on file: there is no rank to show before
//     the profile businesses would rank exists.
//   unlock: the market's founding progress toward the launch bar:
//     approved count, finished-profile count, the bar, and the
//     live flag. The counts ride the payload because the meter's
//     bar and its percentage gate are computed from them, but the
//     client renders them qualitatively while a market is small
//     (Jeff, BUILD -30, 2026-10-29: low raw counts discourage;
//     a percentage of the founding goal may show only once the
//     finished count reaches double digits). Unlisted markets
//     get no meter: their creators share one stored label across
//     many cities, so a single count would mix cities and
//     mislead.
//   charter: Charter Creator status (Jeff, BUILD -30,
//     2026-10-29). A named founding class, never a numbered one:
//     a creator who is approved with a finished profile BEFORE
//     their market launches holds Charter status permanently.
//     The moment eligibility is first observed it is stamped on
//     the creator record (creator.charter + creator.charterAt),
//     so it survives the market opening and rides the record in
//     Admin payloads. No cohort count or sign-up sequence is
//     ever computed or exposed for it.
async function creatorBuzz(user) {
  const users = await allUsers();
  const inMarket = users.filter((x) => x.role === "creator" && !isTester(x) && normalizeMarketName(x.market) === normalizeMarketName(user.market));
  const approved = inMarket.filter((x) => x.status === "approved");
  const complete = approved.filter((x) => profileCompleteOf(x));
  const ranked = complete
    .filter((x) => x.creator && typeof x.creator.localAudiencePct === "number")
    .sort((a, b) => (b.creator.localAudiencePct - a.creator.localAudiencePct) || (a.createdAt < b.createdAt ? -1 : 1));
  const idx = ranked.findIndex((x) => x.id === user.id);
  const marketLive = await isMarketLive(user.market);
  let charter = null;
  const storedCharterAt = (user.creator && user.creator.charterAt) || null;
  if (storedCharterAt) {
    charter = { at: storedCharterAt };
  } else if (user.status === "approved" && profileCompleteOf(user) && !(await marketLaunchedByFlag(user.market))) {
    // The stamp turns on the market's actual launch record (the
    // flags), not the TEST_MODE display override in isMarketLive:
    // a creator who finished before the launch flag was set is
    // founding class, in every environment.
    const at = nowIso();
    const rec = await store.get(`user:${user.id}`);
    if (rec && rec.creator && !rec.creator.charterAt) {
      rec.creator.charter = true;
      rec.creator.charterAt = at;
      rec.updatedAt = at;
      await store.set(`user:${user.id}`, rec);
    }
    charter = { at };
  }
  return {
    localRank: idx > -1 ? { rank: idx + 1, field: ranked.length, localAudiencePct: ranked[idx].creator.localAudiencePct } : null,
    unlock: user.market === UNLISTED ? null : {
      approved: approved.length,
      complete: complete.length,
      launchBar: FOUNDING_LAUNCH_BAR,
      marketLive,
    },
    charter,
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
async function deliverEmail(kind, user, subject, text, band, opts) {
  const base = { kind, to: user.email, subject, band: band || null };
  await logEvent({ type: `${kind}_email_queued`, actorId: user.id, actorRole: user.role, subjectId: user.id, market: user.market || null, data: base });
  const result = await sendEmail({ to: user.email, subject, text, listUnsubscribe: !!(opts && opts.listUnsubscribe), profile: opts && opts.profile, fromMailbox: opts && opts.fromMailbox, replyTo: opts && opts.replyTo });
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
  return "One more thing, because you are in the Headliners tier (15k+ followers): you are also eligible for paid bookings. A paid booking is its own booking at your listed rate, and you keep 97% of it. A comped visit stays the experience itself, with no cash added to it. Headliners tier members are first in line for paid bookings when they open in your market.";
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
      "Jeff",
      "Founder, SIGNL",
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
    `What happens next: when you are approved, we email you again and your founding status page opens at app.joinsignl.com. ${marketTalkName(user.market)} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}, and founding creators get first pick of offers when it does.`,
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
    "Jeff",
    "Founder, SIGNL",
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
// the spot is claimed and the place in line is held; the profile
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
    if (band) lines.push(`You are in the first ${band} creators to sign up in ${user.city}. Founding spots are held in sign-up order, and that standing never expires.`);
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
  if (band) lines.push(`You are in the first ${band} creators to sign up in ${user.market}. Founding spots are held in sign-up order, and that standing never expires.`);
  lines.push(
    "",
    `What happens next: when you are approved, we email you again, and that is when you finish your profile: your home city, your audience counts, your local audience percentage, your categories, and the rest of what businesses see. A finished profile is what makes you visible to businesses, so the approval email is the one to act on. ${marketTalkName(user.market)} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}, and founding creators with finished profiles get first pick of offers when it does.`,
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
  const place = unlisted ? user.city : marketTalkName(user.market);
  const subject = "Finish your SIGNL profile to be launch-ready";
  const lines = [
    `Hi ${first},`,
    "",
    `You are approved as a Founding Creator in ${place}, and your founding spot is held in sign-up order. One step is still open: your profile is not finished yet, so businesses cannot see you and you cannot take offers.`,
    "",
    `Still to do: ${missing}.`,
    "Finishing takes a few minutes: sign in, open the Profile tab, and work down the checklist on your dashboard: https://app.joinsignl.com",
    "",
    ...completionChecklistLines(user),
    "",
    unlisted
      ? `We open new markets where creator sign-ups pile up, and when ${user.city} opens, founding creators with finished profiles go first.`
      : `${marketTalkName(user.market)} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}, and founding creators with finished profiles get first pick of every offer.`,
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
  // are held in sign-up order. Signs as Jeff, per the standing rule
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
    if (band) lines.push(`You are in the first ${band} to sign up in ${user.city}. Founding spots are held in sign-up order, and when ${user.city} opens, founding sign-ups are first in line for offers.`);
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
  if (band) lines.push(`You are in the first ${band} founding creators in ${user.market}. Founding spots are held in sign-up order, and founding creators are shown to businesses in that order.`);
  lines.push(
    ...finishLines(`${marketTalkName(user.market)} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}. The moment it opens, we email you again, and founding creators get first pick of every offer. Your local audience percentage is the number businesses look at first, so keep it honest and current.`),
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

// ---------- rejection email (audit F4, 2026-10-22) ----------
// A human rejection used to be silent: the approval email existed
// and no rejection email did, so a creator found out by signing in
// to a reasonless screen. Now a person-reviewed rejection emails
// the creator: honest and brief, not a fit for this round, the
// reason category when the admin picked one, and an invitation to
// apply again when their market expands. The categories are a
// fixed list (the admin UI offers exactly these); an unknown value
// reads as no reason given. Auto-decision rejections (test and
// spam records) never pass through the admin review handler and
// send NO email, exactly as before: silence there is by design.
const REJECTION_REASONS = ["Not local enough", "Audience too small for this wave", "Content not a fit", "Market not open yet", "Other"];
const REJECTION_REASON_LINES = {
  "Not local enough": "your audience is not local enough to your market yet",
  "Audience too small for this wave": "your audience is still small for this wave of the founding roster",
  "Content not a fit": "your content is not the fit this round of the roster is being built around",
  "Market not open yet": "your market is not open yet, and this round is for the markets opening first",
  "Other": "your profile did not meet the founding bar for this round",
};

function rejectionEmail(user, reason) {
  const first = greetingName(user);
  const subject = "Your founding application: not a fit for this round";
  const place = user.market === UNLISTED ? user.city : user.market;
  const reasonLine = REJECTION_REASONS.includes(reason) ? REJECTION_REASON_LINES[reason] : null;
  const lines = [
    `Hi ${first},`,
    "",
    `Thank you for applying to be a SIGNL Founding Creator in ${place}. Your application was reviewed by a person, and it is not a fit for this round.`,
  ];
  if (reasonLine) {
    lines.push("", `The honest reason: ${reasonLine}.`);
  } else {
    lines.push("", "This round is small on purpose: founding rosters start with the creators closest to the businesses opening first. That is about fit for this round, not about the quality of your work.");
  }
  lines.push(
    "",
    "Markets open in waves, and this is not a permanent no. You are welcome to apply again when your market expands, or sooner if your audience or your content changes.",
    "Think we got it wrong? Reply to this email and a person will look again.",
    "",
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
  const place = unlisted ? user.city : marketTalkName(user.market);
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
      : `${marketTalkName(user.market)} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}. The moment it opens, you hear from me.`,
    "",
    "National platforms sell reach. We sell regulars.",
    "",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com",
  ];
  return { subject, text: lines.join("\n") };
}

// Perf (2026-10-28): the route() preamble used to pay one store
// round trip per check below on EVERY /api/* request, sequentially.
// These module-level memos let a warm container skip the read once
// the answer is known: one-time jobs latch done forever (they never
// un-complete), and throttled sweeps re-check the store at most once
// a minute per container (their real throttles are 25-55 minutes, so
// a due sweep can start up to a minute late, never early, and the
// store-side claim still prevents double runs across containers).
let recruiterKitDone = false;
const SWEEP_MEMO_MS = 60 * 1000;
const sweepMemoAt = Object.create(null);
function sweepMemoFresh(key) {
  return Date.now() - (sweepMemoAt[key] || 0) < SWEEP_MEMO_MS;
}

async function maybeSendRecruiterKit() {
  if (recruiterKitDone) return;
  const existing = await store.get(RECRUITER_KIT_FLAG_KEY);
  if (existing) { recruiterKitDone = true; return; }
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
  recruiterKitDone = true;
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
  const mapped = list
    .map((x) => String(x).trim())
    // With an allowed list, each value is canonicalized against it
    // (case-insensitive, whitespace-collapsed: taxonomy integrity,
    // 2026-10-28), so a variant spelling stores as the canonical
    // string instead of being dropped; unknown values still drop.
    .map((x) => (allowed ? canonicalFromList(x, allowed) : x))
    .filter((x) => !!x);
  return [...new Set(mapped)].slice(0, maxItems || 8);
}

// Profession + the realtor layer (Jeff, 2026-10-22). Profession is
// an optional self-description; junk or a missing value stores "".
// Only REALTOR_PROFESSION carries behavior: it flags the creator as
// a realtor, which unlocks the neighborhood tags and the brokerage
// line on the public profile. The offered list was reduced to the
// three role values on 2026-10-28, but LEGACY_PROFESSIONS stay
// acceptable here so a profile stored with a retired value keeps
// loading, displaying and re-saving with its value intact.
function cleanProfession(value) {
  const v = typeof value === "string" ? value.trim() : "";
  return PROFESSIONS.includes(v) || LEGACY_PROFESSIONS.includes(v) ? v : "";
}

function creatorIsRealtor(c) {
  return !!c && c.profession === REALTOR_PROFESSION;
}

// Neighborhood tags (stored as farmAreas): up to 3 short
// free-text tags for the neighborhoods the realtor works.
// Accepts an array or a comma-separated
// string; each tag is whitespace-collapsed, capped at 60 chars,
// deduped case-insensitively, and the list is capped at 3.
function cleanFarmAreas(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === "string") list = value.split(",");
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 3) break;
  }
  return out;
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
// Business referral-program tie-in (Jeff, 2026-10-25): a
// business that already runs a referral program in its own
// POS/booking stack keeps it; SIGNL feeds it instead of
// competing with it. The business saves its tracked referral
// link, an optional short code, and a one-line note on what it
// earns; creators see all three on the business's opportunities
// and on their booked visits, and carry the link/code in their
// post so the bookings land in the business's own dashboard.
// SIGNL never touches referral money and never guarantees the
// business's rewards: they are the business's program, under
// the business's terms, on top of the SIGNL comp or pay.
// Stored FLAT on the business record (referralUrl,
// referralCode, referralNote); all optional, all empty = off.
// The link points at the business's own stack, so there is NO
// host allowlist here (unlike review links): any valid
// http/https URL, length-capped, is accepted.
const REFERRAL_URL_MAX = 1000;
const REFERRAL_CODE_MAX = 60;
const REFERRAL_NOTE_MAX = 200;
// The stored setting, coerced defensively: records that
// predate the fields, or hold anything unexpected, read as
// empty strings. This runs on creator-facing read paths, so
// it must NEVER throw (INCIDENT-2026-10-25: a read path that
// throws can take the whole API down).
function referralProgramOf(business) {
  const out = { url: "", code: "", note: "" };
  try {
    if (!business) return out;
    if (typeof business.referralUrl === "string") out.url = business.referralUrl;
    if (typeof business.referralCode === "string") out.code = business.referralCode;
    if (typeof business.referralNote === "string") out.note = business.referralNote;
  } catch (e) { /* defensive: a bad record reads as no program */ }
  return out;
}
// The creator-facing view: the program only when a link or a
// code exists (a note alone is not a program). Null when the
// business has not set one, so nothing renders.
function referralProgramView(business) {
  const p = referralProgramOf(business);
  if (!p.url && !p.code) return null;
  return { url: p.url || null, code: p.code || null, note: p.note || null };
}
// Musician openness, business side (Jeff, 2026-10-28): the
// mirror of the creator's musician signals. A business flags
// that it is open to booking musicians, and for what (live
// performances, created music). Stored FLAT on the business
// record (musicOpen, musicLive, musicCreated); all optional,
// all unset = off. Signals only: no offer type, rate, or
// booking flow reads them; creators just see the openness on
// the business's offers and page. The view runs on
// creator-facing read paths, so it must NEVER throw: a record
// holding anything unexpected reads as closed.
function musicOpenView(business) {
  try {
    if (!business || business.musicOpen !== true) return null;
    return { live: business.musicLive === true, created: business.musicCreated === true };
  } catch (e) { /* defensive: a bad record reads as closed */ }
  return null;
}
// Student openness, business side (university layers U3, Jeff,
// 2026-10-28): the same adapter shape as the musician flags. A
// business marks that it is open to student creators; one
// boolean on the business record (studentOpen), unset = off.
// A signal only: no offer, rate, or booking flow reads it;
// creators see the openness on the business's offers and page.
// Same defensive contract as musicOpenView: never throws, a bad
// record reads as closed.
function studentOpenView(business) {
  try {
    if (!business || business.studentOpen !== true) return null;
    return { open: true };
  } catch (e) { /* defensive: a bad record reads as closed */ }
  return null;
}
// Validate a referral-program write against the record's
// current state. Input fields are optional (an omitted field
// keeps its current value); an explicit empty string clears
// that field. A given link must be a valid http/https URL
// (this refuses javascript: and other non-web links).
function validateReferralProgram(input, business) {
  const cur = referralProgramOf(business);
  let url = cur.url;
  let code = cur.code;
  let note = cur.note;
  if (input.url !== undefined) {
    const value = String(input.url == null ? "" : input.url).trim();
    if (value) {
      let u;
      try {
        u = new URL(value);
      } catch (e) {
        return { ok: false, error: "Your referral link is not a valid URL" };
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "Your referral link must start with http:// or https://" };
      url = value.slice(0, REFERRAL_URL_MAX);
    } else {
      url = "";
    }
  }
  if (input.code !== undefined) code = String(input.code == null ? "" : input.code).trim().slice(0, REFERRAL_CODE_MAX);
  if (input.note !== undefined) note = String(input.note == null ? "" : input.note).trim().slice(0, REFERRAL_NOTE_MAX);
  return { ok: true, url, code, note };
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

// ---------- Sig Operator: Brief Builder + Asset Packet (Jeff, 2026-10-28) ----------
// BRIEF BUILDER: every offer carries a normalized brief object
// { goal, hook, mustMention, doNotSay, deliverable, timing,
// callToAction }. The brief gives key points only, never a script
// (the same honesty rule as the paid brief). The deliverable line
// is SERVER-FORCED by visit kind and is never taken from input:
// a comp visit is the Standard Visit package; a paid visit's
// deliverables live in its booking terms. All other fields are
// capped, never refused: over-long text truncates, list items
// trim, drop when empty, dedupe, and cap at 3.
const BRIEF_GOALS = ["more_weekend_customers", "launch_something_new", "fill_an_event", "grow_regulars"];
const BRIEF_DELIVERABLES = {
  comp: "1 post + 1 story that shares the post. Post within 48 hours; one week is the hard deadline.",
  paid: "Deliverables are set in the booking terms. Post within 48 hours and keep the post live at least 30 days.",
};
function briefCleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function briefCleanList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const item = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 3) break;
  }
  return out;
}
// The seed a brief derives from an offer's own fields: the
// experience becomes the hook, includes becomes the one
// must-mention, the visit window becomes the timing.
function briefSeedFromFields(fields) {
  const f = fields && typeof fields === "object" ? fields : {};
  return {
    goal: null,
    hook: typeof f.experience === "string" ? f.experience : "",
    mustMention: f.includes ? [String(f.includes)] : [],
    doNotSay: [],
    timing: typeof f.visitWindow === "string" ? f.visitWindow : "",
    callToAction: "",
  };
}
// normalizeBriefInput(input, kind, seed): the composer and Sig
// send a brief on EVERY offer create, possibly with empty fields
// when the business skipped the brief section, so an EMPTY hook,
// mustMention, or timing falls back to the seed (the offer's own
// fields, via briefSeedFromFields). That way a blank brief section
// and a legacy offer with no brief at all derive the identical
// brief shape, byte for byte. Other fields take the seed only
// when the input does not carry them at all.
function normalizeBriefInput(input, kind, seed) {
  const k = kind === "paid" ? "paid" : "comp";
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const sd = seed && typeof seed === "object" && !Array.isArray(seed) ? seed : {};
  const pick = (key) => (src[key] !== undefined ? src[key] : sd[key]);
  const goalRaw = pick("goal");
  const hook = briefCleanText(pick("hook"), 140) || briefCleanText(sd.hook, 140);
  let mustMention = briefCleanList(pick("mustMention"));
  if (!mustMention.length) mustMention = briefCleanList(sd.mustMention);
  const timing = briefCleanText(pick("timing"), 140) || briefCleanText(sd.timing, 140);
  return {
    goal: BRIEF_GOALS.includes(goalRaw) ? goalRaw : null,
    hook,
    mustMention,
    doNotSay: briefCleanList(pick("doNotSay")),
    deliverable: BRIEF_DELIVERABLES[k],
    timing,
    callToAction: briefCleanText(pick("callToAction"), 120),
  };
}
// The brief an offer reads with: its stored brief normalized
// against the offer's own fields as seed, which for a legacy
// offer with no stored brief is exactly the derived brief.
function briefForOffer(offer) {
  if (!offer || typeof offer !== "object") return normalizeBriefInput(null, "comp");
  const kind = kindOf(offer);
  const stored = offer.brief && typeof offer.brief === "object" && !Array.isArray(offer.brief) ? offer.brief : null;
  return normalizeBriefInput(stored, kind, briefSeedFromFields(offer));
}
// Whether an offer carries the business's asset packet to the
// creator. New offers store the flag explicitly (paid defaults
// attached, comp defaults not); legacy offers without the flag
// read by the same default.
function offerAssetPacketAttached(offer) {
  if (!offer || typeof offer !== "object") return false;
  if (typeof offer.assetPacketAttached === "boolean") return offer.assetPacketAttached;
  return kindOf(offer) === "paid";
}

// ASSET PACKET: a business's reusable creator-facing kit, stored
// nested on the business record as business.assetPacket =
// { logoUrl, links: [{ label, url }], talkingPoints, handle,
// hashtags }. Every URL in the packet must be a valid HTTPS URL:
// creators follow these links from offer and visit cards, so an
// http (or non-web) URL is refused at write time with a clear
// error, never silently stored.
function isHttpsUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch (e) {
    return false;
  }
}
function assetPacketEmpty() {
  return { logoUrl: null, links: [], talkingPoints: "", handle: "", hashtags: [] };
}
function normalizeHashtagTokens(input) {
  let parts = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") parts.push(...item.split(/[\s,]+/));
    }
  } else if (typeof input === "string") {
    parts = input.split(/[\s,]+/);
  }
  const seen = new Set();
  const out = [];
  for (const raw of parts) {
    const token = String(raw || "").trim().replace(/^#+/, "").slice(0, 40);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= 6) break;
  }
  return out;
}
// Defensive normalization of a stored packet: bad shapes, non-HTTPS
// URLs, and over-cap values are dropped or truncated, never thrown
// on. This runs on creator-facing read paths (INCIDENT-2026-10-25
// rule: a read path that throws can take the whole API down).
function normalizeAssetPacketStored(raw) {
  const packet = assetPacketEmpty();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return packet;
  if (typeof raw.logoUrl === "string") {
    const logo = raw.logoUrl.trim().slice(0, 1000);
    if (logo && isHttpsUrl(logo)) packet.logoUrl = logo;
  }
  if (Array.isArray(raw.links)) {
    for (const entry of raw.links) {
      if (packet.links.length >= 6) break;
      const item = typeof entry === "string" ? { url: entry } : entry;
      if (!item || typeof item !== "object") continue;
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!url || !isHttpsUrl(url)) continue;
      let label = typeof item.label === "string" ? item.label.trim().slice(0, 40) : "";
      if (!label) {
        try { label = new URL(url).hostname.replace(/^www\./, "").slice(0, 40); } catch (e) { label = ""; }
      }
      if (!label) continue;
      packet.links.push({ label, url });
    }
  }
  if (typeof raw.talkingPoints === "string") packet.talkingPoints = raw.talkingPoints.trim().slice(0, 600);
  if (typeof raw.handle === "string") packet.handle = raw.handle.trim().replace(/^@+/, "").slice(0, 40);
  packet.hashtags = normalizeHashtagTokens(raw.hashtags);
  return packet;
}
function rawAssetPacketOf(source) {
  if (!source || typeof source !== "object") return null;
  if (source.assetPacket && typeof source.assetPacket === "object") return source.assetPacket;
  if (source.business && typeof source.business === "object" && source.business.assetPacket && typeof source.business.assetPacket === "object") return source.business.assetPacket;
  if ("logoUrl" in source || "links" in source || "talkingPoints" in source || "handle" in source || "hashtags" in source) return source;
  return null;
}
// The creator-facing view of a business's packet. Accepts a user
// record, a business record, or a packet itself. Null when the
// packet is empty, so nothing renders for a business that has not
// built one.
function assetPacketView(business) {
  try {
    const raw = rawAssetPacketOf(business);
    if (!raw) return null;
    const packet = normalizeAssetPacketStored(raw);
    if (!packet.logoUrl && !packet.links.length && !packet.talkingPoints && !packet.handle && !packet.hashtags.length) return null;
    return packet;
  } catch (e) { /* defensive: a bad record reads as no packet */ }
  return null;
}
// Validate an asset-packet write against the current packet.
// Input fields are optional (an omitted field keeps its current
// value); an explicit empty logoUrl clears it. HTTPS is enforced
// here, at write time, with a 400-style error string.
function validateAssetPacket(input, current) {
  if (input === null) return { ok: true, packet: assetPacketEmpty() };
  if (input === undefined) {
    const kept = assetPacketView(current);
    return { ok: true, packet: kept || assetPacketEmpty() };
  }
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Asset packet must be an object" };
  const packet = assetPacketView(current) || assetPacketEmpty();
  packet.links = [...packet.links];
  packet.hashtags = [...packet.hashtags];
  if (input.logoUrl !== undefined) {
    const value = typeof input.logoUrl === "string" ? input.logoUrl.trim() : "";
    if (!value) {
      packet.logoUrl = null;
    } else {
      if (value.length > 1000) return { ok: false, error: "Asset packet logo URL is too long (1000 characters max)" };
      if (!isHttpsUrl(value)) return { ok: false, error: "Asset packet logo URL must be a valid HTTPS URL" };
      packet.logoUrl = value;
    }
  }
  if (input.links !== undefined) {
    if (!Array.isArray(input.links)) return { ok: false, error: "Asset packet links must be a list of links" };
    if (input.links.length > 6) return { ok: false, error: "Asset packet holds up to 6 links" };
    const links = [];
    for (const entry of input.links) {
      const item = typeof entry === "string" ? { url: entry } : entry;
      if (!item || typeof item !== "object") return { ok: false, error: "Asset packet links must be a list of links" };
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!url) continue;
      if (!isHttpsUrl(url)) return { ok: false, error: "Asset packet links must be valid HTTPS URLs" };
      let label = typeof item.label === "string" ? item.label.trim().slice(0, 40) : "";
      if (!label) {
        try { label = new URL(url).hostname.replace(/^www\./, "").slice(0, 40); } catch (e) { label = ""; }
      }
      if (!label) return { ok: false, error: "Asset packet links must be valid HTTPS URLs" };
      links.push({ label, url });
    }
    packet.links = links;
  }
  if (input.talkingPoints !== undefined) {
    packet.talkingPoints = (typeof input.talkingPoints === "string" ? input.talkingPoints : String(input.talkingPoints == null ? "" : input.talkingPoints)).trim().slice(0, 600);
  }
  if (input.handle !== undefined) {
    packet.handle = (typeof input.handle === "string" ? input.handle : String(input.handle == null ? "" : input.handle)).trim().replace(/^@+/, "").slice(0, 40);
  }
  if (input.hashtags !== undefined) {
    packet.hashtags = normalizeHashtagTokens(input.hashtags);
  }
  return { ok: true, packet };
}

// ---------- Performance series (Sig Operator, Jeff, 2026-10-28) ----------
// A post's views at the day 7 / 14 / 30 marks: for each mark, the
// LAST snapshot taken at or before postBase + N days, where
// postBase is when reporting started (the performance summary's
// firstAt, else the first snapshot, else the post's own creation).
// A mark with no qualifying snapshot is null, never zero-filled.
function postSeries(post) {
  const out = { day7: null, day14: null, day30: null };
  if (!post || typeof post !== "object") return out;
  const snaps = (Array.isArray(post.snapshots) ? post.snapshots : [])
    .filter((s) => s && typeof s.views === "number" && Number.isFinite(s.views) && s.at && Number.isFinite(Date.parse(s.at)))
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!snaps.length) return out;
  const summary = performanceSummary(post);
  const baseRaw = summary.firstAt || (snaps[0] && snaps[0].at) || post.createdAt || post.submittedAt || null;
  const baseMs = baseRaw ? Date.parse(baseRaw) : NaN;
  if (!Number.isFinite(baseMs)) return out;
  for (const [key, days] of [["day7", 7], ["day14", 14], ["day30", 30]]) {
    const cutoff = baseMs + days * DAY_MS;
    let value = null;
    for (const s of snaps) {
      if (Date.parse(s.at) <= cutoff) value = s.views;
      else break;
    }
    out[key] = value;
  }
  return out;
}
// The same marks summed across a set of posts: each mark sums the
// posts that have a value at it, and stays null when none do.
function seriesForPosts(posts) {
  const out = { day7: null, day14: null, day30: null };
  for (const post of posts || []) {
    const s = postSeries(post);
    for (const key of ["day7", "day14", "day30"]) {
      if (s[key] !== null) out[key] = (out[key] === null ? 0 : out[key]) + s[key];
    }
  }
  return out;
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
    // Sig Operator (Jeff, 2026-10-28): the booking snapshots the
    // offer's brief (normalized from the offer, derived for legacy
    // offers) and, when the offer carries the business's asset
    // packet, a snapshot of the packet as it stands at booking
    // time, so later packet edits never rewrite a booked visit.
    brief: briefForOffer(offer),
    assetPacket: offerAssetPacketAttached(offer) ? assetPacketView(business) : null,
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
      licenseDays: LICENSE_WINDOW_DAYS,
      licenseNote: "Standard license included: repost + ad use for 90 days from the post date, never longer.",
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
    // Stripe Connect (2026-10-26): authorize the business's card
    // on file for the booking total, held on the platform side.
    // A failed charge is recorded as a funds state on the booking
    // (visible to the business and in Admin), never silent; the
    // paid offer itself was card-gated at posting.
    const bizUser = await store.get(`user:${offer.businessId}`);
    const offerFunds = await attachPaidFunds(booking, bizUser);
    if (offerFunds) {
      booking.updatedAt = nowIso();
      await store.set(`booking:${booking.id}`, booking);
    }
    await promptCreatorPayoutSetup(booking, creator);
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
        universityStatus: universityStatusOfRecord(c),
        campusBadge: campusBadgeFor(c),
        tierBand: normalizeTierBand(c.creator.tierBand),
        localAudiencePct: c.creator.localAudiencePct === undefined ? null : c.creator.localAudiencePct,
        totalAudience: audienceTotalOf(c.creator),
        paidRate: typeof c.creator.paidRate === "number" && c.creator.paidRate > 0 ? c.creator.paidRate : null,
        licensingFee: typeof c.creator.licensingFee === "number" && c.creator.licensingFee > 0 ? c.creator.licensingFee : null,
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

// ---------- matching fit (fit + explain, lib/fit.js) ----------
// Fit is computed per viewer: the same creator fits two
// businesses differently, so it is never a stored field. The
// business input comes from the requesting business's own record;
// a viewer without a business profile (admin, the Business
// Preview stub) gets no fit at all and cards render exactly as
// before. The creator input is the raw record plus the numbers
// already computed for the card (rating, stacked audience,
// Momentum points - the last three ride along for the learned
// seam in fit.js; today's weights score none of them).
function businessFitInputOf(viewer) {
  if (!viewer || viewer.role !== "business" || !viewer.business) return null;
  return {
    category: viewer.business.category || "",
    market: viewer.market || "",
    city: viewer.city || "",
    neighborhood: viewer.business.neighborhood || "",
  };
}

function creatorFitInputOf(user, extra) {
  const c = user.creator || {};
  const e = extra || {};
  return {
    categories: c.categories || [],
    compCategories: c.compCategories || [],
    homeCity: user.city || "",
    neighborhood: c.neighborhood || "",
    farmAreas: c.farmAreas || [],
    tier: normalizeTierBand(c.tierBand),
    totalAudience: e.totalAudience !== undefined ? e.totalAudience : audienceTotalOf(c),
    localAudiencePct: c.localAudiencePct === undefined ? null : c.localAudiencePct,
    profession: c.profession || "",
    ratingAvg: e.ratingAvg !== undefined ? e.ratingAvg : null,
    ratingCount: e.ratingCount || 0,
    momentumPoints: e.momentumPoints || 0,
  };
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
  if (market) creators = creators.filter((u) => normalizeMarketName(u.market) === (marketByName(market) || {}).name);
  // Campus facet (university layers U1, Jeff, 2026-10-28): the
  // universities a business can filter this market by — the
  // canonical schools of roster, profile-complete CURRENT students
  // in the effective market, with counts. Computed here, before
  // the remaining filters (including the university filter
  // itself), so the option list stays stable while the business
  // narrows the roster. Schools with no current-student roster
  // creator in the market never appear.
  const universityFacet = (() => {
    const counts = new Map();
    for (const u of creators) {
      if (!campusBadgeFor(u)) continue;
      const name = universityOfRecord(u);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  })();
  if (query.tier) creators = creators.filter((u) => u.creator && normalizeTierBand(u.creator.tierBand) === normalizeTierBand(query.tier));
  // Category filter (multi-select, Jeff, 2026-10-28): the Discover
  // chip row sends the selected set as one comma-separated
  // ?category= list and a creator matches when ANY selected
  // category is among theirs (OR). ?categories= is accepted as the
  // same list. A single value behaves exactly as the old exact
  // match did, so existing links and callers keep working.
  const catSet = new Set();
  for (const raw of [query.category, query.categories]) {
    if (raw) for (const piece of String(raw).split(",")) {
      const c = piece.trim();
      // Query values canonicalize too (taxonomy integrity): a
      // variant spelling in a link still lands on the canonical
      // category; unknown values pass through and match nothing.
      if (c) catSet.add(canonicalFromList(c, CREATOR_CATEGORIES) || c);
    }
  }
  // Stored values canonicalize at read as well, so a creator whose
  // record carries a legacy variant spelling stays filterable even
  // before their next save rewrites it canonically.
  if (catSet.size) creators = creators.filter((u) => u.creator && (u.creator.categories || []).some((c) => catSet.has(canonicalFromList(c, CREATOR_CATEGORIES) || c)));
  if (query.compCategory) {
    const wantComp = canonicalFromList(query.compCategory, COMP_CATEGORIES) || query.compCategory;
    creators = creators.filter((u) => u.creator && (u.creator.compCategories || []).some((x) => (canonicalFromList(x, COMP_CATEGORIES) || x) === wantComp));
  }
  // Spanish content filter (Jeff, 2026-10-28): the Discover
  // "Español" chip. Attribute only; unset means excluded here.
  if (query.spanish === "1" || query.spanish === "true") creators = creators.filter((u) => u.creator && u.creator.spanishContent === true);
  // Musician filter (Sig activation layer, Jeff, 2026-10-28):
  // the same attribute-read shape as the Spanish filter. Three
  // modes ride the one parameter: "1" is the musician attribute
  // (the Discover toggle), "perform" narrows to musicians open
  // to performing live, "create" to musicians open to creating
  // music for businesses. Sig's idea prompts deep-link the mode
  // whose count their sentence states, so the landing search
  // returns exactly the cohort the sentence counted.
  if (query.musician === "1" || query.musician === "true") creators = creators.filter((u) => u.creator && u.creator.musician === true);
  else if (query.musician === "perform") creators = creators.filter((u) => u.creator && u.creator.musician === true && u.creator.musicPerform === true);
  else if (query.musician === "create") creators = creators.filter((u) => u.creator && u.creator.musician === true && u.creator.musicCreate === true);
  // Campus filter (U1): current students at one university. The
  // campus badge rule does the gating (university set AND status
  // current_student), so an alumnus at the same school never
  // matches; the value canonicalizes through sameUniversity, so
  // alias spellings land on the stored canonical name.
  if (query.university) {
    const wantUniversity = String(query.university).trim();
    if (wantUniversity) creators = creators.filter((u) => !!campusBadgeFor(u) && sameUniversity(universityOfRecord(u), wantUniversity));
  }
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
  const fitBusiness = businessFitInputOf(viewer);
  const out = [];
  for (const c of creators) {
    const card = await publicCreator(c, viewer, approvedRank.get(c.id) || null);
    // Proximity (Build -31): a business viewer gets a coarse
    // distance BAND per card, computed from ZIP centroids. The
    // band is a label only: no distance, no ZIP, no pin ever
    // rides the card. Non-business viewers get no band field.
    if (viewer && viewer.role === "business") card.distanceBand = proximityBandFor(viewer, c);
    // Roster standing rides on the card: it is part of the order
    // businesses were promised creators would be seen in.
    card.momentum = momentum.summaryFor(c);
    card.badges = momentum.badgesFor(c);
    card.standing = standingState(c);
    // Matching fit (lib/fit.js): per-viewer, computed live from
    // stored fields only, attached as { score, reasons } so the
    // card can explain itself. Never a gate and never the default
    // order: it only moves a list a business explicitly re-sorts.
    if (fitBusiness) {
      const fit = computeFit(fitBusiness, creatorFitInputOf(c, {
        totalAudience: card.totalAudience,
        ratingAvg: card.ratingAvg,
        ratingCount: card.ratingCount,
        momentumPoints: card.momentum.points,
      }));
      card.fit = { score: fit.score, reasons: fit.reasons };
    }
    // At their weekly visit cap: still visible, NOT greyed (that is
    // the paused treatment), flagged "Booked up this week".
    card.bookedUp = bookedUp.has(c.id);
    out.push(card);
  }
  // Default sort is founding priority: earliest founding sign-ups
  // first, which is the priority promise made at sign-up. Businesses
  // can re-sort by Local Impact Score (?sort=score), by Momentum
  // points (?sort=momentum), or by matching fit (?sort=fit, only
  // meaningful for a business viewer: fit is computed against
  // their own record).
  if (query.sort === "score") {
    out.sort((a, b) => (b.localImpactScore || 0) - (a.localImpactScore || 0));
  } else if (query.sort === "momentum") {
    out.sort((a, b) => (b.momentum.points - a.momentum.points) || (a.createdAt < b.createdAt ? -1 : 1));
  } else if (query.sort === "fit") {
    out.sort((a, b) => ((b.fit ? b.fit.score : -1) - (a.fit ? a.fit.score : -1)) || (b.momentum.points - a.momentum.points) || (a.createdAt < b.createdAt ? -1 : 1));
  } else {
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  // Paused creators stay visible but sink below creators in good
  // standing on EVERY sort (stable partition applied last): greyed
  // out and deprioritized until they deliver the missing post.
  return {
    creators: [
      ...out.filter((c) => c.standing !== "paused"),
      ...out.filter((c) => c.standing === "paused"),
    ],
    universities: universityFacet,
  };
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
    market: normalizeMarketName(u.market),
    city: u.city || "",
    neighborhood: (u.creator && u.creator.neighborhood) || "",
    university,
    universityStatus: universityStatusOfRecord(u),
    campusBadge: campusBadgeFor(u),
    createdAt: u.createdAt,
    foundingBand: foundingPriority === undefined ? null : foundingBand(foundingPriority),
    photoUrl: u.creator && u.creator.hasPhoto ? `/api/users/${u.id}/photo` : null,
    photos: photoUrlsFor(u),
    // Paid lane fields ride on the card normalized: compOpen
    // defaults true for legacy records, paidRate is a number or
    // null (null = no paid bookings at any price).
    profile: u.creator
      ? { ...u.creator, university, primaryPlatform: primaryProfileOf(u.creator).platform, primaryPlatformLabel: primaryProfileOf(u.creator).label, primaryProfileUrl: primaryProfileOf(u.creator).url, compOpen: u.creator.compOpen !== false, paidRate: typeof u.creator.paidRate === "number" && u.creator.paidRate > 0 ? u.creator.paidRate : null, licensingFee: typeof u.creator.licensingFee === "number" && u.creator.licensingFee > 0 ? u.creator.licensingFee : null, zip: undefined }
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

// The ONE lookup behind every public surface for a creator page:
// the /api/c/<handle> JSON route and the server-rendered /c/
// page (Part C, 2026-10-23) both resolve through here, so the
// page and the API can never disagree about who is public. A
// banned creator's page stops resolving, exactly like a pending
// or rejected one: they are not bookable, so the public page
// comes down until an admin reinstates them.
// Book-me opt-in (Build -31, Jeff, 2026-10-29): the page is the
// creator's choice. creator.publicPage must be exactly true or
// the page does not exist (404, identical to an unknown handle).
// The toggle lives on their Profile; the Charter card and the
// profile itself prompt them to turn it on.
async function findPublicProfileUser(handleKey) {
  if (!handleKey) return null;
  const matches = (await allUsers())
    .filter((u) => isRosterCreator(u) && profileCompleteOf(u) && standingState(u) !== "banned" && u.creator && u.creator.publicPage === true && String(u.creator.handle || "").toLowerCase() === handleKey)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return matches[0] || null;
}

// ---------- server-rendered /c/ pages (Jeff's ruling, 2026-10-23) ----------
// netlify.toml rewrites /c/* to this function as seg ["cpage", ...]
// BEFORE the SPA fallback: approved + profile-complete profiles
// are served with real title/meta/OG tags and an index,follow
// robots directive baked into the HTML; everyone else (pending,
// rejected, incomplete, unknown, and deeper paths like
// /c/<handle>/proof) gets the app shell back byte-identical, so
// human UX is unchanged and the profile API keeps its 404.
const FALLBACK_APP_SHELL = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>SIGNL - Local Creator Marketing Platform</title>\n<meta name=\"description\" content=\"SIGNL connects local businesses with local creators. Businesses comp a meal or service, creators post honestly within 48 hours, and every post is tracked.\">\n<meta name=\"robots\" content=\"noindex\">\n<link rel=\"stylesheet\" href=\"/styles.css\">\n<link rel=\"stylesheet\" href=\"/theme-v2.css\">\n</head>\n<body>\n<main id=\"app\"><div class=\"loading\">Loading SIGNL...</div></main>\n<script src=\"/app.js\"></script>\n</body>\n</html>";
let appShellCache = null;
async function loadAppShell(event) {
  if (appShellCache) return appShellCache;
  let html = null;
  try {
    const fs = require("fs");
    const path = require("path");
    for (const rel of ["../../../public/index.html", "../../public/index.html"]) {
      try { html = fs.readFileSync(path.join(__dirname, rel), "utf8"); if (html) break; } catch (e) { html = null; }
    }
  } catch (e) { html = null; }
  if (!html) {
    // Deployed functions are bundled without public/ beside them:
    // fetch the shell the CDN is already serving for this host.
    try {
      const host = (event && event.headers && (event.headers["x-forwarded-host"] || event.headers.host)) || "app.joinsignl.com";
      const res = await fetch(`https://${host}/index.html`);
      if (res.ok) html = await res.text();
    } catch (e) { html = null; }
  }
  if (!html) html = FALLBACK_APP_SHELL;
  appShellCache = html;
  return html;
}

function htmlPage(body) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
    body,
  };
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
  const primary = primaryProfileOf(c);
  return {
    name: u.name,
    handle: c.handle,
    university,
    campusBadge: campusBadgeFor(u),
    // The public handle link points at the creator's PRIMARY
    // platform (Jeff, 2026-10-22). instagramUrl stays in the
    // payload with its exact legacy value for IG-primary creators
    // (every record written before the picker); for a creator whose
    // main platform is elsewhere it is null rather than a
    // fabricated instagram.com link to somebody else's handle.
    primaryPlatform: primary.platform,
    primaryPlatformLabel: primary.label,
    primaryProfileUrl: primary.url,
    instagramUrl: primary.platform === "instagram" ? (c.instagramUrl || `https://instagram.com/${c.handle}`) : (c.instagramUrl || null),
    photoUrl: c.hasPhoto ? `/api/users/${u.id}/photo` : null,
    photos: photoUrlsFor(u),
    market: unlisted ? u.city || "" : normalizeMarketName(u.market),
    unlisted,
    city: u.city || "",
    neighborhood: c.neighborhood || "",
    // Your Three Streets (Build -32): where this creator hangs
    // out, shown as "My streets" on the profile, the book-me
    // page, and the Local List.
    streets: Array.isArray(c.streets) ? c.streets : [],
    tierBand: normalizeTierBand(c.tierBand) || null,
    followerCount: c.followerCount || 0,
    totalAudience: audience.total,
    audienceStack: audience.platforms,
    categories: c.categories || [],
    // Spanish content attribute (Jeff, 2026-10-28): a simple
    // yes/no the creator sets on their profile. Optional, never
    // part of the completeness gate.
    spanishContent: c.spanishContent === true,
    // Musician openness (Jeff, 2026-10-28): the musician flag
    // and what they are open to, so cards and the full profile
    // can carry the Musician mark and the openness lines.
    // Optional signals, never part of the completeness gate.
    musician: c.musician === true,
    musicPerform: c.musicPerform === true,
    musicCreate: c.musicCreate === true,
    // Realtor layer (Jeff, 2026-10-22): the profession rides the
    // public payload for every creator; the neighborhood tags
    // and brokerage line are exposed ONLY while the profile is
    // realtor-flagged, so a non-realtor payload carries empty
    // values and renders exactly as before.
    profession: c.profession || "",
    isRealtor: creatorIsRealtor(c),
    farmAreas: creatorIsRealtor(c) ? (c.farmAreas || []) : [],
    brokerage: creatorIsRealtor(c) ? (c.brokerage || "") : "",
    compCategories: (c.compCategories || []).filter((x) => x !== PAID_COMP),
    compOpen: c.compOpen !== false,
    paidRate: typeof c.paidRate === "number" && c.paidRate > 0 ? c.paidRate : null,
    licensingFee: typeof c.licensingFee === "number" && c.licensingFee > 0 ? c.licensingFee : null,
    localAudiencePct: c.localAudiencePct === undefined ? null : c.localAudiencePct,
    localAudienceSource: c.localAudienceSource || "Self-reported",
    // Spanish-speaking audience share (S2): self-reported,
    // rides beside the local % on the public profile payload.
    spanishAudiencePct: c.spanishAudiencePct === undefined ? null : c.spanishAudiencePct,
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

// ---------- book-me payload (Build -31 + Amendments 1 and 2) ----------
// The /c/<handle> page is a gated showcase, tiered by viewer:
//   Tier 0 (logged out, creators, partners, anyone else): the
//     showcase only. Handle, Charter seal, local %, categories,
//     featured posts, theme. NO rate, NO follower counts, NO
//     social profile links, NO contact path of any kind.
//   Tier 1 (signed-in business without a paid, active account):
//     the showcase plus the creator's SIGNL listed rate and the
//     Book on SIGNL action. Socials stay hidden, no messaging.
//   Tier 2 (business with a paid, active account): Tier 1 plus
//     the creator's social channel links (unless the creator
//     hid them) and the in-platform Message action.
// The owner and admins keep the full legacy stat fields so the
// proof sheet (which reads this same payload) keeps working for
// the person the sheet belongs to.
function publicViewerTier(u, viewer) {
  if (viewer && viewer.id === u.id) return { tier: 1, owner: true, canBook: false, canMessage: false };
  if (!viewer) return { tier: 0, owner: false, canBook: false, canMessage: false };
  if (viewer.role === "admin") return { tier: 2, owner: false, canBook: false, canMessage: false };
  if (viewer.role === "business") {
    if (businessPaidActive(viewer)) return { tier: 2, owner: false, canBook: true, canMessage: true };
    return { tier: 1, owner: false, canBook: true, canMessage: false };
  }
  return { tier: 0, owner: false, canBook: false, canMessage: false };
}

async function bookMePayload(u, viewer) {
  const c = u.creator || {};
  const full = await publicProfilePayload(u);
  const t = publicViewerTier(u, viewer);
  const payload = {
    name: full.name,
    handle: full.handle,
    university: full.university,
    campusBadge: full.campusBadge,
    primaryPlatform: full.primaryPlatform,
    primaryPlatformLabel: full.primaryPlatformLabel,
    photoUrl: full.photoUrl,
    photos: full.photos,
    market: full.market,
    unlisted: full.unlisted,
    city: full.city,
    neighborhood: full.neighborhood,
    streets: full.streets || [],
    tierBand: full.tierBand,
    categories: full.categories,
    spanishContent: full.spanishContent,
    spanishAudiencePct: full.spanishAudiencePct,
    musician: full.musician,
    musicPerform: full.musicPerform,
    musicCreate: full.musicCreate,
    profession: full.profession,
    isRealtor: full.isRealtor,
    farmAreas: full.farmAreas,
    brokerage: full.brokerage,
    compCategories: full.compCategories,
    compOpen: full.compOpen,
    localAudiencePct: full.localAudiencePct,
    localAudienceSource: full.localAudienceSource,
    foundingBand: full.foundingBand,
    visitIncludes: full.visitIncludes,
    bio: c.bio || "",
    charter: c.charter === true,
    pageTheme: pageThemeOf(c),
    featuredPosts: (Array.isArray(c.featuredPosts) ? c.featuredPosts : []).map((url) => ({ url, embedUrl: `${String(url).replace(/\/?$/, "/")}embed` })),
    viewerTier: t.tier,
    viewerIsOwner: !!t.owner,
    canBook: !!t.canBook,
  };
  if (t.tier >= 1) {
    payload.paidRate = full.paidRate;
    payload.licensingFee = full.licensingFee;
    payload.creatorUserId = u.id;
  }
  if (t.tier >= 2) {
    payload.socialLinks = c.showSocials === false ? [] : creatorSocialLinks(c);
    payload.socialsHiddenByCreator = c.showSocials === false;
    payload.canMessage = !!t.canMessage;
  }
  if (t.owner || (viewer && viewer.role === "admin")) {
    payload.followerCount = full.followerCount;
    payload.totalAudience = full.totalAudience;
    payload.audienceStack = full.audienceStack;
    payload.primaryProfileUrl = full.primaryProfileUrl;
    payload.instagramUrl = full.instagramUrl;
    payload.localImpactScore = full.localImpactScore;
    payload.momentumPoints = full.momentumPoints;
    payload.badges = full.badges;
    payload.bestWork = full.bestWork;
    payload.trackRecord = full.trackRecord;
    payload.reviewSummary = full.reviewSummary;
    payload.reviews = full.reviews;
    payload.ratingAvg = full.ratingAvg;
    payload.ratingCount = full.ratingCount;
  }
  return payload;
}

function postState(booking, post) {
  if (post) return post.onTime ? "submitted_on_time" : "submitted_late";
  if (booking.status === "completed") return "submitted_on_time";
  if (booking.redeemedAt) {
    return Date.now() > Date.parse(booking.postDeadline) ? "overdue" : "awaiting_post";
  }
  return "booked";
}

// Performance summary (UX redesign section 3, 2026-10-24): a post's
// numbers are a time series (post.snapshots[]), and every payload
// that carries a post also carries this summary of it: the latest
// numbers (mirrored on the post fields themselves), when reporting
// started, when it last updated, how many snapshots exist, the
// views growth since the first snapshot, and where the latest
// numbers came from. Legacy posts reported before snapshots existed
// summarize from their flat fields with a zero snapshot count.
function performanceSummary(post) {
  const empty = { reported: false, views: null, likes: null, comments: null, shares: null, firstAt: null, updatedAt: null, snapshots: 0, viewsGrowthPct: null, source: null };
  if (!post) return empty;
  const snaps = Array.isArray(post.snapshots) ? post.snapshots : [];
  const first = snaps.length ? snaps[0] : null;
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  let viewsGrowthPct = null;
  if (first && latest && snaps.length >= 2 && typeof first.views === "number" && first.views > 0 && typeof latest.views === "number") {
    viewsGrowthPct = Math.round((((latest.views - first.views) / first.views) * 100) * 10) / 10;
  }
  return {
    reported: !!post.reportedAt,
    views: num(post.views),
    likes: num(post.likes),
    comments: num(post.comments),
    shares: num(post.shares),
    firstAt: first ? first.at : null,
    updatedAt: post.lastSnapshotAt || (latest ? latest.at : null) || post.reportedAt || null,
    snapshots: snaps.length,
    viewsGrowthPct,
    source: latest ? latest.source || null : null,
  };
}

function postWithPerformance(post) {
  if (!post) return post;
  return { ...post, performance: performanceSummary(post) };
}

async function withPostState(booking) {
  const posts = await allPosts();
  const post = posts.find((p) => p.bookingId === booking.id) || null;
  let creatorStanding = "good";
  let creatorLicensingFee = null;
  if (booking.creatorId) {
    const creator = await store.get(`user:${booking.creatorId}`);
    if (creator) {
      creatorStanding = standingState(creator);
      // Licensing (Jeff, 2026-10-26): the visit card prices the
      // license action from the creator's listed fee, so it rides
      // the booking payload like the handle does.
      const f = creator.creator ? Number(creator.creator.licensingFee) : NaN;
      creatorLicensingFee = Number.isFinite(f) && f >= 1 ? f : null;
    }
  }
  // Paid lane + review surfaces (Jeff, 2026-10-19): the booking's
  // paidLane object rides on the record itself; here we attach the
  // business's public review-page links (courtesy block for the
  // creator, display-if-exists) and the creator's own in-app review
  // of this business when one exists (so the visit card can show
  // it instead of the review form).
  let businessReviewLinks = null;
  let businessReferralProgram = null;
  if (booking.businessId) {
    const bizUser = await store.get(`user:${booking.businessId}`);
    if (bizUser && bizUser.business) {
      businessReviewLinks = reviewLinksView(bizUser.business);
      businessReferralProgram = referralProgramView(bizUser.business);
    }
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
  const roasBooking = { ...booking, post, planAllocation };
  await enrichRoasEstimateInputs([roasBooking]);
  const roas = roasFor([roasBooking]);
  return { ...booking, post: postWithPerformance(post), creatorLicensingFee, postState: postState(booking, post), compliance: complianceStatusFor(booking, post, creatorStanding), businessReviewLinks, businessReferralProgram, businessReview, creatorReview, roas };
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
// Performance refresh asks (UX redesign section 3, 2026-10-24):
// posts keep collecting views long after the first report, so at
// day 14 and day 30 after proof the sweep asks once more for fresh
// numbers, but only when the latest snapshot is stale (older than
// PERFORMANCE_UPDATE_STALE_DAYS). Markers live on the post record.
const PERFORMANCE_UPDATE_ASK_DAYS = [14, 30];
const PERFORMANCE_UPDATE_STALE_DAYS = 5;

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

let profileBackfillDone = false;
async function maybeRunProfileBackfill() {
  if (profileBackfillDone) return null;
  const rec = await store.get(PROFILE_BACKFILL_KEY);
  if (rec && rec.done) { profileBackfillDone = true; return null; }
  // Claim before running so concurrent requests do not pile on.
  await store.set(PROFILE_BACKFILL_KEY, { claimedAt: nowIso(), done: false });
  const out = await runProfileBackfill();
  profileBackfillDone = true;
  return out;
}

// ---------- Claim auto-decisions (Jeff standing authority, 2026-10-22) ----------
// Jeff took himself off the approval critical path: obvious test
// and spam claims are rejected without a person, and claims that
// verifiably match our own outreach records are approved without
// a person, each with exactly the side effects of the manual
// decision. Everything else, and every claim that arrived through
// another creator's referral link, waits for manual review:
// referral approvals mint Momentum (+10) for the referrer, so no
// rule ever approves them. INTERNAL ONLY: the system is never
// disclosed publicly. Public copy keeps the person-reviewed
// framing, auto-approved creators receive the standard approval
// email unchanged, and the decision markers live on the record
// server-side only (publicUser strips them; admin surfaces re-add
// them behind admin auth).
const AUTO_TEST_EMAIL_DOMAINS = new Set(["example.com", "example.org"]);
const AUTO_TEST_EMAILS = new Set(["testclaim@example.com"]);
const AUTO_TEST_HANDLES = new Set(["tiertest", "localtest", "signltestclaim"]);
const AUTO_TEST_NAME_MARKET = new Set(["email test|dubai", "email test 2|dubai"]);
const AUTO_DECISION_CLEANUP_KEY = "config:autoDecisionCleanupV1";
const AUTO_DECISION_CLEANUP_NOTE = "cleanup 2026-10-22, Jeff standing authority";

function claimHandleKey(u) {
  return u && u.creator && typeof u.creator.handle === "string" ? u.creator.handle.replace(/^@/, "").trim().toLowerCase() : "";
}

// Conservative exact matches only; nothing fuzzy. A record is a
// test/spam claim when its email domain is a reserved example
// domain, its email is a known test address, its creator handle
// is a known test handle, or it is one of the legacy named test
// records (name + market, exact).
function autoTestMatch(u) {
  if (!u || u.role !== "creator") return false;
  const email = String(u.email || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  if (AUTO_TEST_EMAIL_DOMAINS.has(domain)) return true;
  if (AUTO_TEST_EMAILS.has(email)) return true;
  const handle = claimHandleKey(u);
  if (handle && AUTO_TEST_HANDLES.has(handle)) return true;
  const nameMarket = `${String(u.name || "").trim().toLowerCase()}|${String(u.market || "").trim().toLowerCase()}`;
  if (AUTO_TEST_NAME_MARKET.has(nameMarket)) return true;
  return false;
}

// The live half of the match evidence, preloaded once per
// decision run: campaign recipients the app has actually SENT
// (every campaign email embeds the recipient's personal claim
// link, so a sent recipient supports both rules), indexed for
// exact lookup. The static half is lib/claim-evidence.js.
async function buildAutoEvidence() {
  let recipients = [];
  try {
    const rows = await store.list("campaign-recipient:");
    recipients = rows.map((r) => r.value).filter((r) => r && r.status === "sent");
  } catch (e) { recipients = []; }
  const sentByHandleEmail = new Map();
  const sentByHandleMarket = new Map();
  for (const r of recipients) {
    const h = String(r.handle || "").replace(/^@/, "").trim().toLowerCase();
    const em = String(r.email || "").trim().toLowerCase();
    const mk = String(r.market || "").trim();
    if (h && em) sentByHandleEmail.set(`${h}|${em}`, true);
    if (h && mk) sentByHandleMarket.set(`${h}|${mk}`, true);
  }
  return { sentByHandleEmail, sentByHandleMarket };
}

// Which rule, if any, a pending creator claim matches:
// "auto_rule_a", "auto_rule_b", or null. A claim carrying a
// referral NEVER matches, no exceptions: it stays manual.
function autoEvidenceRule(u, users, evidence) {
  if (!u || u.role !== "creator" || !u.creator) return null;
  if (u.referredBy) return null;
  const handle = claimHandleKey(u);
  if (!handle) return null;
  const email = String(u.email || "").trim().toLowerCase();
  const market = String(u.market || "").trim();
  // Rule A: handle AND email both evidenced (snapshot, a campaign
  // recipient actually sent, or a prior approval record).
  if (claimEvidence.snapshotMatchA(handle, email)) return "auto_rule_a";
  if (evidence.sentByHandleEmail.has(`${handle}|${email}`)) return "auto_rule_a";
  const prior = (users || []).some((o) => o.id !== u.id && o.role === "creator" && o.status === "approved" && claimHandleKey(o) === handle && String(o.email || "").trim().toLowerCase() === email);
  if (prior) return "auto_rule_a";
  // Rule B: a personal claim link verifiably sent to this exact
  // handle for this exact market (snapshot or sent recipient).
  if (claimEvidence.snapshotMatchB(handle, market)) return "auto_rule_b";
  if (evidence.sentByHandleMarket.has(`${handle}|${market}`)) return "auto_rule_b";
  return null;
}

// Decide one pending creator record under the standing rules.
// Returns { action, rule } when a rule decided it, else null (the
// record stays pending for a person). Approval replays the manual
// approval's side effects exactly: state, the
// application_approved event, queue position (derived from the
// records), and the standard approval email through the same send
// path. Rejection stores the reason on the record and sends no
// email and fires no referral effects.
async function applyAutoDecision(u, users, evidence, opts = {}) {
  if (!u || u.role !== "creator" || u.status !== "pending") return null;
  if (autoTestMatch(u)) {
    u.status = "rejected";
    u.reviewedAt = nowIso();
    u.reviewedBy = "system";
    u.decisionReason = "auto_test";
    if (opts.cleanupNote) u.decisionNote = opts.cleanupNote;
    u.updatedAt = nowIso();
    await store.set(`user:${u.id}`, u);
    await logEvent({ type: "application_rejected", actorId: null, actorRole: "system", subjectId: u.id, market: u.market, data: { applicantRole: u.role, email: u.email, autoDecision: true, rule: "auto_test", ...(opts.cleanupNote ? { note: opts.cleanupNote } : {}) } });
    return { action: "rejected", rule: "auto_test" };
  }
  const rule = autoEvidenceRule(u, users, evidence);
  if (!rule) return null;
  u.status = "approved";
  u.reviewedAt = nowIso();
  u.reviewedBy = "system";
  u.approvedBy = rule;
  u.updatedAt = nowIso();
  await store.set(`user:${u.id}`, u);
  await logEvent({ type: "application_approved", actorId: null, actorRole: "system", subjectId: u.id, market: u.market, data: { applicantRole: u.role, email: u.email, autoDecision: true, rule, approvedBy: rule } });
  try {
    const { approvedRank } = creatorRanks(await allUsers());
    const band = foundingBand(approvedRank.get(u.id));
    const mail = approvalEmail(u, band);
    await deliverEmail("approval", u, mail.subject, mail.text, band);
  } catch (e) { /* email is best-effort, exactly as in manual review */ }
  return { action: "approved", rule };
}

// The named legacy records the one-time cleanup accounts for, by
// exact identifier. A record that cannot be found is reported as
// not found; nothing is approximated.
const AUTO_CLEANUP_NAMED = [
  { label: "Email Test", match: (u) => String(u.name || "").trim() === "Email Test" && u.market === "Dubai" },
  { label: "Email Test 2", match: (u) => String(u.name || "").trim() === "Email Test 2" && u.market === "Dubai" },
  { label: "Casey Rivers (@tiertest)", match: (u) => claimHandleKey(u) === "tiertest" },
  { label: "Jamie Fox (@localtest)", match: (u) => claimHandleKey(u) === "localtest" },
  { label: "@signltestclaim (testclaim@example.com)", match: (u) => claimHandleKey(u) === "signltestclaim" || String(u.email || "").toLowerCase() === "testclaim@example.com" },
];

// One-time pass over the pending records that predate the rules
// (claimed-flag pattern, like the profile backfill): decide what
// the rules decide, leave the rest pending, and store a full
// audit, including a per-record account of the named legacy test
// records and a read-only confirmation of the designated tester.
async function runAutoDecisionCleanup() {
  const ranAt = nowIso();
  const users = await allUsers();
  const evidence = await buildAutoEvidence();
  const decided = [];
  for (const u of users) {
    if (u.role !== "creator" || u.status !== "pending") continue;
    const d = await applyAutoDecision(u, users, evidence, { cleanupNote: AUTO_DECISION_CLEANUP_NOTE });
    if (d) decided.push({ userId: u.id, handle: claimHandleKey(u) || null, email: u.email, market: u.market, action: d.action, rule: d.rule });
  }
  // Re-read so the audit reports final states, not pre-pass ones.
  const after = await allUsers();
  const namedRecords = AUTO_CLEANUP_NAMED.map((n) => {
    const rec = after.find((u) => u.role === "creator" && n.match(u));
    if (!rec) return { label: n.label, found: false };
    const wasDecided = decided.some((d) => d.userId === rec.id);
    return { label: n.label, found: true, userId: rec.id, email: rec.email, handle: claimHandleKey(rec) || null, market: rec.market, status: rec.status, action: wasDecided ? "decided by this cleanup" : `left as-is (${rec.status})` };
  });
  // Tony Johnson is already a designated tester: confirm the flag
  // and change nothing about his record.
  const tony = after.find((u) => u.role === "creator" && claimHandleKey(u) === "tonyjohnson374");
  const audit = {
    ranAt,
    note: AUTO_DECISION_CLEANUP_NOTE,
    decidedCount: decided.length,
    approvedCount: decided.filter((d) => d.action === "approved").length,
    rejectedCount: decided.filter((d) => d.action === "rejected").length,
    decided,
    namedRecords,
    tonyJohnson: tony ? { found: true, userId: tony.id, email: tony.email, status: tony.status, tester: isTester(tony), changed: false } : { found: false },
  };
  await store.set(AUTO_DECISION_CLEANUP_KEY, { done: true, ranAt, audit });
  await logEvent({ type: "auto_decision_cleanup_completed", actorId: null, actorRole: "system", subjectId: null, market: null, data: { decidedCount: audit.decidedCount, approvedCount: audit.approvedCount, rejectedCount: audit.rejectedCount, namedFound: namedRecords.filter((n) => n.found).length, tonyJohnsonFound: audit.tonyJohnson.found } });
  return audit;
}

let autoDecisionCleanupDone = false;
async function maybeRunAutoDecisionCleanup() {
  if (autoDecisionCleanupDone) return null;
  const rec = await store.get(AUTO_DECISION_CLEANUP_KEY);
  if (rec && rec.done) { autoDecisionCleanupDone = true; return null; }
  // Claim before running so concurrent requests do not pile on.
  await store.set(AUTO_DECISION_CLEANUP_KEY, { claimedAt: nowIso(), done: false });
  const out = await runAutoDecisionCleanup();
  autoDecisionCleanupDone = true;
  return out;
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

// AB1 (UX redesign, 2026-10-24): creator-facing reminder copy states
// the plain consequences only. The internal ladder's exact pause
// and ban timings never appear in anything a creator receives; the
// engine's timings and thresholds are unchanged.
// The refresh ask (UX redesign section 3, 2026-10-24): day 14 and
// day 30 after proof, when the numbers on file have gone stale.
// Same house pattern as postPerformanceEmail: plain ask, the reason
// it matters, the ten-second route in, the team sign-off. No em
// dashes, no compliance specifics.
function postPerformanceUpdateEmail(creator, booking) {
  const first = greetingName(creator);
  const biz = booking.businessName || "your visit";
  return {
    subject: "Your post is still growing: update its numbers",
    text: [
      `Hi ${first},`,
      "",
      `Your post for ${biz} is still collecting views, and the numbers on file are from a while back. Fresh numbers show the full picture: the business sees these numbers on their results for your visit, and they build your own SIGNL track record.`,
      "",
      "Update them in the app: open My Visits, find the visit, and update your views, likes, comments, and shares. It takes ten seconds.",
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
  const howTo = [
    "How to check off (takes 20 seconds):",
    "1. Open SIGNL and go to My Visits.",
    "2. Find this visit and paste the link to your post under Post your proof.",
    "3. That link is your check-off. We verify delivery from it.",
    "The post must be your honest experience with the comp disclosed, as you agreed.",
  ];
  const consequence = "If a post never lands, the visit does not count, and repeated misses can pause your account.";
  if (stage === 1) {
    return {
      subject: `Your SIGNL post is due for ${biz}`,
      text: [
        `Hi ${first},`,
        "",
        `The 48 hours for your full-credit post about ${biz} are up (it was due ${deadline}), and we do not have your post link yet. No stress: a late post inside the catch-up window still counts.`,
        "",
        ...howTo,
        "",
        consequence,
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
        `A late post inside the catch-up window still counts. ${consequence}`,
        "",
        "If something went wrong with the visit itself, reply to this email and tell us. We would rather hear it than guess.",
        "",
        "The SIGNL team",
        "hello@joinsignl.com",
      ].join("\n"),
    };
  }
  return {
    subject: "Final warning: your SIGNL post is still missing",
    text: [
      `Hi ${first},`,
      "",
      `This is the final warning for your visit to ${biz}: we still have no post link, and the catch-up window is closing. A late post inside the window still counts, so please get the link in now.`,
      "",
      ...howTo,
      "",
      consequence,
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
    `Booked visits on your account reached the end of their redemption windows without being used. ${strikeStatusLine(creator) || ""}`,
    "",
    "Your account is paused while the SIGNL team reviews it. While it is paused, businesses cannot send you new offers and you cannot take new ones. Visits you already redeemed are not affected.",
    "",
    "If something kept you from those visits, reply to this email and tell us what happened. Reviews are done by a person. If your account is reinstated, it restarts on probation, and another expired window can pause it again.",
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
  // Stripe Connect (2026-10-26): real money goes back first: the
  // held authorization is cancelled (never captured), so the
  // business is refunded in full and no transfer ever occurs.
  await refundPaidFunds(booking, reason);
  lane.escrowState = "refunded";
  lane.refundedAt = nowIso();
  lane.refundReason = reason;
  booking.updatedAt = nowIso();
  await store.set(`booking:${booking.id}`, booking);
  await logEvent({ type: "paid_escrow_refunded", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, rate: lane.rate, businessTotal: lane.businessTotal, reason } });
  if (summary) summary.escrowRefunded += 1;
}

async function runComplianceSweep() {
  const summary = { checked: 0, reminder1: 0, reminder2: 0, reminder3: 0, lateMarked: 0, paused: 0, banned: 0, performance: 0, performanceUpdates: 0, expired: 0, escrowReleased: 0, escrowRefunded: 0 };
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
        creator.standing = { state: "paused", reason: "A post from a redeemed visit never landed. Deliver the post link to unpause.", at: nowIso(), bookingId: booking.id };
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
        await notifyUser(strikeCreator.id, "account_paused_strikes", "Your SIGNL account is paused for review: booked visit windows expired unused. Reply to the email we sent if something kept you from those visits.", { strikes, limit: STRIKE_LIMIT });
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
    // Refresh mechanics (UX redesign section 3, 2026-10-24): the
    // day-7 ask now rides with an in-app notification too, so the
    // creator sees it on the dashboard, not only in their inbox.
    await notifyUser(post.creatorId, "performance_ask", `How did your post for ${booking.businessName || "your visit"} do? Add its views and likes under My Visits: it takes ten seconds and builds your track record.`, { bookingId: booking.id, postId: post.id });
    try {
      const mail = postPerformanceEmail(creator, booking);
      await deliverEmail("post_performance", creator, mail.subject, mail.text, null);
    } catch (e) { /* best-effort; the requested event is the record */ }
    summary.performance += 1;
  }
  // Performance refresh asks (UX redesign section 3, 2026-10-24):
  // a reported post keeps growing, so at day 14 and day 30 after
  // proof the sweep asks once more for fresh numbers, email plus
  // in-app, but only when the latest snapshot is stale (more than
  // PERFORMANCE_UPDATE_STALE_DAYS old). Each milestone fires once:
  // its marker lives on the post record.
  for (const post of posts) {
    if (!post.submittedAt || !post.reportedAt) continue;
    const ageDays = (now - Date.parse(post.submittedAt)) / DAY_MS;
    const snapshots = Array.isArray(post.snapshots) ? post.snapshots : [];
    const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
    const latestAtMs = Date.parse(post.lastSnapshotAt || (latest && latest.at) || post.reportedAt);
    if (!Number.isFinite(latestAtMs)) continue;
    if (now - latestAtMs <= PERFORMANCE_UPDATE_STALE_DAYS * DAY_MS) continue;
    for (const milestone of PERFORMANCE_UPDATE_ASK_DAYS) {
      const marker = `performanceUpdate${milestone}At`;
      if (ageDays < milestone || post[marker]) continue;
      const booking = bookings.find((b) => b.id === post.bookingId);
      if (!booking) break;
      const creator = await store.get(`user:${post.creatorId}`);
      if (!creator || creator.role !== "creator") break;
      post[marker] = nowIso();
      await store.set(`post:${post.id}`, post);
      await logEvent({ type: "post_performance_update_requested", actorId: null, actorRole: "system", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, creatorId: post.creatorId, businessId: post.businessId, milestone } });
      await notifyUser(post.creatorId, "performance_update_ask", `Your post for ${booking.businessName || "your visit"} is still growing. Update its numbers under My Visits so the business sees the full picture.`, { bookingId: booking.id, postId: post.id });
      try {
        const mail = postPerformanceUpdateEmail(creator, booking);
        await deliverEmail("post_performance_update", creator, mail.subject, mail.text, null);
      } catch (e) { /* best-effort; the requested event is the record */ }
      summary.performanceUpdates += 1;
      break; // one refresh ask per post per sweep pass
    }
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
    // Stripe Connect (2026-10-26): when real money rides on the
    // booking, the release moves it at this same moment: capture
    // the held charge and transfer the creator's share. A creator
    // whose payout setup is unfinished blocks the release (money
    // stays held, creator prompted) instead of stranding funds.
    if (!(await releasePaidFunds(booking))) continue;
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
  if (sweepMemoFresh("offerSweep")) return null;
  sweepMemoAt.offerSweep = Date.now();
  const rec = await store.get("config:offerSweep");
  const last = rec && rec.lastRunAt ? Date.parse(rec.lastRunAt) : 0;
  if (Date.now() - last < OFFER_SWEEP_THROTTLE_MS) return null;
  await store.set("config:offerSweep", { lastRunAt: nowIso() });
  return runOfferSweep();
}

const SWEEP_THROTTLE_MS = 55 * 60 * 1000;
async function maybeRunComplianceSweep() {
  if (sweepMemoFresh("complianceSweep")) return;
  sweepMemoAt.complianceSweep = Date.now();
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
  if (sweepMemoFresh("campaignSweep")) return;
  sweepMemoAt.campaignSweep = Date.now();
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
  if (sweepMemoFresh("profileReminderSweep")) return null;
  sweepMemoAt.profileReminderSweep = Date.now();
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
//     ceiling (150 sends per America/New_York calendar day across
//     ALL campaigns, tunable via the CAMPAIGN_DAILY_CAP env var):
//     the constraint being protected is the hello@ sending
//     domain's reputation, not any single campaign, so the
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
// Third campaign (Jeff, 2026-10-23): the founding BUSINESS wave.
// Not a reply-yes hold: every recipient gets a PREBUILT signup
// link (business name, market and category prefilled, source
// tagged business-wave), and claiming it costs nothing and
// commits them to nothing. Hampton Roads wording is correct in
// this email by Jeff's ruling (businesses know the region by
// that name) even though the app market is named Virginia Beach.
// Recipients carry business fields (businessName, greeting,
// category prose, appCategory, neighborhood), never a handle,
// so they can never be read as creator claim evidence.
const BUSINESS_CAMPAIGN_ID = "founding-businesses-2026-10";
// Fourth campaign (Jeff, 2026-10-25): a second founding-creators
// lane. It is the founding campaign in every respect that reaches
// a recipient: same machinery, same founding email (the template
// dispatch in campaignEmailFor falls through to campaignEmail
// for any id that is not the crossover or business campaign).
// The one difference is the sender. The founding campaign sends
// from the creators@ signlteam mailbox, which is warming up
// under its 25/day cap; this lane's stored config keeps
// fromMailbox "default", so it sends from hello@joinsignl.com
// under the shared daily ceiling alone, and founding-creator
// outreach volume is not throttled by one new mailbox's warm-up.
const HELLO_CAMPAIGN_ID = "founding-creators-hello-2026-10";
const CAMPAIGN_BATCH_SIZE = 8;
// Anti-spam daily ceiling (Jeff, 2026-10-19; raised 2026-10-23): at
// most this many campaign sends per America/New_York calendar day,
// counted across ALL campaigns combined, because what the ceiling
// protects is the hello@ sending domain, not a campaign. The count
// is derived from the recipient records themselves (every
// successful send stamps sentAt on its own record), so there is no
// separate counter to drift from reality or to race: see
// campaignSentToday(). The ceiling value itself is tunable without
// a code change via the CAMPAIGN_DAILY_CAP env var; an unset or
// invalid value falls back to the shipped default.
const CAMPAIGN_DAILY_CEILING_DEFAULT = 150;
function campaignDailyCeiling() {
  const n = parseInt(process.env.CAMPAIGN_DAILY_CAP || "", 10);
  return Number.isNaN(n) || n <= 0 ? CAMPAIGN_DAILY_CEILING_DEFAULT : n;
}
// Sender mailboxes (Jeff, 2026-10-24): a campaign sends from the
// default profile (hello@joinsignl.com) unless its config names
// one of the signlteam.com profiles from lib/email.js (creators@,
// team@, hello@ on the second sending domain). The stored value is
// normalized through campaignFromMailbox, so a missing or junk
// value always reads as "default" and every pre-existing campaign
// behaves exactly as it did before profiles existed. A campaign
// set to a profile whose SMTP vars are not in the environment is
// NEVER silently sent from the default identity: the sweep skips
// it and says why (see runCampaignSweep).
const CAMPAIGN_MAILBOXES = ["default", "creators", "team", "hello_team"];
function campaignFromMailbox(cfg) {
  return cfg && CAMPAIGN_MAILBOXES.includes(cfg.fromMailbox) ? cfg.fromMailbox : "default";
}
// Warm-up guardrail for the signlteam.com profiles: a flat daily
// cap per profile, counted across campaigns per ET day from the
// sentFrom stamp each campaign send leaves on its recipient
// record. Shipped conservative at 25; the 14-day warm-up ramp
// (5 -> 50) is run by raising SIGNL_TEAMMAIL_DAILY_CAP in the
// Netlify environment on schedule, no code change. An unset or
// invalid value falls back to the shipped default, same as the
// global ceiling above. The cap binds only signlteam profiles;
// the default profile is governed by the global ceiling alone.
const TEAMMAIL_DAILY_CAP_DEFAULT = 25;
function teamMailDailyCap() {
  const n = parseInt(process.env.SIGNL_TEAMMAIL_DAILY_CAP || "", 10);
  return Number.isNaN(n) || n <= 0 ? TEAMMAIL_DAILY_CAP_DEFAULT : n;
}
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
  return { id: campaignId, armed: false, armedAt: null, armedBy: null, disarmedAt: null, disarmReason: null, lastError: null, lastRunAt: null, totalSent: 0, fromMailbox: "default", createdAt: null, updatedAt: null };
}

async function saveCampaignConfig(cfg) {
  cfg.updatedAt = nowIso();
  await store.set(`campaign:${cfg.id}`, cfg);
  return cfg;
}

async function listCampaignRecipients(campaignId) {
  const prefix = `campaign-recipient:${campaignId}:`;
  const keys = await store.listKeys(prefix);
  const rows = await store.getMany(keys);
  return rows.map((r) => r.value);
}

// Every campaign recipient record across all campaigns, in ONE
// bounded-parallel scan (store.getMany). The Admin Campaign tab and
// the sweep's daily counters all derive from this single fetch
// instead of each re-scanning the whole prefix on its own.
async function allCampaignRecipientRows() {
  const keys = await store.listKeys("campaign-recipient:");
  return await store.getMany(keys);
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

// How the Virginia Beach market is talked about, vs how it is
// filed (Jeff, 2026-10-23): conversation with creators and
// businesses in the area says "Hampton Roads"; listed labels read
// "Virginia Beach (Hampton Roads)"; the canonical market name in
// data, claim links and filing statements stays "Virginia Beach".
function marketTalkName(market) {
  return normalizeMarketName(market) === "Virginia Beach" ? "Hampton Roads" : String(market || "");
}

// The founding mechanics paragraph, shared by both campaign
// templates: Virginia Beach (the November / Black Friday launch
// market) vs every other founding market, which opens in waves in
// the following 30 to 90 days.
function campaignMarketParagraph(market) {
  return normalizeMarketName(market) === "Virginia Beach"
    ? "Hampton Roads launches in November, and our opening push is Black Friday weekend. Founding creators are joining now, in sign-up order, and the first ones in get seen first when businesses start choosing."
    : `${market} is a founding market: sign-ups are open now and offers open city by city as the roster fills, in the next 30 to 90 days. Founding creators join in sign-up order, and the first ones in get seen first when businesses start choosing.`;
}

function campaignClaimLink(recipient) {
  const market = String(recipient.market || "");
  return `app.joinsignl.com/?handle=${encodeURIComponent(String(recipient.handle || "").replace(/^@/, ""))}&market=${encodeURIComponent(market)}`;
}

// The Jeff-approved outreach email (2026-10-19), rendered server
// side from the recipient's slots. Plain text, first name only,
// no em dashes. The market paragraph differs for Virginia Beach
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
    "Local businesses book creators two ways on SIGNL: they comp you a meal, service or experience for an honest post, or they pay your own listed rate (you keep 97%). Most founding creators do both. Either way, you post honestly about it within 48 hours. No script, no required praise, full disclosure. Businesses get real local posts, and your founding profile is live and shareable from day one.",
    "",
    "We don't rank you by followers. We rank you by how much of your audience actually lives here. That share is your local reach, and it is the number businesses look at first. Every post you deliver on time earns Momentum points, and those points raise your visibility to businesses.",
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

// The prebuilt founding signup link for a business recipient:
// the registration form opens with the business name, market and
// category already filled in, tagged source "business-wave"
// (Jeff, 2026-10-23). The market rides as its app name
// (Virginia Beach, id hampton-roads); the email copy says
// Hampton Roads, per Jeff's business-facing ruling.
function businessSignupLink(recipient) {
  const pairs = [
    ["biz", String(recipient.businessName || "")],
    ["market", "Virginia Beach"],
    ["category", String(recipient.appCategory || "")],
    ["src", "business-wave"],
  ];
  const qs = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `https://app.joinsignl.com/?${qs}`;
}

// The founding business wave email (Jeff's copy, 2026-10-23).
// Plain text, signs first name only, no em dashes. The framing
// is his: we pre-built the spot, claiming it gets them in early,
// it costs nothing and commits them to nothing, and they get
// updates as launch approaches.
function businessWaveEmail(recipient) {
  const business = String(recipient.businessName || "your business");
  const subject = `Your SIGNL founding spot is pre-built, ${business}`;
  const lines = [
    `Hi ${String(recipient.greeting || "there")},`,
    "",
    "I'm Jeff, founder of SIGNL. We connect local businesses in Hampton Roads with local creators: a creator visits, posts honestly about it, and we track what the post brings in.",
    "",
    `We're opening Hampton Roads in November, and I've pre-built a founding spot for ${business}, my pick for the ${String(recipient.category || "business")} spot in ${String(recipient.neighborhood || "your neighborhood")}. Your registration is already filled in. One click claims it:`,
    "",
    businessSignupLink(recipient),
    "",
    `Claiming it costs nothing and commits you to nothing. It puts ${business} in early, ahead of the public launch, and you'll get updates from me as we get close to opening day. If you decide to activate when the market opens, founding pricing is locked at $199, $349 or $699 a month depending on the creator visits you want, with $100 off your first month on any plan. If you never activate, that's fine too.`,
    "",
    "Jeff",
    "Founder, SIGNL",
  ];
  return { subject, text: lines.join("\n") };
}

// Which template a campaign sends. Every campaign except the
// crossover campaign uses the founding template; crossover
// recipients are stored under their own campaign keys and only
// ever receive the crossover email. The business wave has its
// own template and its own recipient shape.
function campaignEmailFor(campaignId, recipient) {
  if (campaignId === BUSINESS_CAMPAIGN_ID) return businessWaveEmail(recipient);
  return campaignId === CROSSOVER_CAMPAIGN_ID ? crossoverEmail(recipient) : campaignEmail(recipient);
}

function campaignWindowOpen(date) {
  const hourRaw = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: CAMPAIGN_WINDOW.timeZone }).format(date);
  const hour = ((parseInt(hourRaw, 10) % 24) + 24) % 24;
  // One-night exception (Jeff's order, 2026-10-24 ~21:45 ET): the
  // founding-creators queue sends from the new creators@ signlteam
  // mailbox tonight, past the normal 21:00 close, so on the ET
  // calendar date 2026-10-24 the window stays open until midnight.
  // Keyed to that single date, it expires on its own; every other
  // day uses the shipped 08:00-21:00 window.
  const endHour = campaignDayKey(date) === "2026-10-24" ? 24 : CAMPAIGN_WINDOW.endHour;
  return hour >= CAMPAIGN_WINDOW.startHour && hour < endHour;
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
  return (await campaignSentTodayStats(now)).total;
}

// Both derivations (the combined total and the per-profile split)
// from a single scan of the recipient records, so a caller that
// needs both never pays for two full-prefix reads.
async function campaignSentTodayStats(now) {
  const dayKey = campaignDayKey(now);
  const rows = await allCampaignRecipientRows();
  let total = 0;
  const byProfile = {};
  for (const row of rows) {
    const r = row.value;
    if (!r || r.status !== "sent" || !r.sentAt) continue;
    const t = Date.parse(r.sentAt);
    if (Number.isNaN(t)) continue;
    if (campaignDayKey(new Date(t)) !== dayKey) continue;
    total += 1;
    const key = CAMPAIGN_MAILBOXES.includes(r.sentFrom) ? r.sentFrom : "default";
    byProfile[key] = (byProfile[key] || 0) + 1;
  }
  return { total, byProfile };
}

// The same derivation, split by sending profile: every campaign
// send stamps sentFrom (the sender profile key) on its recipient
// record, so a profile's day count is exactly the sends that left
// from that mailbox. Sends from before profiles existed carry no
// stamp and count as "default". This is the counter the signlteam
// warm-up cap (teamMailDailyCap) enforces against.
async function campaignSentTodayByProfile(now) {
  return (await campaignSentTodayStats(now)).byProfile;
}

// One campaign sweep pass over every campaign config. Sends only
// for armed campaigns inside the window. Returns a summary; the
// scheduled function (netlify/functions/campaign-sweep.mjs) and the
// admin endpoint are the callers. `opts.now` exists for the verify
// suites (TEST_MODE only at the endpoint) so the window can be
// time-traveled deterministically.
async function runCampaignSweep(opts = {}) {
  const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
  const dailyCeiling = campaignDailyCeiling();
  const summary = { campaigns: 0, armed: 0, windowClosed: 0, attempted: 0, sent: 0, failed: 0, backstopReached: 0, dailyCeilingHit: 0, disarmed: 0, skippedTesters: 0, sentToday: 0, dailyCeiling, senderUnavailable: 0, teamCapHit: 0, teamCap: teamMailDailyCap() };
  // Global daily ceiling: sends already made today, across every
  // campaign, counted once up front and incremented locally as this
  // run sends, so a multi-campaign sweep can never overshoot.
  // Per-profile day counts for the signlteam warm-up cap come from
  // the same single scan and are incremented locally the same way.
  const sentStats = await campaignSentTodayStats(now);
  let sentToday = sentStats.total;
  summary.sentToday = sentToday;
  const sentByProfile = sentStats.byProfile;
  const configs = (await store.list("campaign:")).map((r) => r.value);
  for (const cfg of configs) {
    if (!cfg || !cfg.id) continue;
    summary.campaigns += 1;
    if (!cfg.armed) continue;
    summary.armed += 1;
    // Sender profile gate (Jeff, 2026-10-24): a campaign set to a
    // signlteam mailbox whose SMTP credentials are not in the
    // environment is skipped, loudly, and NEVER falls back to
    // sending from the default identity. The campaign stays armed;
    // adding the profile's env vars is the whole fix. The check
    // runs before the window check so the configuration problem is
    // visible at any hour, and lastError clears the moment the
    // profile becomes usable.
    const fromMailbox = campaignFromMailbox(cfg);
    if (fromMailbox !== "default" && !senderProfile(fromMailbox).available) {
      cfg.lastRunAt = now.toISOString();
      cfg.lastError = `Sender mailbox "${fromMailbox}" is not active: its SMTP credentials are not set in the server environment, so this campaign was skipped rather than sent from the wrong address. Add the profile's SIGNL_SMTP_USER / SIGNL_SMTP_PASS vars in Netlify to activate it.`;
      await saveCampaignConfig(cfg);
      await logEvent({ type: "campaign_sender_unavailable", actorId: null, actorRole: "system", subjectId: null, market: null, data: { campaignId: cfg.id, fromMailbox } });
      summary.senderUnavailable += 1;
      continue;
    }
    if (fromMailbox !== "default" && cfg.lastError && cfg.lastError.startsWith("Sender mailbox")) cfg.lastError = null;
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
    const remainingToday = dailyCeiling - sentToday;
    if (remainingToday <= 0) {
      // The daily ceiling is reached: not an error, nothing is
      // wrong. The campaign stays armed, no lastError is set, and
      // the queue simply waits for the next ET calendar day.
      summary.dailyCeilingHit += 1;
      await saveCampaignConfig(cfg);
      continue;
    }
    // Warm-up cap (signlteam profiles only): the profile's own
    // daily budget, counted across campaigns, on top of the global
    // ceiling. Reaching it reads exactly like the global ceiling:
    // not an error, the campaign stays armed, the queue waits.
    let remainingProfile = Infinity;
    if (fromMailbox !== "default") {
      remainingProfile = summary.teamCap - (sentByProfile[fromMailbox] || 0);
      if (remainingProfile <= 0) {
        summary.teamCapHit += 1;
        await saveCampaignConfig(cfg);
        continue;
      }
    }
    const batch = recipients
      .filter((r) => r.status === "queued")
      .slice(0, Math.min(CAMPAIGN_BATCH_SIZE, CAMPAIGN_RUNAWAY_BACKSTOP - counts.sent, remainingToday, remainingProfile));
    let failures = 0;
    let lastReason = null;
    for (let i = 0; i < batch.length; i++) {
      if (failures > CAMPAIGN_MAX_FAILURES_PER_RUN) break;
      const recipient = batch[i];
      const mail = campaignEmailFor(cfg.id, recipient);
      const messageRef = crypto.randomUUID();
      // The default profile path passes no selector at all, so its
      // send call is byte-identical to before profiles existed; a
      // signlteam campaign sends explicitly as its own mailbox.
      const result = await sendEmail({ to: recipient.email, subject: mail.subject, text: mail.text, listUnsubscribe: true, ...(fromMailbox !== "default" ? { profile: fromMailbox } : {}) });
      summary.attempted += 1;
      if (result.sent) {
        recipient.status = "sent";
        recipient.sentAt = now.toISOString();
        recipient.sentFrom = fromMailbox;
        recipient.messageRef = messageRef;
        recipient.updatedAt = now.toISOString();
        await store.set(`campaign-recipient:${cfg.id}:${recipient.email}`, recipient);
        counts.sent += 1;
        summary.sent += 1;
        sentToday += 1;
        summary.sentToday = sentToday;
        sentByProfile[fromMailbox] = (sentByProfile[fromMailbox] || 0) + 1;
        await logEvent({ type: "campaign_email_sent", actorId: null, actorRole: "system", subjectId: null, market: recipient.market || null, data: { campaignId: cfg.id, email: recipient.email, handle: recipient.handle || null, messageRef, fromMailbox } });
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

function campaignView(cfg, counts, sentToday, sentTodayByLane) {
  const fromMailbox = campaignFromMailbox(cfg);
  return {
    id: cfg.id,
    fromMailbox,
    senderAvailable: senderProfile(fromMailbox).available,
    teamMailDailyCap: teamMailDailyCap(),
    armed: !!cfg.armed,
    armedAt: cfg.armedAt || null,
    disarmedAt: cfg.disarmedAt || null,
    disarmReason: cfg.disarmReason || null,
    lastError: cfg.lastError || null,
    lastRunAt: cfg.lastRunAt || null,
    totalSent: counts ? counts.sent : cfg.totalSent || 0,
    dailyCeiling: campaignDailyCeiling(),
    sentToday: typeof sentToday === "number" ? sentToday : null,
    // Per-lane sends today, keyed by sender profile ("creators" =
    // creators@signlteam.com, "default" = hello@joinsignl.com, plus
    // "team" / "hello_team" when those mailboxes send). Global across
    // campaigns, exactly like sentToday: the ceiling protects the
    // sending domain, and the Admin tab reads the split from here.
    sentTodayByLane: sentTodayByLane && typeof sentTodayByLane === "object" ? sentTodayByLane : null,
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
      `Comp: ${booking.whatComped} (cap $${fmtMoneyS(booking.dollarCap)})`,
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
// Code-use logging (UX redesign section 4, 2026-10-24): one tap at
// the register, at the moment a customer uses a creator's audience
// code. One stored record per call (codeuse:<id>) carries the count;
// booking.codeUseCount is the running total the ROAS estimate reads
// (code uses times the business's average ticket, only until an
// actual register tally replaces the estimate). `via` is "owner"
// (business owner or admin, from the booking view) or "staff" (a
// staff session at the counter).
async function logCodeUse(booking, count, by, via, actorRole) {
  const ts = nowIso();
  const rec = {
    id: crypto.randomUUID(),
    bookingId: booking.id,
    businessId: booking.businessId,
    creatorId: booking.creatorId,
    count,
    at: ts,
    by,
    via,
  };
  await store.set(`codeuse:${rec.id}`, rec);
  booking.codeUseCount = (booking.codeUseCount || 0) + count;
  booking.updatedAt = ts;
  await store.set(`booking:${booking.id}`, booking);
  await logEvent({ type: "code_use_logged", actorId: by, actorRole: actorRole || (via === "staff" ? "staff" : "business"), subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, count, codeUseCount: booking.codeUseCount, via } });
  return rec;
}

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
  // The creator's 48 hour clock just started; until 2026-10-24
  // they heard about it from nobody. Tell them, both surfaces.
  await notifyMilestone(booking.creatorId, "clock_started",
    `Your visit to ${booking.businessName || "the business"} is redeemed and your 48 hour post clock is running. Post by ${milestoneDeadlineText(booking.postDeadline)}, then paste the Instagram link in the app. A post inside the week still counts, as a late delivery.`,
    `Your 48 hour post clock started: ${booking.businessName || "your SIGNL visit"}`,
    [`Your visit to ${booking.businessName || "the business"} was just redeemed at the counter, so your post clock is running.`, "", `Post within 48 hours, by ${milestoneDeadlineText(booking.postDeadline)}, then paste the full Instagram post or reel link in the app as your proof. On time is what keeps your Momentum climbing, and a post inside the week still counts, as a late delivery.`, "", "Open SIGNL: https://app.joinsignl.com", "", "Jeff", "Founder, SIGNL"].join("\n"),
    { bookingId: booking.id });
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
const PREVIEW_DASH_BUSINESS = { name: "Salt & Ember Kitchen", category: "Chef-driven restaurant", market: "Virginia Beach" };
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
      label: "1 story from the visit, sharing the post",
      state: b.post ? "done" : "pending",
      detail: "Part of a comped visit, sharing the post itself; paid bookings follow the deliverables in their booking terms",
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
      b.replacementAvailable = false;
      b.alerts = [
        `The 48 hour deadline passed ${Math.round((now - Date.parse(b.postDeadline)) / 3600000)} hours ago with no post link yet. Reminder emails went out automatically at the deadline.`,
        `The visit still counts if the post lands before the hard stop on ${previewFmtDate(b.pauseAt)}; after that the creator's account pauses until it does.`,
        "If the week passes with no post, this is where you request a replacement visit under the Visit Guarantee. Nothing about the creator's standing is ever shown publicly.",
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
  // Growth plan allocation ($349 / 10 visits = $34.90 a visit)
  // in the all-in variant. Each delivered booking also carries
  // its own score for its card.
  const planAllocation = plan.priceMonthly / plan.visitsPerMonth;
  for (const b of delivered) b.roas = roasFor([{ ...b, planAllocation }]);
  const roas = roasFor(delivered.map((b) => ({ ...b, planAllocation })));
  // The simulated cycle runs through the same allowance counter
  // as the real home (rollover included, Jeff 2026-10-26); the
  // simulated bookings are stamped into the current month so the
  // preview stays deterministic at month boundaries.
  const pvAllowance = planAllowanceFor(bookings.map((b) => ({ ...b, kind: "comp", createdAt: new Date(now).toISOString() })), plan, now);
  const summary = {
    cycleLabel: new Date(now).toLocaleString("en-US", { month: "long", year: "numeric" }),
    visitsUsed: bookings.length,
    visitsAllowance: pvAllowance.allowance,
    visitsBase: pvAllowance.base,
    visitsCarried: pvAllowance.carried,
    visitsRemaining: pvAllowance.remaining,
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
      homeAttention.push({ kind: "tally", bookingId: b.id, label: "Code tally not in yet", detail: `${b.title} with @${b.creatorHandle}: the post is live. Enter how many customers used the code and the tally completes its SIGNL ROAS Score.` });
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
    .map((b) => ({ bookingId: b.id, title: b.title, creatorName: b.creatorName, creatorHandle: b.creatorHandle, state: b.state, stateLabel: b.stateLabel, when: nextDeadlineOf(b), whenLabel: b.state === "booked" ? "Redeem by" : b.state === "overdue" ? "Hard stop" : "Post due", dueInLabel: b.state === "post_due" && b.postDeadline ? `Post due in ${Math.max(0, Math.round((Date.parse(b.postDeadline) - now) / 3600000))}h` : null }))
    .sort((a, b) => (String(a.when || "") < String(b.when || "") ? -1 : 1));
  const home = {
    visitsUsed: summary.visitsUsed,
    visitsAllowance: summary.visitsAllowance,
    visitsBase: summary.visitsBase,
    visitsCarried: summary.visitsCarried,
    visitsRemaining: summary.visitsRemaining,
    postsLive: summary.postsDelivered,
    onTimeRatePct: summary.onTimeRatePct,
    roasScore: summary.roas ? summary.roas.score : null,
    roasAllInScore: summary.roas ? summary.roas.allInScore : null,
    roas: summary.roas || null,
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
    // Overhaul Stage 1 analytics extras: the same shared
    // computation as the real Business Home, over the simulated
    // bookings and the real roster records they point at.
    ...(() => {
      const byId = new Map(users.map((x) => [x.id, x]));
      return homeAnalyticsExtras(bookings.map((b) => ({ booking: b, post: b.post || null, creator: byId.get(b.creatorId) || null })), plan, now);
    })(),
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
    plan: { id: plan.id, name: plan.name, priceMonthly: plan.priceMonthly, foundingCredit: plan.foundingCredit, firstMonthPriceMonthly: plan.firstMonthPriceMonthly, minMonths: plan.minMonths, visitsPerMonth: plan.visitsPerMonth, features: plan.features },
    rights: { comp: visitRightsForVisit("comp"), paid: visitRightsForVisit("paid") },
    standardVisit: STANDARD_VISIT,
    summary,
    bookings,
    staffDemo,
    managedView,
    home,
    rosterEmpty: bookings.length === 0,
  };
}

// ---------- Home analytics extras (overhaul Stage 1, 2026-10-27) ----------
// One computation shared by the real Business Home and the
// Preview dashboard, fed by normalized triples of
// { booking, post, creator } so the sample and the real home can
// never tell two different stories. Everything here is derived
// from the records themselves: no stored counters, no estimates.
// - localReachDelivered: for each delivered post, the creator's
//   local audience (total audience x local audience %) from the
//   creator's current record, summed. Local reach is the headline
//   metric of the overhaul homes.
// - funnel7 / funnel30: windowed stage counts by the records' own
//   timestamps (invited = booking created, claimed = code issued
//   at creation, visited = redeemed, posted = post reported).
// - contentLibrary: every delivered post with its license state
//   derived from the visit's own terms (a granted license on the
//   post, the standard license a paid booking carries, or native
//   share only for a comped visit), never from the plan.
// - costPerVisit: the plan allocation (monthly price / visits per
//   month), plan math labeled as plan math.
function creatorTotalAudience(c) {
  if (!c) return 0;
  if (typeof c.totalAudience === "number" && Number.isFinite(c.totalAudience)) return c.totalAudience;
  const stack = c.audienceStack || {};
  return Object.values(stack).reduce((s, v) => s + (Number(v) || 0), 0) || Number(c.followerCount) || 0;
}
function homeAnalyticsExtras(triples, plan, now, apps = []) {
  const DAY = 24 * 3600 * 1000;
  const postedAtOf = (post) => (post ? Date.parse(post.reportedAt || post.submittedAt || post.createdAt || "") || null : null);
  let localReachDelivered = 0;
  const contentLibrary = [];
  for (const t of triples) {
    if (!t.post) continue;
    const c = t.creator && t.creator.creator ? t.creator.creator : null;
    const total = creatorTotalAudience(c);
    const pct = c && c.localAudiencePct !== null && c.localAudiencePct !== undefined ? Number(c.localAudiencePct) || 0 : 0;
    const localReach = Math.round((total * pct) / 100);
    localReachDelivered += localReach;
    const postedAt = postedAtOf(t.post);
    const paid = !!(t.booking.paidLane || t.booking.kind === "paid");
    let license;
    const granted = t.post.license && t.post.license.status === "granted" ? t.post.license : null;
    if (granted) {
      const end = Date.parse(granted.windowEndsAt || "") || null;
      license = { type: "licensed", fee: granted.fee || null, windowEndsAt: granted.windowEndsAt || null, daysLeft: end ? Math.ceil((end - now) / DAY) : null };
    } else if (paid && postedAt) {
      const end = licenseWindowEnd(postedAt).getTime();
      license = { type: "standard", windowEndsAt: new Date(end).toISOString(), daysLeft: Math.ceil((end - now) / DAY) };
    } else {
      license = { type: "native", windowEndsAt: null, daysLeft: null };
    }
    contentLibrary.push({
      bookingId: t.booking.id,
      title: t.booking.title,
      creatorName: t.booking.creatorName,
      creatorHandle: t.booking.creatorHandle,
      postUrl: t.post.url || null,
      postedAt: postedAt ? new Date(postedAt).toISOString() : null,
      onTime: !!t.post.onTime,
      views: Number(t.post.views) || 0,
      likes: Number(t.post.likes) || 0,
      kind: paid ? "paid" : "comp",
      localReach,
      redemptions: t.booking.redemptions ? { count: t.booking.redemptions.count, basketTotal: t.booking.redemptions.basketTotal } : null,
      viewsGrowthPct: performanceSummary(t.post).viewsGrowthPct,
      license,
    });
  }
  contentLibrary.sort((a, b) => String(b.postedAt || "") < String(a.postedAt || "") ? -1 : 1);
  const funnel = (days) => {
    const cutoff = now - days * DAY;
    const inWin = (iso) => { const ms = Date.parse(iso || ""); return Number.isFinite(ms) && ms >= cutoff; };
    return {
      invited: triples.filter((t) => inWin(t.booking.createdAt)).length,
      claimed: triples.filter((t) => t.booking.code && inWin(t.booking.createdAt)).length,
      visited: triples.filter((t) => inWin(t.booking.redeemedAt)).length,
      posted: triples.filter((t) => t.post && inWin(t.post.reportedAt || t.post.submittedAt)).length,
    };
  };
  // Overhaul V2 (2026-10-27): prior equal windows, so the UI can
  // show an honest period delta (current window vs the window
  // right before it) computed from the same records. A delta is
  // only meaningful when the prior window is non-zero; the UI
  // suppresses the pill otherwise. Same stage definitions as
  // funnel(), bounded on both ends.
  const funnelPrev = (days) => {
    const hi = now - days * DAY;
    const lo = now - 2 * days * DAY;
    const inWin = (iso) => { const ms = Date.parse(iso || ""); return Number.isFinite(ms) && ms >= lo && ms < hi; };
    return {
      invited: triples.filter((t) => inWin(t.booking.createdAt)).length,
      claimed: triples.filter((t) => t.booking.code && inWin(t.booking.createdAt)).length,
      visited: triples.filter((t) => inWin(t.booking.redeemedAt)).length,
      posted: triples.filter((t) => t.post && inWin(t.post.reportedAt || t.post.submittedAt)).length,
    };
  };
  // Daily series for the last 30 days (oldest first): invites
  // sent (bookings created), decisions (applications decided —
  // real business only; preview passes no applications and gets
  // zeroes), posts live, and local reach delivered that day.
  const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const series30 = [];
  const bucketByDay = new Map();
  for (let i = 29; i >= 0; i--) {
    const b = { date: dayKey(now - i * DAY), invited: 0, decisions: 0, posts: 0, reach: 0 };
    series30.push(b);
    bucketByDay.set(b.date, b);
  }
  const bump = (iso, key, by) => {
    const ms = Date.parse(iso || "");
    if (!Number.isFinite(ms)) return;
    const b = bucketByDay.get(dayKey(ms));
    if (b) b[key] += by || 1;
  };
  for (const t of triples) {
    bump(t.booking.createdAt, "invited");
    if (t.post) bump(t.post.reportedAt || t.post.submittedAt, "posts");
  }
  for (const r of contentLibrary) bump(r.postedAt, "reach", r.localReach || 0);
  for (const a of apps || []) if (a && a.decidedAt) bump(a.decidedAt, "decisions");
  // Creators ranked by local reach delivered (the leaderboard):
  // posts delivered and on-time share ride along per creator.
  const lbByHandle = new Map();
  for (const r of contentLibrary) {
    const key = r.creatorHandle || r.creatorName || "";
    if (!key) continue;
    const row = lbByHandle.get(key) || { creatorName: r.creatorName || "", creatorHandle: r.creatorHandle || "", localReach: 0, posts: 0, onTime: 0 };
    row.localReach += r.localReach || 0;
    row.posts += 1;
    if (r.onTime) row.onTime += 1;
    lbByHandle.set(key, row);
  }
  const leaderboard = [...lbByHandle.values()]
    .map((r) => ({ creatorName: r.creatorName, creatorHandle: r.creatorHandle, localReach: r.localReach, posts: r.posts, onTimePct: r.posts ? Math.round((r.onTime / r.posts) * 100) : null }))
    .sort((a, b) => b.localReach - a.localReach)
    .slice(0, 10);
  const postsTracked30 = contentLibrary.filter((r) => { const ms = Date.parse(r.postedAt || ""); return Number.isFinite(ms) && ms >= now - 30 * DAY; }).length;
  // Applications received (Grin-style KPI): every application to this
  // business's offers by its own timestamp — distinct from the
  // funnel's "invited" stage, which counts selected bookings.
  const appMs = (a) => { const ms = Date.parse(a.createdAt || ""); return Number.isFinite(ms) ? ms : null; };
  const applications30 = apps.filter((a) => { const ms = appMs(a); return ms !== null && ms >= now - 30 * DAY; }).length;
  const applicationsPrev30 = apps.filter((a) => { const ms = appMs(a); return ms !== null && ms >= now - 60 * DAY && ms < now - 30 * DAY; }).length;
  const applications7 = apps.filter((a) => { const ms = appMs(a); return ms !== null && ms >= now - 7 * DAY; }).length;
  const applicationsPrev7 = apps.filter((a) => { const ms = appMs(a); return ms !== null && ms >= now - 14 * DAY && ms < now - 7 * DAY; }).length;
  return {
    localReachDelivered,
    funnel7: funnel(7),
    funnel30: funnel(30),
    funnelPrev7: funnelPrev(7),
    funnelPrev30: funnelPrev(30),
    series30,
    leaderboard,
    postsTracked30,
    applications30,
    applicationsPrev30,
    applications7,
    applicationsPrev7,
    contentLibrary,
    costPerVisit: plan && plan.visitsPerMonth ? Math.round((plan.priceMonthly / plan.visitsPerMonth) * 100) / 100 : null,
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
  // Plan allowance with rollover (Jeff, 2026-10-26): comp visits
  // used this month against this month's base plus last month's
  // unused base, carried once. Paid bookings never consume it.
  const allowance = planAllowanceFor(bookings, plan, now);
  const delivered = bookings.filter((b) => postByBooking.has(b.id));
  const onTime = delivered.filter((b) => postByBooking.get(b.id).onTime);
  const planAllocation = plan.priceMonthly / plan.visitsPerMonth;
  const roasInputs = delivered.map((b) => ({ ...b, planAllocation }));
  await enrichRoasEstimateInputs(roasInputs);
  const roasInputById = new Map(roasInputs.map((x) => [x.id, x]));
  const roas = roasFor(roasInputs);
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
      attention.push({ kind: "tally", bookingId: b.id, label: "Code tally not in yet", detail: `${b.title} with @${b.creatorHandle}: the post is live. Enter how many customers used the code and the tally completes its SIGNL ROAS Score.` });
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
      const perf = performanceSummary(post);
      return { bookingId: b.id, title: b.title, creatorName: b.creatorName, creatorHandle: b.creatorHandle, postUrl: post.url, views: post.views || 0, likes: post.likes || 0, onTime: !!post.onTime, redemptions: b.redemptions ? { count: b.redemptions.count, basketTotal: b.redemptions.basketTotal } : null, performanceUpdatedAt: perf.updatedAt, performanceSource: perf.source, viewsGrowthPct: perf.viewsGrowthPct, roasScore: roasFor([roasInputById.get(b.id) || { ...b, planAllocation }]).score };
    });
  // Due soon (teardown B3, 2026-10-24): redeemed bookings carry
  // status "redeemed", not "booked", so a status-only filter hid
  // exactly the visits whose post clock is running. Redeemed with
  // no post yet and a future postDeadline belongs here, soonest
  // first, labeled with the time remaining.
  const nextVisits = bookings
    .filter((b) => !postByBooking.has(b.id) && (b.status === "booked" || (!!b.redeemedAt && b.postDeadline && Date.parse(b.postDeadline) > now)))
    .map((b) => ({ bookingId: b.id, title: b.title, creatorName: b.creatorName, creatorHandle: b.creatorHandle, state: b.redeemedAt ? "post_due" : "booked", stateLabel: b.redeemedAt ? "Redeemed, post clock running" : "Booked, code issued", when: b.redeemedAt ? b.postDeadline : b.redeemBy, whenLabel: b.redeemedAt ? "Post due" : "Redeem by", dueInLabel: b.redeemedAt && b.postDeadline ? `Post due in ${Math.max(0, Math.round((Date.parse(b.postDeadline) - now) / 3600000))}h` : null }))
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

  // Overhaul Stage 1 analytics extras: one shared computation
  // with the Preview dashboard (see homeAnalyticsExtras).
  const allUsersList = await allUsers();
  const userById = new Map(allUsersList.map((x) => [x.id, x]));
  const extras = homeAnalyticsExtras(
    bookings.map((b) => ({ booking: b, post: postByBooking.get(b.id) || null, creator: userById.get(b.creatorId) || null })),
    plan,
    now,
    apps
  );

  // Sig activation signals (Jeff, 2026-10-28): the market
  // inventory Sig's proactive prompts may cite, computed from
  // the SAME roster the Discover query returns (approved, not
  // tester, profile complete, not banned, in this business's
  // market, normalized exactly as discoverCards normalizes it).
  // A prompt renders only when the count behind its sentence is
  // at least 1, and the count in the sentence is the count of
  // the cohort its button's search returns.
  const sigRoster = allUsersList.filter((x) => isRosterCreator(x) && profileCompleteOf(x) && standingState(x) !== "banned" && normalizeMarketName(x.market) === (marketByName(user.market) || {}).name);
  const campusCounts = new Map();
  for (const x of sigRoster) {
    if (!campusBadgeFor(x)) continue;
    const name = universityOfRecord(x);
    if (name) campusCounts.set(name, (campusCounts.get(name) || 0) + 1);
  }
  const campusTop = [...campusCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))[0] || null;
  const sigSignals = {
    roster: sigRoster.length,
    campus: sigRoster.filter((x) => !!campusBadgeFor(x)).length,
    campusTop,
    musicians: sigRoster.filter((x) => x.creator && x.creator.musician === true).length,
    musiciansPerform: sigRoster.filter((x) => x.creator && x.creator.musician === true && x.creator.musicPerform === true).length,
    musiciansCreate: sigRoster.filter((x) => x.creator && x.creator.musician === true && x.creator.musicCreate === true).length,
    spanish: sigRoster.filter((x) => x.creator && x.creator.spanishContent === true).length,
    fresh: sigRoster.filter((x) => x.creator && x.creator.profileCompletedAt && now - Date.parse(x.creator.profileCompletedAt) < 14 * 86400000).length,
  };

  return {
    business: { name: user.business.businessName, category: user.business.category, market: user.market, planId: plan.id, planName: user.business.planName, billingStatus: user.business.billingStatus, accessState: businessAccessState(user) },
    plan: { id: plan.id, name: plan.name, priceMonthly: plan.priceMonthly, foundingCredit: plan.foundingCredit, firstMonthPriceMonthly: plan.firstMonthPriceMonthly, minMonths: plan.minMonths, visitsPerMonth: plan.visitsPerMonth },
    marketLive: await isMarketLive(user.market),
    home: {
      visitsUsed: allowance.used,
      visitsAllowance: allowance.allowance,
      visitsBase: allowance.base,
      visitsCarried: allowance.carried,
      visitsRemaining: allowance.remaining,
      carriedExpiresAt: allowance.carriedExpiresAt,
      postsLive: delivered.length,
      onTimeRatePct: delivered.length ? Math.round((onTime.length / delivered.length) * 100) : null,
      roasScore: roas.score,
      roasAllInScore: roas.allInScore,
      roas,
      totalViews,
      attention,
      pipeline: {
        invited: bookings.length,
        claimed: bookings.filter((b) => !!b.code).length,
        visitSet: bookings.filter((b) => !!b.redeemBy).length,
        clockRunning: bookings.filter((b) => !!b.redeemedAt).length,
        live: delivered.length,
      },
      planPacePct: allowance.allowance ? Math.round((allowance.used / allowance.allowance) * 100) : 0,
      topContent,
      nextVisits,
      localReachDelivered: extras.localReachDelivered,
      funnel7: extras.funnel7,
      funnel30: extras.funnel30,
      funnelPrev7: extras.funnelPrev7,
      funnelPrev30: extras.funnelPrev30,
      series30: extras.series30,
      leaderboard: extras.leaderboard,
      postsTracked30: extras.postsTracked30,
      applications30: extras.applications30,
      applicationsPrev30: extras.applicationsPrev30,
      applications7: extras.applications7,
      applicationsPrev7: extras.applicationsPrev7,
      contentLibrary: extras.contentLibrary,
      sigSignals,
      costPerVisit: extras.costPerVisit,
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

// ---------- Performance readout (Sig Operator, Jeff, 2026-10-28) ----------
// GET /me/performance-readout: one plain readout of a person's own
// numbers, for Sig and the results surfaces. Everything is computed
// on read from stored offers, bookings, posts, and license rows,
// the same inputs (and the same roasFor math) as Business Home, so
// the readout can never tell a different story from the dashboard.
// No earnings estimates anywhere: a creator's paid figure is the
// sum of RECORDED paidLane.creatorNet on their paid bookings,
// labeled recorded, never projected.
function readoutLicenseCounts(licenses) {
  const out = { pending: 0, granted: 0, declined: 0 };
  for (const l of licenses || []) {
    if (l && out[l.status] !== undefined) out[l.status] += 1;
  }
  return out;
}
async function readoutAggregates(bookingsSubset, postByBooking, licensesSubset, plan) {
  const planAllocation = plan ? plan.priceMonthly / plan.visitsPerMonth : null;
  const roasInputs = (bookingsSubset || []).map((b) => {
    const input = { ...b, post: postByBooking.get(b.id) || null };
    if (planAllocation !== null) input.planAllocation = planAllocation;
    return input;
  });
  await enrichRoasEstimateInputs(roasInputs);
  const roas = roasFor(roasInputs);
  const postsSubset = (bookingsSubset || []).map((b) => postByBooking.get(b.id)).filter(Boolean);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    visitsBooked: (bookingsSubset || []).filter((b) => b.status !== "expired" && b.status !== "cancelled").length,
    visitsRedeemed: (bookingsSubset || []).filter((b) => !!b.redeemedAt).length,
    postsLive: postsSubset.length,
    views: postsSubset.reduce((s, p) => s + num(p.views), 0),
    likes: postsSubset.reduce((s, p) => s + num(p.likes), 0),
    redemptions: roas.redemptions,
    registerValue: roas.registerValue,
    estimatedRegisterValue: roas.estimatedRegisterValue,
    roasScore: roas.score,
    series: seriesForPosts(postsSubset),
    licenseRequests: readoutLicenseCounts(licensesSubset),
  };
}
async function allLicenses() {
  const rows = await store.list("license:");
  return rows.map((r) => r.value);
}
async function businessPerformanceReadout(user) {
  const now = Date.now();
  const plan = planById(user.business.plan) || PLANS[0];
  const offers = (await allOffers()).filter((o) => o.businessId === user.id);
  const bookings = (await allBookings()).filter((b) => b.businessId === user.id);
  const posts = await allPosts();
  const postByBooking = new Map(posts.map((p) => [p.bookingId, p]));
  const licenses = (await allLicenses()).filter((l) => l.businessId === user.id);
  const rows = [];
  for (const o of offers) {
    const mine = bookings.filter((b) => b.offerId === o.id);
    const mineIds = new Set(mine.map((b) => b.id));
    const agg = await readoutAggregates(mine, postByBooking, licenses.filter((l) => mineIds.has(l.bookingId)), plan);
    rows.push({ offerId: o.id, title: o.title, kind: kindOf(o), status: o.status, ...agg });
  }
  const allowance = planAllowanceFor(bookings, plan, now);
  const overall = await readoutAggregates(bookings, postByBooking, licenses, plan);
  overall.offersLive = offers.filter((o) => o.status === "open" || o.status === "filled").length;
  overall.visitsUsed = allowance.used;
  overall.visitsAllowance = allowance.allowance;
  overall.planVisits = { used: allowance.used, allowance: allowance.allowance, base: allowance.base, carried: allowance.carried, remaining: allowance.remaining };
  const delivered = bookings.filter((b) => postByBooking.has(b.id));
  let recommendation;
  if (!delivered.length) {
    recommendation = { type: "next", text: "Your funnel fills in once your campaigns are live.", action: "create_offer" };
  } else {
    const planAllocation = plan.priceMonthly / plan.visitsPerMonth;
    const candidates = [];
    for (const b of delivered) {
      const post = postByBooking.get(b.id);
      const input = { ...b, post, planAllocation };
      await enrichRoasEstimateInputs([input]);
      const r = roasFor([input]);
      candidates.push({
        booking: b,
        post,
        redemptionsCount: b.redemptions ? Math.max(0, Math.floor(Number(b.redemptions.count) || 0)) : 0,
        basketTotal: b.redemptions ? Math.max(0, Number(b.redemptions.basketTotal) || 0) : 0,
        value: r.registerValue + r.estimatedRegisterValue,
        score: r.score,
        views: typeof post.views === "number" && Number.isFinite(post.views) ? post.views : 0,
        postMs: Date.parse(post.submittedAt || post.createdAt || "") || 0,
      });
    }
    // Deterministic best-first ranking: redemptions, then register
    // + estimated value, then the per-booking ROAS score, then
    // post views, then the most recent post.
    candidates.sort((a, b) => {
      if (b.redemptionsCount !== a.redemptionsCount) return b.redemptionsCount - a.redemptionsCount;
      if (b.value !== a.value) return b.value - a.value;
      const as = a.score === null ? -1 : a.score;
      const bs = b.score === null ? -1 : b.score;
      if (bs !== as) return bs - as;
      if (b.views !== a.views) return b.views - a.views;
      if (b.postMs !== a.postMs) return b.postMs - a.postMs;
      if (String(b.booking.createdAt || "") !== String(a.booking.createdAt || "")) return String(b.booking.createdAt || "") < String(a.booking.createdAt || "") ? -1 : 1;
      return String(a.booking.id) < String(b.booking.id) ? -1 : 1;
    });
    const win = candidates[0];
    let reason;
    if (win.redemptionsCount > 0) {
      reason = `It brought ${win.redemptionsCount} code redemption${win.redemptionsCount === 1 ? "" : "s"} ($${fmtMoneyS(win.basketTotal)} in tracked register baskets), the strongest result on your readout.`;
    } else if (win.value > 0) {
      reason = `It brought $${fmtMoneyS(win.value)} in register and estimated value, the strongest result on your readout.`;
    } else if (win.score !== null) {
      reason = `It has the strongest SIGNL ROAS Score on your readout (${win.score}).`;
    } else if (win.views > 0) {
      reason = `It drew ${win.views} views, the most on your readout.`;
    } else {
      reason = "It is your most recent delivered post.";
    }
    recommendation = {
      type: "repeat",
      bookingId: win.booking.id,
      offerId: win.booking.offerId || null,
      title: win.booking.title,
      creatorName: win.booking.creatorName,
      creatorHandle: win.booking.creatorHandle,
      reason,
    };
  }
  return { role: "business", empty: delivered.length === 0, founding: false, offers: rows, overall, recommendation };
}
async function creatorPerformanceReadout(user) {
  const bookings = (await allBookings()).filter((b) => b.creatorId === user.id);
  const posts = (await allPosts()).filter((p) => p.creatorId === user.id);
  const bookingById = new Map(bookings.map((b) => [b.id, b]));
  const apps = (await allApplications()).filter((a) => a.creatorId === user.id);
  const licenses = (await allLicenses()).filter((l) => l.creatorId === user.id);
  const paidBookings = bookings.filter((b) => b.kind === "paid" || !!b.paidLane);
  const paidRecordedNet = roasRound2(paidBookings.reduce((s, b) => s + (b.paidLane && typeof b.paidLane.creatorNet === "number" && Number.isFinite(b.paidLane.creatorNet) ? b.paidLane.creatorNet : 0), 0));
  const overall = {
    visitsBooked: bookings.filter((b) => b.status !== "expired" && b.status !== "cancelled").length,
    visitsRedeemed: bookings.filter((b) => !!b.redeemedAt).length,
    postsLive: posts.length,
    onTimePct: posts.length ? Math.round((posts.filter((p) => p.onTime).length / posts.length) * 100) : null,
    applicationsPending: apps.filter((a) => a.status === "applied" || a.status === "backfill_offered").length,
    licenseRequestsPending: licenses.filter((l) => l.status === "pending").length,
    paidBookings: paidBookings.length,
    paidRecordedNet,
  };
  const postRows = posts
    .slice()
    .sort((a, b) => (String(a.submittedAt || "") < String(b.submittedAt || "") ? 1 : -1))
    .map((p) => {
      const booking = bookingById.get(p.bookingId) || {};
      return {
        bookingId: p.bookingId,
        title: booking.title || "",
        businessName: booking.businessName || "",
        views: typeof p.views === "number" && Number.isFinite(p.views) ? p.views : null,
        likes: typeof p.likes === "number" && Number.isFinite(p.likes) ? p.likes : null,
        onTime: !!p.onTime,
        series: postSeries(p),
      };
    });
  let recommendation;
  if (!profileCompleteOf(user)) {
    recommendation = { type: "next", text: "Finish your profile so businesses can see you and book you.", action: "finish_profile" };
  } else if (!bookings.length) {
    recommendation = { type: "next", text: "Find an offer that fits and take it.", action: "find_offers" };
  } else {
    recommendation = { type: "next", text: "Track your posts and update their numbers as they grow.", action: "track" };
  }
  return { role: "creator", empty: posts.length === 0, overall, posts: postRows, recommendation };
}

// ---------- auth context ----------

async function getAuthUser(event) {
  const cookies = auth.parseCookies(event.headers.cookie || event.headers.Cookie || "");
  const token = cookies.signl_session;
  if (!token) return { user: null, token: null };
  try {
    const user = await auth.getSessionUser(token);
    return { user, token };
  } catch (e) {
    // A store failure on the session read fails safe to anonymous
    // (public routes still serve; signed-in routes answer 401)
    // instead of 500ing every route for cookie-bearing browsers.
    // See INCIDENT-2026-10-25.md.
    console.error("SIGNL getAuthUser session lookup failed (treating request as signed out):", e);
    return { user: null, token: null };
  }
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
  const claimHandle = quickClaim ? normalizeHandle(b.handle) : "";
  // The claim's handle belongs to the creator's PRIMARY platform
  // (Jeff, 2026-10-22): absent or unknown values read as Instagram,
  // exactly as every claim link already in the wild behaves.
  const claimPlatform = normalizePrimaryPlatform(b.primaryPlatform);
  if (quickClaim) {
    if (!claimHandle) return err(400, `Your ${primaryPlatformLabel(claimPlatform)} handle is required`);
    if (b.agreedHonestPosts !== true) return err(400, "Please confirm the honest-post rule: no business can ever require a positive post.");
    if (b.agreedFtcDisclosure !== true) return err(400, "Please confirm you will disclose every comp in your posts, as the FTC requires.");
    if (b.agreedPostCompliance !== true) return err(400, "Please confirm the post rule: post within 48 hours of a comped visit for full credit and paste the post link in the app. A late post inside the catch-up window still counts. If a post never lands, the visit does not count, and repeated misses can pause your account.");
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
  // A business in a not-yet-listed city joins the founding list
  // exactly the way a creator signals a city (UX audit fix,
  // 2026-10-22): the record carries their typed city, the account
  // stays founding-gated like every founding business, and their
  // sign-up counts toward opening the market. Nobody dead-ends.
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
  if (existing) return err(409, "An account with this email already exists. Sign in instead, or use Forgot password on the sign-in page to reset it.");

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

  // Language preference (Spanish layers S1, Jeff, 2026-10-28):
  // a creator who arrived through the Spanish claim path
  // (?lang=es on the link, persisted by the client like the
  // signup source) is recorded as Spanish-preferring. Only the
  // exact value "es" stores anything; every other value, and
  // absence, stores nothing (English is the unmarked default).
  // Sig reads it (see /api/sig/ask); nothing gates on it.
  if (role === "creator" && b.lang === "es") user.lang = "es";

  // Typed-city resolution (Jeff, 2026-10-23): a not-listed sign-up
  // whose typed city already belongs to a market is filed under
  // that metro at intake (Portsmouth -> Virginia Beach), keeping
  // the typed city as the home city. A tie stores its candidate
  // metros on the record for a one-tap pick; no match leaves the
  // record in the not-listed pool exactly as before.
  if (unlisted) applyTypedCityResolution(user, customCity);

  // University resolution runs once here; both creator record
  // builders below read it, so a dataset pick, an alias, and a
  // free-typed school all land in the same canonical shape.
  const uniResolved = resolveUniversity(b.university);

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
      primaryPlatform: claimPlatform,
      primaryProfileUrl: primaryPlatformUrl(claimPlatform, claimHandle),
      instagramUrl: claimPlatform === "instagram" ? `https://instagram.com/${claimHandle}` : null,
      tiktokHandle: claimPlatform === "tiktok" ? claimHandle : null,
      tiktokUrl: claimPlatform === "tiktok" ? `https://www.tiktok.com/@${claimHandle}` : null,
      youtubeChannel: claimPlatform === "youtube" ? claimHandle : null,
      facebookUrl: claimPlatform === "facebook" ? `https://www.facebook.com/${claimHandle}` : null,
      xHandle: claimPlatform === "x" ? claimHandle : null,
      xUrl: claimPlatform === "x" ? `https://x.com/${claimHandle}` : null,
      linkedinUrl: claimPlatform === "linkedin" ? `https://www.linkedin.com/in/${claimHandle}` : null,
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
      licensingFee: null,
      bio: "",
      bestWork: [],
      maxVisitsPerWeek: 3,
      neighborhood: "",
      university: uniResolved.name,
      universityCity: uniResolved.city,
      universityState: uniResolved.state,
      universityUnverified: uniResolved.name ? !uniResolved.verified : false,
      universityStatus: normalizeUniversityStatus(b.universityStatus),
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
      profession: "",
      farmAreas: [],
      brokerage: "",
    };
  } else if (role === "creator") {
    // The founding creator profile builder. Required: a handle on the
    // creator's primary platform (Jeff, 2026-10-22: the picker comes
    // first, "Where is your main audience?"), home city inside the
    // chosen market, follower count, at least one content category,
    // self-reported local audience %, and both rule acknowledgments
    // (honest posts, FTC disclosure).
    const primaryPlatform = normalizePrimaryPlatform(b.primaryPlatform);
    const handle = normalizeHandle(b.handle);
    if (!handle) return err(400, `Your ${primaryPlatformLabel(primaryPlatform)} handle is required`);
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
    if (b.agreedPostCompliance !== true) return err(400, "Please confirm the post rule: post within 48 hours of a comped visit for full credit and paste the post link in the app. A late post inside the catch-up window still counts. If a post never lands, the visit does not count, and repeated misses can pause your account.");
    if (b.agreedTerms !== true) return err(400, "Please agree to the Terms of Service and Privacy Policy, and to receiving account and marketing emails from SIGNL.");
    // Audience stacking (Jeff, 2026-10-19): the sign-up's follower
    // count is the count on the creator's PRIMARY platform (Jeff,
    // 2026-10-22: it was the Instagram count when Instagram was the
    // only door; the picker generalizes it); any other platform
    // counts the creator reports join the stack, and the tier reads
    // the stacked TOTAL. The band is FULLY AUTOMATIC (Jeff,
    // 2026-10-19 01:46): it is always tierForFollowers(totalAudience).
    // A client-sent tierBand (including the ?tier= claim-link
    // prefill, which is still accepted as a param) never sets the
    // band; nobody picks or confirms their own category. A non-
    // Instagram primary may report ZERO Instagram followers without
    // failing: the stack, not any single platform, carries the tier.
    // The stored followerCount keeps its historical meaning (the
    // Instagram count) for the surfaces that read it directly.
    const stack = normalizeAudienceStack(b.audienceStack);
    if (!stack[primaryPlatform] && followers > 0) stack[primaryPlatform] = followers;
    const totalAudience = Object.values(stack).reduce((s, n) => s + n, 0);
    const suggestedTier = tierForFollowers(totalAudience);
    const tier = suggestedTier;
    // The primary handle doubles as that platform's social link when
    // the creator did not fill the platform's own field separately.
    const tiktok = normalizeHandle(b.tiktokHandle) || (primaryPlatform === "tiktok" ? handle : "");
    const youtube = (b.youtubeChannel || "").trim() || (primaryPlatform === "youtube" ? handle : "");
    const socials = normalizeSocials(b);
    if (!socials.facebookUrl && primaryPlatform === "facebook") socials.facebookUrl = `https://www.facebook.com/${handle}`;
    if (!socials.xHandle && primaryPlatform === "x") { socials.xHandle = handle; socials.xUrl = `https://x.com/${handle}`; }
    if (!socials.linkedinUrl && primaryPlatform === "linkedin") socials.linkedinUrl = `https://www.linkedin.com/in/${handle}`;
    user.city = city;
    user.creator = {
      handle,
      primaryPlatform,
      primaryProfileUrl: primaryPlatformUrl(primaryPlatform, handle),
      instagramUrl: primaryPlatform === "instagram" ? `https://instagram.com/${handle}` : null,
      tiktokHandle: tiktok || null,
      tiktokUrl: tiktok ? `https://www.tiktok.com/@${tiktok}` : null,
      youtubeChannel: youtube || null,
      facebookUrl: socials.facebookUrl,
      xHandle: socials.xHandle,
      xUrl: socials.xUrl,
      linkedinUrl: socials.linkedinUrl,
      followerCount: stack.instagram || 0,
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
      // Licensing (Jeff, 2026-10-26): the fee at which a business
      // can license one of her delivered comped posts for the
      // standard 90 days of repost + ad use. Null until she lists
      // one in profile settings; every request still needs her
      // approval, per post.
      licensingFee: null,
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
      university: uniResolved.name,
      universityCity: uniResolved.city,
      universityState: uniResolved.state,
      universityUnverified: uniResolved.name ? !uniResolved.verified : false,
      universityStatus: normalizeUniversityStatus(b.universityStatus),
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
      profession: cleanProfession(b.profession),
      farmAreas: [],
      brokerage: "",
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
      // Business ZIP (Build -31): optional at sign-up, editable
      // from the profile; the anchor proximity bands measure
      // from. Invalid values store nothing.
      zip: typeof b.zip === "string" && /^\d{5}$/.test(b.zip.trim()) ? b.zip.trim() : "",
      // Menu of Moments (Build -32): the moment chosen on the
      // founding application, when one was picked. Optional,
      // validated against the shared list; anything else stores
      // null.
      moment: validMoment(b.moment),
      // Apply by Conversation (Build -32): which surface filed
      // this application. The record is the SAME record either
      // way; only the stamp differs. Anything but the exact
      // conversation stamp reads as the form.
      applicationSource: b.applicationSource === "conversation" ? "conversation" : "form",
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
      // Referral-program tie-in (Jeff, 2026-10-25): empty at
      // sign-up. The business may save its own tracked referral
      // link/code/note from its POS or booking stack (Plan tab);
      // creators then see it on the business's opportunities and
      // booked visits. SIGNL never touches referral money.
      referralUrl: "",
      referralCode: "",
      referralNote: "",
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
    user.universityStatus = normalizeUniversityStatus(user.creator.universityStatus);
    user.creator.universityStatus = user.universityStatus;
    user.universityCity = user.creator.universityCity || "";
    user.universityState = user.creator.universityState || "";
    user.universityUnverified = user.creator.universityUnverified === true;
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
        ? { quickClaim: !!quickClaim, profileComplete: user.creator.profileComplete === true, handle: user.creator.handle, primaryPlatform: primaryPlatformOf(user.creator), city: user.city, neighborhood: user.creator.neighborhood, university: user.creator.university, state: user.state, country: user.country, unlisted: user.market === UNLISTED, followerCount: user.creator.followerCount, audienceStack: user.creator.audienceStack, totalAudience: user.creator.totalAudience, tierBand: normalizeTierBand(user.creator.tierBand), suggestedTier: normalizeTierBand(user.creator.suggestedTier), localAudiencePct: user.creator.localAudiencePct, localAudienceSource: user.creator.localAudienceSource, categories: user.creator.categories, compCategories: user.creator.compCategories, openToPaidCampaigns: user.creator.openToPaidCampaigns, profession: user.creator.profession || "", agreedPostCompliance: true, termsVersion: TERMS_VERSION, marketingEmailConsent: true, ...(user.referredBy ? { referredBy: user.referredBy } : {}), ...(user.signupSource ? { signupSource: user.signupSource } : {}) }
        : { businessName: user.business.businessName, category: user.business.category, plan: user.business.plan, planPriceMonthly: user.business.planPriceMonthly, ...(user.referredBy ? { referredBy: user.referredBy } : {}), ...(user.signupSource ? { signupSource: user.signupSource } : {}) },
  });
  // Standing-authority auto-decision (Jeff, 2026-10-22): a creator
  // claim that is an exact test/spam match is rejected here, and
  // one that verifiably matches our outreach evidence is approved
  // here, with the manual decision's exact side effects. Anything
  // else stays pending for a person. A decided claim skips the
  // "in the review queue" confirmation email below: an approved
  // creator gets the approval email instead, and a rejected test
  // claim gets nothing. Failure here must never fail a sign-up.
  let autoDecision = null;
  if (role === "creator") {
    try {
      const evidence = await buildAutoEvidence();
      autoDecision = await applyAutoDecision(user, await allUsers(), evidence);
    } catch (e) { /* auto-decisions are best-effort; manual review remains */ }
  }
  if (role === "creator" && !quickClaim && (!autoDecision || autoDecision.action !== "rejected")) {
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

  if (role === "creator" && !autoDecision) {
    // Sign-up confirmation email (Jeff, 2026-10-18). Queued as an event
    // always; sent immediately when the SMTP transport is configured.
    // Email trouble must never fail a registration, hence the try/catch.
    try {
      const summary = await foundingSummary(user);
      const band = foundingBand(summary && summary.queuePosition);
      const mail = quickClaim ? claimConfirmationEmail(user, band) : signupConfirmationEmail(user, band);
      // Both step-one confirmations promise "unsubscribe at any
      // time" in the copy, so the mail carries the List-Unsubscribe
      // header that makes the promise real.
      await deliverEmail("signup_confirmation", user, mail.subject, mail.text, band, { listUnsubscribe: true });
    } catch (e) { /* email is best-effort; the queued events tell the story */ }
  }

  const token = await auth.createSession(id);
  const secure = (event.headers["x-forwarded-proto"] || "").includes("https");
  return json(201, { user: await withFounding(user) }, { "Set-Cookie": auth.sessionCookie(token, secure) });
}

const igPrefillHits = new Map();
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

// ---------- password reset + change (UX audit fix, 2026-10-22) ----------
// A forgotten password used to be a permanent lockout: no reset
// route existed, and re-registering the same email just 409ed.
// The flow: POST /auth/forgot emails a single-use link (token in
// the URL, only its SHA-256 hash at rest, one hour to live);
// POST /auth/reset trades a live token for a new password and
// revokes every session the account holds. The forgot endpoint
// answers identically whether or not the account exists, and is
// throttled per email+IP, so it cannot enumerate accounts.
// SIGNL_RESET_TTL_MS exists so the verify suites can exercise the
// expiry path without waiting an hour; production leaves it unset.
const RESET_TTL_MS = (() => {
  const n = parseInt(process.env.SIGNL_RESET_TTL_MS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 1000;
})();

function resetTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function passwordResetEmail(user, resetUrl) {
  const first = greetingName(user);
  const subject = "Reset your SIGNL password";
  const lines = [
    `Hi ${first},`,
    "",
    "We got a request to reset the password on your SIGNL account. Open this link to set a new one:",
    resetUrl,
    "",
    "The link works once and expires in one hour. If you did not ask for a reset, you can ignore this email: your password stays exactly as it is.",
    "",
    "National platforms sell reach. We sell regulars.",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com",
  ];
  return { subject, text: lines.join("\n") };
}

const forgotAttempts = new Map();
async function handleForgot(event) {
  const b = parseBody(event);
  const email = String(b.email || "").toLowerCase().trim();
  const ip = (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown").toString();
  const key = `${email}|${ip}`;
  const now = Date.now();
  const attempts = (forgotAttempts.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  attempts.push(now);
  forgotAttempts.set(key, attempts);
  // The response never changes shape: account or no account,
  // throttled or not, the caller hears the same thing.
  const payload = { ok: true };
  try {
    const idx = email ? await store.get(`email:${email}`) : null;
    const user = idx ? await store.get(`user:${idx.userId}`) : null;
    if (user && attempts.length <= 5) {
      const token = crypto.randomBytes(32).toString("hex");
      const hash = resetTokenHash(token);
      const prev = await store.get(`pwreset-user:${user.id}`);
      if (prev && prev.tokenHash && prev.tokenHash !== hash) await store.del(`pwreset:${prev.tokenHash}`);
      const created = new Date(now).toISOString();
      await store.set(`pwreset:${hash}`, { userId: user.id, email: user.email, createdAt: created, expiresAt: new Date(now + RESET_TTL_MS).toISOString() });
      await store.set(`pwreset-user:${user.id}`, { tokenHash: hash, createdAt: created });
      const base = process.env.APP_URL || "https://app.joinsignl.com";
      const mail = passwordResetEmail(user, `${base}/?reset=${token}`);
      await deliverEmail("password_reset", user, mail.subject, mail.text, null);
      // Test hook, same trust boundary as SIGNL_TEST_ALLOW_BUSINESS
      // (never set in the deploy environment): the suites cannot
      // read the mailbox, so in TEST_MODE the response carries the
      // token and they can drive the flow end to end. Production
      // responses never include it.
      if (TEST_MODE) payload.devResetToken = token;
    }
  } catch (e) { /* a store or mail hiccup never changes the neutral answer */ }
  return json(200, payload);
}

async function handleReset(event) {
  const b = parseBody(event);
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (!token) return err(400, "That reset link is not valid. Request a new one from the sign-in page.");
  if (typeof b.password !== "string" || b.password.length < 10) return err(400, "Password must be at least 10 characters");
  const hash = resetTokenHash(token);
  const rec = await store.get(`pwreset:${hash}`);
  if (!rec) return err(400, "That reset link is not valid, or it has already been used. Request a new one from the sign-in page.");
  if (Date.now() > Date.parse(rec.expiresAt)) {
    await store.del(`pwreset:${hash}`);
    const idxRec = await store.get(`pwreset-user:${rec.userId}`);
    if (idxRec && idxRec.tokenHash === hash) await store.del(`pwreset-user:${rec.userId}`);
    return err(400, "That reset link has expired. Request a new one from the sign-in page.");
  }
  const user = await store.get(`user:${rec.userId}`);
  if (!user) {
    await store.del(`pwreset:${hash}`);
    return err(400, "That reset link is not valid. Request a new one from the sign-in page.");
  }
  const { salt, hash: pwHash } = auth.hashPassword(b.password);
  user.passwordSalt = salt;
  user.passwordHash = pwHash;
  user.updatedAt = nowIso();
  await store.set(`user:${user.id}`, user);
  await store.del(`pwreset:${hash}`);
  await store.del(`pwreset-user:${user.id}`);
  // The credential changed: every existing session signs out.
  await auth.revokeSessionsForUser(user.id);
  await logEvent({ type: "password_reset_completed", actorId: user.id, actorRole: user.role, subjectId: user.id, market: user.market || null, data: {} });
  return json(200, { ok: true });
}

async function handleChangePassword(event, ctx) {
  if (!ctx.user) return err(401, "Not signed in");
  const b = parseBody(event);
  const user = ctx.user;
  if (!auth.verifyPassword(b.currentPassword || "", user.passwordSalt, user.passwordHash)) {
    return err(401, "Your current password did not match.");
  }
  if (typeof b.newPassword !== "string" || b.newPassword.length < 10) return err(400, "Password must be at least 10 characters");
  const { salt, hash } = auth.hashPassword(b.newPassword);
  user.passwordSalt = salt;
  user.passwordHash = hash;
  user.updatedAt = nowIso();
  await store.set(`user:${user.id}`, user);
  // Keep this device signed in; every other session signs out.
  await auth.revokeSessionsForUser(user.id, ctx.token);
  await logEvent({ type: "password_changed", actorId: user.id, actorRole: user.role, subjectId: user.id, market: user.market || null, data: {} });
  return json(200, { ok: true });
}

// ---------- main router ----------

// ---------- Stripe Connect paid lane (Jeff, 2026-10-26) ----------
// The paid lane's money movement, built ready-but-off behind the
// same env gate as subscription billing (lib/connect.js). Creators
// hold Connect Express accounts (onboarding is Stripe-hosted and
// resumable; the record carries only our plain state). Businesses
// hold a card on file, never a Stripe account. A paid booking
// authorizes the card (manual capture) at booking: funds "held".
// The compliance sweep's existing escrow release (proof + 48h
// hold) captures the charge and transfers the creator's share.
// A booking whose creator has not finished payout setup stays
// held and the creator is prompted; nothing strands at Stripe.
// With no Stripe keys, none of this runs: bookings carry no
// funds object and the recorded-ledger behavior is untouched.
const FUNDS_HELD_NOTE = "SIGNL is holding this payment until the post is live.";

function storedPayouts(user) {
  const p = (user && user.creator && user.creator.payouts) || null;
  return {
    accountId: p && p.accountId ? p.accountId : null,
    status: p && p.status ? p.status : "not_started",
    ready: !!(p && p.ready),
    missing: p && Array.isArray(p.missing) ? p.missing : [],
    updatedAt: p && p.updatedAt ? p.updatedAt : null,
  };
}

function payoutsClientView(user) {
  const p = storedPayouts(user);
  return { status: p.status, ready: p.ready, missing: p.missing, updatedAt: p.updatedAt };
}

// Refresh a creator's stored payout state from Stripe. No-ops
// (returns the stored state) when the creator has no account or
// the rail is off, and on any Stripe error: a payout read must
// never break a request.
async function refreshCreatorPayouts(user) {
  const current = storedPayouts(user);
  if (!current.accountId || !connect.connectConfigured()) return current;
  try {
    const account = await connect.getConnectedAccount(current.accountId);
    const next = { accountId: current.accountId, ...connect.payoutStateFromAccount(account), updatedAt: nowIso() };
    user.creator = user.creator || {};
    user.creator.payouts = next;
    user.updatedAt = nowIso();
    await store.set(`user:${user.id}`, user);
    return next;
  } catch (e) {
    console.error("SIGNL payout refresh failed:", e);
    return current;
  }
}

function businessCardOnFile(biz) {
  const billing = (biz && biz.business && biz.business.billing) || null;
  if (!billing || !billing.customerId || !billing.card || !billing.card.paymentMethodId) return null;
  return { customerId: billing.customerId, card: billing.card };
}

// Attach real money to a freshly created paid booking: authorize
// the business's card on file for the booking total, held on the
// platform side. Never throws: the outcome is a funds state on
// the booking (held / needs_card / charge_failed) plus an event,
// so every caller can persist and report it. Returns null when
// the rail is off (the booking then carries no funds at all,
// exactly as before Connect).
async function attachPaidFunds(booking, bizUser) {
  const lane = booking.paidLane;
  if (!lane || !connect.connectConfigured()) return null;
  const onFile = businessCardOnFile(bizUser);
  if (!onFile) {
    lane.funds = { state: "needs_card", paymentIntentId: null, transferId: null, blockedReason: null, heldAt: null, releasedAt: null, refundedAt: null };
    await logEvent({ type: "paid_funds_needs_card", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, businessTotal: lane.businessTotal } });
    return lane.funds;
  }
  try {
    const pi = await connect.createHeldCharge({
      customerId: onFile.customerId,
      paymentMethodId: onFile.card.paymentMethodId,
      amountDollars: lane.businessTotal,
      bookingId: booking.id,
      businessId: booking.businessId,
      creatorId: booking.creatorId,
    });
    lane.funds = { state: "held", paymentIntentId: pi.id, transferId: null, blockedReason: null, heldAt: nowIso(), releasedAt: null, refundedAt: null };
    lane.paymentNote = FUNDS_HELD_NOTE;
    await logEvent({ type: "paid_funds_held", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, businessTotal: lane.businessTotal, paymentIntentId: pi.id } });
  } catch (e) {
    lane.funds = { state: "charge_failed", paymentIntentId: null, transferId: null, blockedReason: null, heldAt: null, releasedAt: null, refundedAt: null };
    await logEvent({ type: "paid_funds_charge_failed", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, businessTotal: lane.businessTotal, error: String((e && e.message) || e).slice(0, 200) } });
  }
  return lane.funds;
}

// The money half of the sweep's escrow release. Returns true
// when the release may proceed: no funds (ledger-only booking),
// or the charge captured and the creator's share transferred.
// Returns false when the release must wait: the creator's payout
// setup is unfinished (they are prompted, once per block) or
// Stripe errored (retried on the next sweep; a captured charge
// is detected by status, never captured twice).
async function releasePaidFunds(booking) {
  const lane = booking.paidLane;
  const funds = lane && lane.funds;
  if (!funds) return true;
  if (funds.state === "released") return true;
  if (funds.state !== "held") return false;
  const creator = await store.get(`user:${booking.creatorId}`);
  const payouts = creator ? await refreshCreatorPayouts(creator) : { ready: false, accountId: null };
  if (!payouts.ready || !payouts.accountId) {
    if (funds.blockedReason !== "payouts_not_ready") {
      funds.blockedReason = "payouts_not_ready";
      funds.blockedAt = nowIso();
      booking.updatedAt = nowIso();
      await store.set(`booking:${booking.id}`, booking);
      await logEvent({ type: "paid_release_blocked", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, reason: "payouts_not_ready", creatorNet: lane.creatorNet } });
      if (creator) {
        await notifyMilestone(creator.id, "payout_setup_needed",
          `Your $${fmtMoneyS(lane.creatorNet)} from ${booking.businessName || "a paid visit"} is ready to release, but your payouts are not set up yet. Finish payout setup under Profile so it can reach your bank.`,
          `Your $${fmtMoneyS(lane.creatorNet)} is waiting: finish payout setup`,
          [`Your paid visit for ${booking.businessName || "a business"} delivered, and your share of $${fmtMoneyS(lane.creatorNet)} is ready to release.`, "", "It cannot reach your bank until payout setup is finished. It takes a couple of minutes, inside the app under Profile, in the Paid bookings section: Stripe holds the bank details, SIGNL never sees them.", "", "Open SIGNL: https://app.joinsignl.com", "", "Jeff", "Founder, SIGNL"].join("\n"),
          { bookingId: booking.id });
      }
    }
    return false;
  }
  try {
    const pi = await connect.getPaymentIntent(funds.paymentIntentId);
    if (pi && pi.status === "requires_capture") await connect.captureHeldCharge(funds.paymentIntentId);
    const transfer = await connect.createPayoutTransfer({ amountDollars: lane.creatorNet, destinationAccountId: payouts.accountId, bookingId: booking.id, creatorId: booking.creatorId });
    funds.state = "released";
    funds.transferId = transfer.id;
    funds.blockedReason = null;
    funds.releasedAt = nowIso();
    await logEvent({ type: "paid_funds_released", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, creatorNet: lane.creatorNet, transferId: transfer.id, paymentIntentId: funds.paymentIntentId } });
    return true;
  } catch (e) {
    if (funds.blockedReason !== "stripe_error") {
      funds.blockedReason = "stripe_error";
      funds.blockedAt = nowIso();
      booking.updatedAt = nowIso();
      await store.set(`booking:${booking.id}`, booking);
      await logEvent({ type: "paid_release_blocked", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, reason: "stripe_error", error: String((e && e.message) || e).slice(0, 200) } });
    }
    return false;
  }
}

// The money half of an escrow refund: a held authorization is
// cancelled before capture, so the business is refunded in full
// and no transfer ever occurs. A charge that was somehow already
// captured is refunded through /refunds instead. Failures are
// recorded as a funds state + event for a human, never silent.
async function refundPaidFunds(booking, reason) {
  const lane = booking.paidLane;
  const funds = lane && lane.funds;
  if (!funds || funds.state !== "held" || !funds.paymentIntentId) return;
  try {
    const pi = await connect.getPaymentIntent(funds.paymentIntentId);
    if (pi && pi.status === "succeeded") {
      const refund = await connect.refundPaymentIntent(funds.paymentIntentId);
      funds.refundId = (refund && refund.id) || null;
    } else {
      await connect.cancelHeldCharge(funds.paymentIntentId);
    }
    funds.state = "refunded";
    funds.refundedAt = nowIso();
    await logEvent({ type: "paid_funds_refunded", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, businessTotal: lane.businessTotal, reason, paymentIntentId: funds.paymentIntentId } });
  } catch (e) {
    funds.state = "refund_failed";
    await logEvent({ type: "paid_funds_refund_failed", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, businessId: booking.businessId, reason, error: String((e && e.message) || e).slice(0, 200) } });
  }
}

// When a paid booking lands for a creator whose payout setup is
// unfinished, prompt them once, in-app and by email: the money
// will be held safely, but it cannot reach their bank until
// setup is done. Only fires while the rail is live.
async function promptCreatorPayoutSetup(booking, creator) {
  if (!connect.connectConfigured() || !creator || creator.role !== "creator") return;
  if (storedPayouts(creator).ready) return;
  const lane = booking.paidLane || {};
  await notifyMilestone(creator.id, "payout_setup_needed",
    `${booking.businessName || "A business"} booked you at your listed rate of $${fmtPriceS(lane.rate || 0)}. Set up payouts under Profile so your $${fmtMoneyS(lane.creatorNet || 0)} can reach your bank when your post is live.`,
    `Paid booking: set up payouts so your money can reach you`,
    [`${booking.businessName || "A business"} booked you at your listed rate of $${fmtPriceS(lane.rate || 0)}. Your share is $${fmtMoneyS(lane.creatorNet || 0)}.`, "", "Paid bookings pay out to your bank after your post is live, and that needs payout setup first: a couple of minutes under Profile, in the Paid bookings section. Stripe holds the bank details; SIGNL never sees them. Comp visits never need this.", "", "Open SIGNL: https://app.joinsignl.com", "", "Jeff", "Founder, SIGNL"].join("\n"),
    { bookingId: booking.id });
}

// ---------- Stripe subscriptions (Jeff, 2026-10-23) ----------
// App-side subscription billing for the three founding plans.
// The live Stripe account (Extra Medium LLC) already carries the
// products; these price IDs are the live ones (see
// files/signl-stripe-live.md). Billing NEVER touches the founding
// gate: checkout refuses a business whose accessState is not
// "active", and webhook updates write only business.subscription.
// The concierge flow (Jeff hand-sends a payment link at
// activation) keeps working untouched; this is the self-serve
// rail beside it, live only once STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET are set in the Netlify env.
const STRIPE_PLAN_PRICES = {
  "price_1USRLTJ5DCULBlmAES4a3fNV": "self-service",
  "price_1USRLcJ5DCULBlmAajXPmJjr": "growth",
  "price_1USRLiJ5DCULBlmAZoITfl6r": "managed",
};
function stripePlanForPrice(priceId) {
  const planId = STRIPE_PLAN_PRICES[priceId];
  return planId ? planById(planId) : null;
}
function stripePriceForPlan(planId) {
  for (const [priceId, id] of Object.entries(STRIPE_PLAN_PRICES)) {
    if (id === planId) return priceId;
  }
  return null;
}
function stripePlanFields(plan) {
  return plan ? { plan: plan.id, planName: plan.name, planPriceMonthly: plan.priceMonthly } : {};
}

async function updateBusinessSubscription(biz, patch) {
  const record = (await store.get(`user:${biz.id}`)) || biz;
  if (!record || record.role !== "business") return null;
  record.business = record.business || {};
  record.business.subscription = { ...(record.business.subscription || {}), ...patch, updatedAt: nowIso() };
  record.updatedAt = nowIso();
  await store.set(`user:${record.id}`, record);
  return record;
}

// Resolve the business a Stripe object belongs to: the explicit
// businessId (client_reference_id / metadata) first, then a scan
// by the stored Stripe customer or subscription id.
async function findBusinessForStripe({ businessId = null, customerId = null, subscriptionId = null } = {}) {
  if (businessId) {
    const u = await store.get(`user:${businessId}`);
    if (u && u.role === "business") return u;
  }
  if (!customerId && !subscriptionId) return null;
  const users = await allUsers();
  return users.find((u) => u.role === "business" && u.business && u.business.subscription
    && ((subscriptionId && u.business.subscription.id === subscriptionId)
      || (customerId && u.business.subscription.customerId === customerId))) || null;
}

async function handleStripeWebhook(event) {
  if (!stripe.webhookConfigured()) return err(503, "Billing is not configured.");
  let raw = event.body || "";
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  const signature = (event.headers && (event.headers["stripe-signature"] || event.headers["Stripe-Signature"])) || "";
  let evt = null;
  try {
    evt = stripe.verifyWebhookEvent(raw, signature, stripe.stripeWebhookSecret());
  } catch (e) {
    return err(400, "Webhook signature verification failed");
  }
  const obj = (evt && evt.data && evt.data.object) || {};
  try {
    if (evt.type === "checkout.session.completed" && obj.mode === "setup") {
      // Card on file (Connect phase 2, 2026-10-26): a setup-mode
      // session carries no subscription, only a SetupIntent whose
      // payment method becomes the business's card on file. The
      // subscription branch below must never see these.
      const businessId = obj.client_reference_id || (obj.metadata && obj.metadata.businessId) || null;
      const biz = await findBusinessForStripe({ businessId, customerId: obj.customer || null });
      if (biz && obj.setup_intent) {
        const si = await connect.getSetupIntent(obj.setup_intent);
        const pmId = si && si.payment_method;
        if (pmId) {
          const pm = await connect.getPaymentMethod(pmId);
          const card = connect.cardViewFromPaymentMethod(pm);
          const record = (await store.get(`user:${biz.id}`)) || biz;
          record.business = record.business || {};
          record.business.billing = record.business.billing || {};
          record.business.billing.customerId = obj.customer || record.business.billing.customerId || null;
          record.business.billing.card = { ...card, updatedAt: nowIso() };
          record.updatedAt = nowIso();
          await store.set(`user:${record.id}`, record);
          await logEvent({ type: "billing_card_saved", actorId: null, actorRole: "system", subjectId: biz.id, market: biz.market || null, data: { brand: card.brand, last4: card.last4 } });
        }
      }
    } else if (evt.type === "account.updated") {
      // A creator's Connect account changed at Stripe (onboarding
      // finished, a requirement landed, a restriction applied):
      // mirror the plain state onto their record.
      const users = await allUsers();
      const creator = users.find((u) => u.role === "creator" && u.creator && u.creator.payouts && u.creator.payouts.accountId === obj.id);
      if (creator) {
        const state = connect.payoutStateFromAccount(obj);
        creator.creator.payouts = { accountId: obj.id, ...state, updatedAt: nowIso() };
        creator.updatedAt = nowIso();
        await store.set(`user:${creator.id}`, creator);
        await logEvent({ type: "payout_account_updated", actorId: null, actorRole: "system", subjectId: creator.id, market: creator.market || null, data: { status: state.status, ready: state.ready } });
      }
    } else if (evt.type === "checkout.session.completed") {
      const businessId = obj.client_reference_id || (obj.metadata && obj.metadata.businessId) || null;
      const biz = await findBusinessForStripe({ businessId, customerId: obj.customer || null, subscriptionId: obj.subscription || null });
      if (biz) {
        const plan = stripePlanForPrice(obj.metadata && obj.metadata.priceId) || planById(biz.business && biz.business.plan);
        await updateBusinessSubscription(biz, {
          id: obj.subscription || null,
          customerId: obj.customer || null,
          status: obj.payment_status === "paid" ? "active" : "incomplete",
          ...stripePlanFields(plan),
        });
        await logEvent({ type: "billing_checkout_completed", actorId: null, actorRole: "system", subjectId: biz.id, market: biz.market || null, data: { subscriptionId: obj.subscription || null, customerId: obj.customer || null } });
      }
    } else if (evt.type === "customer.subscription.created" || evt.type === "customer.subscription.updated" || evt.type === "customer.subscription.deleted") {
      const businessId = (obj.metadata && obj.metadata.businessId) || null;
      const biz = await findBusinessForStripe({ businessId, customerId: obj.customer || null, subscriptionId: obj.id || null });
      if (biz) {
        const item = obj.items && Array.isArray(obj.items.data) ? obj.items.data[0] : null;
        const plan = (item && item.price && stripePlanForPrice(item.price.id)) || stripePlanForPrice(obj.metadata && obj.metadata.priceId) || null;
        await updateBusinessSubscription(biz, {
          id: obj.id || null,
          customerId: obj.customer || null,
          status: evt.type === "customer.subscription.deleted" ? "canceled" : (obj.status || "active"),
          currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
          ...stripePlanFields(plan),
          ...(evt.type === "customer.subscription.deleted" ? { canceledAt: nowIso() } : {}),
        });
        await logEvent({ type: "billing_subscription_updated", actorId: null, actorRole: "system", subjectId: biz.id, market: biz.market || null, data: { subscriptionId: obj.id || null, status: evt.type === "customer.subscription.deleted" ? "canceled" : (obj.status || null), eventType: evt.type } });
      }
    } else if (evt.type === "invoice.payment_failed") {
      const biz = await findBusinessForStripe({ customerId: obj.customer || null, subscriptionId: obj.subscription || null });
      if (biz) {
        await updateBusinessSubscription(biz, { status: "past_due", lastPaymentFailedAt: nowIso() });
        await logEvent({ type: "billing_payment_failed", actorId: null, actorRole: "system", subjectId: biz.id, market: biz.market || null, data: { subscriptionId: obj.subscription || null, customerId: obj.customer || null } });
      }
    }
  } catch (e) {
    // The signature verified, so the event is authentic; a data
    // problem on our side should not put Stripe into a retry loop.
    console.error("SIGNL Stripe webhook handling error:", e);
  }
  return json(200, { received: true });
}

// ---------- Founding business applications (site safety net) ----------
// The founding business application form lives on joinsignl.com and
// posts to Netlify Forms as its system of record. On 2026-10-28 a real
// applicant (GleekOps, Denver) hit the form's error state and her
// submission never reached Netlify: no record, no notification. This
// endpoint is the independent second capture path the site falls back
// to when the Netlify POST fails (after one retry): it stores the
// application in our own store (key bizapp:{uuid}) and emails the
// team inbox. The save never depends on the email step: a mail
// failure is noted on the record and the applicant still succeeds.
// Validation contract: a malformed payload gets a 400 and writes
// nothing, which doubles as the daily health check's safe probe.
const FOUNDING_APPLICATION_ORIGINS = ["https://joinsignl.com", "https://www.joinsignl.com"];

function foundingApplicationCors(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || "";
  const allow = FOUNDING_APPLICATION_ORIGINS.indexOf(origin) > -1 ? origin : FOUNDING_APPLICATION_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

async function handleFoundingApplication(event) {
  const cors = foundingApplicationCors(event);
  const b = parseBody(event);
  // Honeypot (same field name as the site form): a filled bot-field
  // means a bot. Mirror the primary path's behavior: report success,
  // store nothing, send nothing.
  if (typeof b["bot-field"] === "string" && b["bot-field"].trim() !== "") {
    return json(200, { ok: true }, cors);
  }
  const clean = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const rec = {
    businessName: clean(b.business_name != null ? b.business_name : b.businessName, 200),
    category: clean(b["business-category"] != null ? b["business-category"] : b.category, 120),
    type: clean(b["business-type"] != null ? b["business-type"] : b.type, 120),
    contactName: clean(b.contact_name != null ? b.contact_name : b.contactName, 120),
    email: clean(b.email, 200),
    phone: clean(b.phone, 60),
    city: clean(b.city, 160),
    tierInterest: clean(b.tier_interest != null ? b.tier_interest : b.tierInterest, 120),
    source: "site-fallback",
    createdAt: nowIso(),
  };
  // Preferred language (Spanish layers S3, Jeff, 2026-10-28):
  // the Spanish business page (negocios.html) routes its
  // applicants through the same form carrying lang=es, so the
  // application is recorded as Spanish and the team answers in
  // Spanish. Recorded only when it is exactly "es"; never
  // required, never part of validation (the malformed-payload
  // 400 contract above is unchanged).
  if (clean(b.lang, 10).toLowerCase() === "es") rec.lang = "es";
  const missing = [];
  if (!rec.businessName) missing.push("business_name");
  if (!rec.contactName) missing.push("contact_name");
  if (!isEmail(rec.email)) missing.push("email");
  if (!rec.city) missing.push("city");
  if (missing.length) {
    return json(400, { error: "Missing or invalid fields: " + missing.join(", ") }, cors);
  }
  rec.id = crypto.randomUUID();
  await store.set(`bizapp:${rec.id}`, rec);
  // Team notification is best-effort and never gates the save.
  let emailSent = false;
  let emailReason = null;
  try {
    const result = await sendEmail({
      to: "hello@joinsignl.com",
      subject: `Founding business application: ${rec.businessName}`,
      text: [
        "A founding business application arrived through the site safety net (the primary form path failed for this visitor, so the site used the backup capture).",
        "",
        `Business name: ${rec.businessName}`,
        `Category: ${rec.category || "(not given)"}`,
        `Business type: ${rec.type || "(not given)"}`,
        `Contact name: ${rec.contactName}`,
        `Email: ${rec.email}`,
        `Phone: ${rec.phone || "(not given)"}`,
        `Business city & state: ${rec.city}`,
        `Tier interest: ${rec.tierInterest || "(not given)"}`,
        ...(rec.lang === "es" ? ["Preferred language: Spanish (application arrived via the Spanish page; answer in Spanish)"] : []),
        "",
        `Record: bizapp:${rec.id}`,
      ].join("\n"),
    });
    emailSent = !!(result && result.sent);
    emailReason = result && result.reason ? result.reason : null;
  } catch (e) {
    emailReason = String(e && e.message ? e.message : e);
    console.error("SIGNL founding application notification failed (application saved):", e);
  }
  if (!emailSent) {
    try {
      await store.set(`bizapp:${rec.id}`, Object.assign({}, rec, { notifyEmailSent: false, notifyEmailReason: emailReason }));
    } catch (e) { /* the application record itself is already saved */ }
  }
  try {
    await logEvent({ type: "founding_application_received", actorRole: "business", data: { bizappId: rec.id, businessName: rec.businessName, email: rec.email, source: rec.source, emailSent, lang: rec.lang || null } });
  } catch (e) { /* event log is best-effort; the record is saved */ }
  return json(200, { ok: true, id: rec.id }, cors);
}

// ---------- partners (Jeff, 2026-10-28) ----------
// A partner is a distribution partner (a media group or a large
// local profile) assigned one or more markets. They recruit
// creators and businesses through tracked links and earn a share
// of the subscription revenue in their markets (their own %,
// default 60, set in Admin). Attribution rides the existing
// signup-source mechanism: partner links carry ?src=partner-<code>,
// the client persists it exactly like every other source, and
// registration stamps it on the record as signupSource. The partner
// code on the user record (user.partner) is the partner's identity;
// the stamp on an attributed record is its signupSource. Records
// with no code are untouched. A partner sees ONLY records stamped
// with their own code, and never another partner's anything.
const PARTNER_SRC_PREFIX = "partner-";
const PARTNER_DEMO_CODE = "demo";
const PARTNER_DEMO_EMAIL = "jeff+partnerdemo@joinsignl.com";
// The locked model's average partner market at full fill (Jeff's
// investment model, 2026-10-28): about 330 businesses at the
// blended $2,958 a year. Used once, labeled modeled, for the
// at-fill line; it is a model figure, never a measured one.
const PARTNER_MODEL = { businessesPerMarket: 330, arpuYearly: 2958 };

function partnerSrcFor(code) {
  return PARTNER_SRC_PREFIX + code;
}

function partnerCodeOf(user) {
  return user && user.role === "partner" && user.partner ? user.partner.code : null;
}

function publicPartner(p) {
  if (!p) return null;
  return {
    name: p.name || "",
    type: p.type === "profile" ? "profile" : "media",
    contactName: p.contactName || "",
    code: p.code || "",
    markets: Array.isArray(p.markets) ? p.markets : [],
    sharePct: typeof p.sharePct === "number" ? p.sharePct : 60,
    status: p.status === "paused" ? "paused" : "active",
    agreementStatus: p.agreementStatus || "unsigned",
    demo: !!p.demo,
    sample: !!p.demo,
    createdAt: p.createdAt || null,
  };
}

async function allPartners(users) {
  const list = users || (await allUsers());
  return list.filter((u) => u.role === "partner" && u.partner);
}

async function findPartnerByCode(code, users) {
  const list = await allPartners(users);
  return list.find((u) => u.partner.code === code) || null;
}

function partnerLinksFor(partner, origin) {
  const base = origin || process.env.APP_URL || "https://app.joinsignl.com";
  const src = partnerSrcFor(partner.code);
  return (partner.markets || []).map((market) => ({
    market,
    creator: `${base}/?market=${encodeURIComponent(market)}&src=${encodeURIComponent(src)}`,
    business: `${base}/?market=${encodeURIComponent(market)}&src=${encodeURIComponent(src)}`,
  }));
}

// The partner's whole world, computed from records stamped with
// their code. Real partners never see tester records; the demo
// partner sees exactly its own Sample-tagged seed records (also
// tester-flagged, so they stay out of every real count in the app)
// and nothing else.
async function partnerSummary(user) {
  const partner = publicPartner(user.partner);
  const code = partner.code;
  const src = partnerSrcFor(code);
  const [users, bookingsAll, postsAll, offersAll] = await Promise.all([allUsers(), allBookings(), allPosts(), allOffers()]);
  const attributed = users.filter((u) => (u.role === "creator" || u.role === "business") && u.signupSource === src && u.id !== user.id && (partner.demo ? isTester(u) : !isTester(u)));
  const creators = attributed.filter((u) => u.role === "creator");
  const businesses = attributed.filter((u) => u.role === "business");
  const bizIds = new Set(businesses.map((u) => u.id));
  const bookings = bookingsAll.filter((b) => bizIds.has(b.businessId));
  const bookingIds = new Set(bookings.map((b) => b.id));
  const posts = postsAll.filter((p) => bookingIds.has(p.bookingId));
  const offers = offersAll.filter((o) => bizIds.has(o.businessId));

  const creatorStages = {
    claimed: creators.length,
    pending: creators.filter((u) => u.status === "pending").length,
    approved: creators.filter((u) => u.status === "approved").length,
    complete: creators.filter((u) => u.status === "approved" && profileCompleteOf(u)).length,
  };
  const businessStages = {
    applied: businesses.length,
    pending: businesses.filter((u) => u.status === "pending").length,
    approved: businesses.filter((u) => u.status === "approved").length,
    active: businesses.filter((u) => businessAccessState(u) === "active").length,
  };
  const byMarket = (partner.markets || []).map((market) => {
    const mc = creators.filter((u) => normalizeMarketName(u.market) === normalizeMarketName(market));
    const mb = businesses.filter((u) => normalizeMarketName(u.market) === normalizeMarketName(market));
    const mbIds = new Set(mb.map((u) => u.id));
    const mBookings = bookings.filter((b) => mbIds.has(b.businessId));
    const mBookingIds = new Set(mBookings.map((b) => b.id));
    return {
      market,
      creators: { claimed: mc.length, approved: mc.filter((u) => u.status === "approved").length, complete: mc.filter((u) => u.status === "approved" && profileCompleteOf(u)).length },
      businesses: { applied: mb.length, active: mb.filter((u) => businessAccessState(u) === "active").length },
      offersLive: offers.filter((o) => mbIds.has(o.businessId) && o.status === "open").length,
      visitsCompleted: mBookings.filter((b) => b.status === "completed").length,
      postsLive: posts.filter((p) => mBookingIds.has(p.bookingId)).length,
    };
  });

  // Performance: the same value math the business side sees
  // (roasFor), over the attributed bookings with their posts
  // attached, plus the day 7 / 14 / 30 view milestones read off
  // each post's own snapshot series. A milestone exists only when
  // a snapshot at or past that age exists; otherwise it stays null.
  const postByBooking = new Map(posts.map((p) => [p.bookingId, p]));
  const roas = roasFor(bookings.map((b) => ({ ...b, post: postByBooking.get(b.id) || null })));
  const milestones = { d7: null, d14: null, d30: null };
  for (const d of [7, 14, 30]) {
    let views = 0;
    let counted = 0;
    for (const p of posts) {
      const snaps = Array.isArray(p.snapshots) ? p.snapshots : [];
      const start = Date.parse(p.submittedAt || p.createdAt || "");
      if (!snaps.length || !Number.isFinite(start)) continue;
      const hit = snaps.find((s) => Date.parse(s.at) - start >= d * 86400000);
      if (hit && typeof hit.views === "number") { views += hit.views; counted += 1; }
    }
    milestones[`d${d}`] = counted ? { views, posts: counted } : null;
  }
  const performance = {
    offersTotal: offers.length,
    offersLive: offers.filter((o) => o.status === "open").length,
    visitsBooked: bookings.filter((b) => b.status === "booked").length,
    visitsRedeemed: bookings.filter((b) => !!b.redeemedAt).length,
    visitsCompleted: bookings.filter((b) => b.status === "completed").length,
    postsLive: posts.length,
    postsReported: posts.filter((p) => !!p.reportedAt).length,
    milestones,
    registerValue: roas.registerValue,
    estimatedRegisterValue: roas.estimatedRegisterValue,
    mediaValue: roas.mediaValue,
    redemptions: roas.redemptions,
  };

  // Earnings: subscription revenue from attributed businesses
  // whose subscription record is live. Amounts are ACCRUED from
  // the plan on file, never paid: no payout exists until a real
  // subscription payment exists, and the payload says so.
  let monthlyRevenue = 0;
  let payingBusinesses = 0;
  for (const b of businesses) {
    const sub = b.business && b.business.subscription;
    if (sub && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due")) {
      const price = typeof b.business.planPriceMonthly === "number" ? b.business.planPriceMonthly : 0;
      if (price > 0) { monthlyRevenue += price; payingBusinesses += 1; }
    }
  }
  const sharePct = partner.sharePct;
  const earnings = {
    sharePct,
    monthlyRevenue,
    payingBusinesses,
    accruedMonthly: Math.round(monthlyRevenue * (sharePct / 100) * 100) / 100,
    accruedTotal: Math.round(monthlyRevenue * (sharePct / 100) * 100) / 100,
    paidTotal: 0,
    hasPaidRevenue: monthlyRevenue > 0,
  };
  const atFill = {
    markets: (partner.markets || []).length,
    businessesPerMarket: PARTNER_MODEL.businessesPerMarket,
    grossYearly: PARTNER_MODEL.businessesPerMarket * PARTNER_MODEL.arpuYearly * (partner.markets || []).length,
  };
  atFill.partnerYearly = Math.round(atFill.grossYearly * (sharePct / 100));

  return {
    partner,
    links: partnerLinksFor(partner),
    creators: {
      stages: creatorStages,
      roster: creators.map((u) => ({
        handle: u.creator ? u.creator.handle || "" : "",
        name: u.name || "",
        tier: u.creator ? normalizeTierBand(u.creator.tierBand) : "",
        localAudiencePct: u.creator && typeof u.creator.localAudiencePct === "number" ? u.creator.localAudiencePct : null,
        spanishAudiencePct: u.creator && typeof u.creator.spanishAudiencePct === "number" ? u.creator.spanishAudiencePct : null,
        status: u.status || "",
        complete: u.status === "approved" && profileCompleteOf(u),
        market: normalizeMarketName(u.market),
        sample: !!isTester(u),
        createdAt: u.createdAt || null,
      })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    },
    businesses: {
      stages: businessStages,
      list: businesses.map((u) => ({
        businessName: u.business ? u.business.businessName || u.name : u.name,
        category: u.business ? u.business.category || "" : "",
        planName: u.business ? u.business.planName || "" : "",
        status: u.status || "",
        accessState: businessAccessState(u),
        market: normalizeMarketName(u.market),
        sample: !!isTester(u),
        createdAt: u.createdAt || null,
      })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    },
    markets: byMarket,
    performance,
    earnings,
    atFill,
    totals: {
      creatorsAttributed: creators.length,
      businessesAttributed: businesses.length,
      offersLive: performance.offersLive,
      visitsCompleted: performance.visitsCompleted,
      postsLive: performance.postsLive,
    },
  };
}

function validPartnerMarkets(names) {
  if (!Array.isArray(names)) return null;
  const out = [];
  for (const n of names) {
    const m = marketByName(String(n || ""));
    if (!m) return null;
    if (!out.includes(m.name)) out.push(m.name);
  }
  return out;
}

function partnerCodeFromName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "partner";
}

async function createPartnerUser({ name, type, contactName, email, markets, sharePct, actorId }) {
  const existing = await store.get(`email:${email}`);
  if (existing) return { error: "An account with this email already exists" };
  let code = partnerCodeFromName(name);
  const users = await allUsers();
  let n = 2;
  while (await findPartnerByCode(code, users)) { code = `${partnerCodeFromName(name)}-${n}`; n += 1; }
  // The login is created through the app's normal account shape
  // with a random password nobody knows; the partner sets their
  // own through the standard Forgot password flow, exactly like
  // any account recovery. No password is ever stored in plain
  // text or reported anywhere.
  const tempPassword = crypto.randomBytes(24).toString("hex");
  const { salt, hash } = auth.hashPassword(tempPassword);
  const ts = nowIso();
  const user = {
    id: crypto.randomUUID(),
    role: "partner",
    email,
    name: contactName || name,
    passwordSalt: salt,
    passwordHash: hash,
    status: "approved",
    tester: false,
    market: markets[0] || "",
    createdAt: ts,
    updatedAt: ts,
    reviewedAt: ts,
    reviewedBy: actorId || null,
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: ts,
    creator: null,
    business: null,
    partner: {
      name,
      type: type === "profile" ? "profile" : "media",
      contactName: contactName || "",
      code,
      markets,
      sharePct: typeof sharePct === "number" && sharePct > 0 && sharePct <= 100 ? sharePct : 60,
      status: "active",
      agreementStatus: "unsigned",
      demo: false,
      createdAt: ts,
    },
  };
  await store.set(`user:${user.id}`, user);
  await store.set(`email:${email}`, { userId: user.id });
  await logEvent({ type: "partner_created", actorId: actorId || null, actorRole: "admin", subjectId: user.id, data: { code, markets, sharePct: user.partner.sharePct, type: user.partner.type } });
  return { user };
}

// The demo partner (Jeff, 2026-10-28): ONE fictional partner Jeff
// can log into and show, seeded with Sample-tagged records across
// the lifecycle. Every seed user is tester-flagged, so the app's
// existing exclusions keep them out of rosters, founding counts,
// Admin stats, and every real partner's view; the demo partner's
// own summary is the one surface that reads its testers. Seeding
// is idempotent: an existing demo partner is returned untouched.
async function ensureDemoPartner(actorId) {
  const users = await allUsers();
  const existing = users.find((u) => u.role === "partner" && u.partner && u.partner.demo);
  if (existing) return { user: existing, created: false };
  const market = "Virginia Beach";
  const ts = nowIso();
  const tempPassword = crypto.randomBytes(24).toString("hex");
  const { salt, hash } = auth.hashPassword(tempPassword);
  const partnerUser = {
    id: crypto.randomUUID(),
    role: "partner",
    email: PARTNER_DEMO_EMAIL,
    name: "Demo Partner",
    passwordSalt: salt,
    passwordHash: hash,
    status: "approved",
    tester: false,
    market,
    createdAt: ts,
    updatedAt: ts,
    reviewedAt: ts,
    reviewedBy: actorId || null,
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: ts,
    creator: null,
    business: null,
    partner: {
      name: "Demo Media Group",
      type: "media",
      contactName: "Demo Partner",
      code: PARTNER_DEMO_CODE,
      markets: [market],
      sharePct: 60,
      status: "active",
      agreementStatus: "unsigned",
      demo: true,
      createdAt: ts,
    },
  };
  await store.set(`user:${partnerUser.id}`, partnerUser);
  await store.set(`email:${PARTNER_DEMO_EMAIL}`, { userId: partnerUser.id });

  const src = partnerSrcFor(PARTNER_DEMO_CODE);
  const mkUser = async (partial) => {
    const u = {
      id: crypto.randomUUID(),
      status: "approved",
      tester: true,
      market,
      city: "Virginia Beach",
      country: "United States",
      createdAt: ts,
      updatedAt: ts,
      reviewedAt: ts,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: ts,
      signupSource: src,
      passwordSalt: salt,
      passwordHash: hash,
      creator: null,
      business: null,
      ...partial,
    };
    await store.set(`user:${u.id}`, u);
    await store.set(`email:${u.email}`, { userId: u.id });
    return u;
  };
  const sampleCreators = [
    { handle: "samplebeachfoodie", name: "Sample Creator One", followers: 4200, local: 78, spanish: 12, status: "approved", complete: true },
    { handle: "samplevbcreates", name: "Sample Creator Two", followers: 1350, local: 85, spanish: null, status: "approved", complete: true },
    { handle: "samplesurfmom", name: "Sample Creator Three", followers: 22100, local: null, spanish: 31, status: "approved", complete: false },
    { handle: "samplecoastaleats", name: "Sample Creator Four", followers: 860, local: 91, spanish: null, status: "pending", complete: false },
  ];
  const creatorUsers = [];
  for (const c of sampleCreators) {
    creatorUsers.push(await mkUser({
      role: "creator",
      email: `${c.handle}@sample.signl.demo`,
      name: c.name,
      status: c.status,
      creator: {
        handle: c.handle,
        followerCount: c.followers,
        audienceStack: { instagram: c.followers },
        totalAudience: c.followers,
        tierBand: tierForFollowers(c.followers),
        categories: ["Food & Drink"],
        localAudiencePct: c.local,
        localAudienceSource: "Self-reported",
        spanishAudiencePct: c.spanish,
        profileComplete: c.complete,
        hasPhoto: false,
      },
    }));
  }
  const bizA = await mkUser({
    role: "business",
    email: "samplecafe@sample.signl.demo",
    name: "Sample Cafe Owner",
    business: { businessName: "Sample Cafe", category: "Coffee & Bakery", plan: "growth", planName: "Growth", planPriceMonthly: 349, accessState: "active", subscription: null },
  });
  const bizB = await mkUser({
    role: "business",
    email: "sampletacos@sample.signl.demo",
    name: "Sample Tacos Owner",
    business: { businessName: "Sample Tacos", category: "Restaurants", plan: "self-service", planName: "Self-Service", planPriceMonthly: 199, accessState: "founding", subscription: null },
  });
  const offer = {
    id: crypto.randomUUID(),
    businessId: bizA.id,
    market,
    title: "Sample visit: try the new seasonal menu",
    status: "open",
    spots: 3,
    createdAt: ts,
    updatedAt: ts,
    sample: true,
  };
  await store.set(`offer:${offer.id}`, offer);
  const dayMs = 86400000;
  const visitAt = new Date(Date.parse(ts) - 12 * dayMs).toISOString();
  const booking = {
    id: crypto.randomUUID(),
    businessId: bizA.id,
    creatorId: creatorUsers[0].id,
    offerId: offer.id,
    market,
    code: "SGNL-SAMPLE1",
    status: "completed",
    createdAt: visitAt,
    redeemedAt: visitAt,
    postDeadline: new Date(Date.parse(visitAt) + 2 * dayMs).toISOString(),
    dollarCap: 40,
    redemptions: { count: 6, basketTotal: 212.4, discountPct: 0 },
    sample: true,
  };
  await store.set(`booking:${booking.id}`, booking);
  const post = {
    id: crypto.randomUUID(),
    bookingId: booking.id,
    businessId: bizA.id,
    creatorId: creatorUsers[0].id,
    market,
    url: "https://www.instagram.com/p/sample/",
    submittedAt: visitAt,
    createdAt: visitAt,
    reportedAt: visitAt,
    views: 12400,
    likes: 860,
    comments: 74,
    shares: 39,
    snapshots: [
      { at: visitAt, views: 8200, likes: 540, comments: 41, shares: 22, source: "creator_report" },
      { at: new Date(Date.parse(visitAt) + 8 * dayMs).toISOString(), views: 12400, likes: 860, comments: 74, shares: 39, source: "creator_report" },
    ],
    sample: true,
  };
  await store.set(`post:${post.id}`, post);
  await logEvent({ type: "partner_demo_seeded", actorId: actorId || null, actorRole: "admin", subjectId: partnerUser.id, data: { code: PARTNER_DEMO_CODE, market } });
  return { user: partnerUser, created: true };
}

async function route(event) {
  const method = event.httpMethod || "GET";
  let path = event.path || "/";
  const qIndex = path.indexOf("?");
  if (qIndex > -1) path = path.slice(0, qIndex);
  const apiIdx = path.indexOf("/api");
  if (apiIdx > -1) path = path.slice(apiIdx + 4);
  const seg = path.split("/").filter(Boolean);
  const query = event.queryStringParameters || {};

  // Admin bootstrap is best-effort, exactly like every preamble job
  // below: it opportunistically creates the one admin account, but if
  // the store itself is failing it must degrade to "admin bootstrap
  // delayed" instead of taking down every route. Unguarded, this one
  // read caused the total /api/* outage of 2026-10-25 (expired Netlify
  // Blobs token) — see INCIDENT-2026-10-25.md.
  // Perf (2026-10-28): these eight preamble jobs are independent
  // (disjoint config keys, claim-flag discipline inside each), so
  // they now run CONCURRENTLY instead of as a sequential chain of
  // store round trips on every request. Each keeps its own
  // try/catch: every one of them is best-effort and must never
  // break a request (see the per-job notes below).
  await Promise.all([
    // Admin bootstrap: opportunistically creates the one admin
    // account, but if the store itself is failing it must degrade
    // to "admin bootstrap delayed" instead of taking down every
    // route. Unguarded, this one read caused the total /api/*
    // outage of 2026-10-25 (expired Netlify Blobs token) — see
    // INCIDENT-2026-10-25.md.
    (async () => {
      try {
        await auth.ensureAdmin(logEvent);
      } catch (e) {
        console.error("SIGNL ensureAdmin failed (continuing; admin bootstrap delayed):", e);
      }
    })(),
    // One-time recruiter kit email: fires on the first request
    // after deploy, guarded by a claimed blob flag, never repeats.
    (async () => { try { await maybeSendRecruiterKit(); } catch (e) { /* kit email is best-effort */ } })(),
    // One-time profileComplete backfill, claimed-flag guarded.
    (async () => { try { await maybeRunProfileBackfill(); } catch (e) { /* backfill is best-effort on the request path */ } })(),
    // One-time auto-decision cleanup, claimed-flag guarded.
    (async () => { try { await maybeRunAutoDecisionCleanup(); } catch (e) { /* cleanup is best-effort on the request path */ } })(),
    // Profile completion reminders: throttled opportunistic sweep.
    (async () => { try { await maybeRunProfileReminderSweep(); } catch (e) { /* reminder sweep is best-effort on the request path */ } })(),
    // Post-compliance sweep: 48h reminders, day-8 pause, day-9 ban.
    // Throttled to roughly hourly here (the Netlify scheduled
    // function and the admin endpoint are the explicit triggers).
    (async () => { try { await maybeRunComplianceSweep(); } catch (e) { /* sweep is best-effort on the request path */ } })(),
    // Offer lifecycle sweep: selection SLA releases, backfill
    // advancement, offer expiry, the 48 hour coaching nudge.
    (async () => { try { await maybeRunOfferSweep(); } catch (e) { /* sweep is best-effort on the request path */ } })(),
    // Campaign sweep (Jeff fix, 2026-10-19): the scheduled function
    // alone never fired in production, so a throttled pass runs on
    // ordinary API traffic, exactly like compliance above.
    (async () => { try { await maybeRunCampaignSweep(); } catch (e) { /* sweep is best-effort on the request path */ } })(),
  ]);
  const ctx = await getAuthUser(event);
  const user = ctx.user;

  // Public bootstrap: static config plus the launch state. Deliberately
  // contains NO creator or business data; the roster is never public.
  if (method === "GET" && seg.length === 1 && seg[0] === "bootstrap") {
    return json(200, {
      markets: MARKETS,
      tiers: TIERS,
      creatorCategories: CREATOR_CATEGORIES,
      professions: PROFESSIONS,
      compCategories: COMP_CATEGORIES,
      businessCategories: BUSINESS_CATEGORIES,
      universities: UNIVERSITY_OPTIONS,
      plans: PLANS,
      paidCampaignsComp: PAID_COMP,
      unlistedMarket: UNLISTED,
      standardVisit: STANDARD_VISIT,
      roasModel: { ...ROAS_MODEL, label: ROAS_LABEL },
      audiencePlatforms: AUDIENCE_PLATFORMS,
      moments: MOMENTS,
      termsVersion: TERMS_VERSION,
      email: { enabled: emailEnabled() },
      // Stripe Connect paid-lane rail (2026-10-26): true only
      // when the server carries Stripe keys. The client renders
      // payout setup + card-on-file surfaces from this flag;
      // false keeps every money surface exactly as it was.
      payments: { connectLive: connect.connectConfigured() },
      // Connect Accounts (2026-10-28): which audience platforms a
      // creator can actually connect today. YouTube is live when
      // the Google OAuth env is set; Meta stays "in_review" until
      // its Access Verification clears. The client renders the
      // Connect surface from these flags, never from a guess.
      platformConnect: {
        youtube: { oauthConfigured: platformConnect.youtubeConfigured() },
        meta: { state: "in_review" },
      },
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
    // Perf (2026-10-28): bootstrap is static config plus launch
    // flags that change rarely; let browsers reuse it for a minute
    // (with stale-while-revalidate) instead of paying a function
    // round trip on every single app load.
    }, { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" });
  }

  // Founding business application safety net: public, cross-origin
  // from joinsignl.com (see handleFoundingApplication above).
  if (seg[0] === "founding-application" && seg.length === 1) {
    if (method === "OPTIONS") {
      return { statusCode: 204, headers: foundingApplicationCors(event), body: "" };
    }
    if (method === "POST") return handleFoundingApplication(event);
  }

  // Instagram handle onboarding (Phase 2, Jeff, 2026-10-28;
  // spec: signl-handle-onboarding-spec-2026-10-28.md). POST
  // /api/ig-prefill turns a public handle into a DRAFT the user
  // confirms field by field, or answers the deterministic
  // one-play suggestion from confirmed signals. This endpoint
  // NEVER writes to the store: a draft lives only in the
  // caller's session until the user confirms and the save goes
  // through the existing profile endpoints. Public profile data
  // only; per-IP rate limited like sign-in (the upstream fetch
  // carries its own cache and cooldown in ig-prefill.js).
  if (method === "POST" && seg[0] === "ig-prefill" && seg.length === 1) {
    const ip = (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown").toString();
    const nowMs = Date.now();
    const hits = (igPrefillHits.get(ip) || []).filter((t) => nowMs - t < 10 * 60 * 1000);
    if (hits.length >= 20) return err(429, "Too many lookups in a row. Wait a few minutes and try again.");
    hits.push(nowMs);
    igPrefillHits.set(ip, hits);
    const b = parseBody(event);
    if (b.suggest && typeof b.suggest === "object") {
      return json(200, { suggestion: igPrefill.suggestPlayForBusiness(b.suggest) });
    }
    const side = b.side === "business" ? "business" : "creator";
    const res = await igPrefill.fetchIgProfile(typeof b.handle === "string" ? b.handle : "");
    if (!res.ok) return json(200, { draft: null, reason: res.reason });
    const draft = side === "business" ? igPrefill.businessPrefill(res.profile) : igPrefill.creatorPrefill(res.profile);
    return json(200, { draft, cached: !!res.cached });
  }

  // Server-rendered profile page (netlify.toml /c/* rewrite).
  // Netlify hands this function the ORIGINAL request path for a
  // rewrite, so a page request arrives as seg ["c", <handle>]
  // with no "/api" in the raw path, while a genuine API call
  // arrives as "/api/c/<handle>" (apiIdx > -1 after the strip
  // above) and falls through to the JSON route below. (The "cpage" seg
  // shape is also accepted for direct invocations.) Approved +
  // profile-complete creators get the shell with their
  // title/meta/OG tags and index,follow baked in
  // (profile-meta.js); every other case, including deeper paths
  // like the proof sheet (/c/<handle>/proof), returns the
  // unmodified shell and the SPA renders exactly as before.
  if (method === "GET" && (seg[0] === "cpage" || (seg[0] === "c" && apiIdx === -1))) {
    const shell = await loadAppShell(event);
    if (seg.length !== 2) return htmlPage(shell);
    const target = await findPublicProfileUser(sanitizePublicHandle(seg[1]));
    if (!target) return htmlPage(shell);
    const p = await publicProfilePayload(target);
    const host = (event.headers && (event.headers["x-forwarded-host"] || event.headers.host)) || "app.joinsignl.com";
    const place = p.unlisted ? p.city : p.market;
    return htmlPage(buildProfilePageHtml(shell, {
      name: p.name,
      handle: p.handle,
      place,
      tierBand: p.tierBand,
      localAudiencePct: p.localAudiencePct,
      photoUrl: p.photoUrl,
      origin: `https://${host}`,
    }));
  }

  // Book-me page: GET /api/c/<handle>. Opted-in, approved,
  // profile-complete creators only (findPublicProfileUser), and
  // the payload is tiered by viewer (see bookMePayload): the
  // public sees a showcase, businesses see the rate, and paid,
  // active businesses additionally see socials and can message.
  if (method === "GET" && seg[0] === "c" && seg.length === 2) {
    const target = await findPublicProfileUser(sanitizePublicHandle(seg[1]));
    if (!target) return err(404, "Creator not found");
    return json(200, { profile: await bookMePayload(target, user) });
  }

  // Message a creator from their book-me page (Amendment 2,
  // Jeff, 2026-10-29): a paid, active business starts an
  // in-platform thread with the creator right from the page.
  // The first message in a brand-new thread is preceded by the
  // non-circumvention system line, stored as a system record
  // the conversation view renders as a divider. This route sits
  // before the sign-in wall and the marketplace gates on
  // purpose: it enforces its own stricter rule (paid + active),
  // which by definition only exists once a market is live.
  if (method === "POST" && seg[0] === "c" && seg.length === 3 && seg[2] === "message") {
    if (!user) return err(401, "Sign in required");
    if (user.role !== "business") return err(403, "Businesses only");
    if (!businessPaidActive(user)) return err(403, "Messaging a creator from their page opens with a paid, active SIGNL account.");
    const target = await findPublicProfileUser(sanitizePublicHandle(seg[1]));
    if (!target) return err(404, "Creator not found");
    if (target.id === user.id) return err(400, "You cannot message yourself");
    const b = parseBody(event);
    const body = String(b.body || "").trim();
    if (!body) return err(400, "Message cannot be empty");
    if (body.length > 2000) return err(400, "That message is too long. Keep it under 2000 characters.");
    const threadId = [user.id, target.id].sort().join("__");
    const rows = await store.list("message:");
    const hasPrior = rows.some((r) => r.value && r.value.threadId === threadId);
    const ts = nowIso();
    if (!hasPrior) {
      // One second before the first real message, so the line
      // always renders at the top of the conversation.
      const sys = { id: crypto.randomUUID(), threadId, fromId: "system", toId: target.id, body: THREAD_STARTED_LINE, system: true, createdAt: new Date(Date.parse(ts) - 1000).toISOString() };
      await store.set(`message:${sys.id}`, sys);
    }
    const msg = { id: crypto.randomUUID(), threadId, fromId: user.id, toId: target.id, body, createdAt: ts };
    await store.set(`message:${msg.id}`, msg);
    const priorNotes = await store.list(`note:${target.id}:`);
    const alreadySignaled = priorNotes.some((r) => r.value && r.value.kind === "message_received" && !r.value.readAt && r.value.data && r.value.data.threadId === threadId);
    if (!alreadySignaled) {
      await notifyUser(target.id, "message_received", `${user.name} sent you a message.`, { threadId, messageId: msg.id, fromId: user.id });
    }
    await logEvent({ type: "message_sent", actorId: user.id, actorRole: user.role, subjectId: msg.id, market: user.market, data: { toId: target.id, toRole: "creator", threadId, bodyLength: body.length, via: "bookme_page" } });
    return json(201, { message: msg, threadId });
  }

  // The Local List (Build -31, Jeff, 2026-10-29): the public,
  // cross-origin feed behind joinsignl.com/local-list pages.
  // Opted-in book-me creators only, grouped by category, and the
  // payload carries NO counts: no totals, no per-category
  // numbers, nothing a page could print as a roster size.
  if (seg[0] === "public" && seg[1] === "local-list" && seg.length === 2) {
    const cors = Object.assign(foundingApplicationCors(event), { "Access-Control-Allow-Methods": "GET, OPTIONS" });
    if (method === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (method === "GET") {
      const marketName = normalizeMarketName(query.market || "");
      const users = await allUsers();
      const opted = users
        .filter((u) => isRosterCreator(u) && profileCompleteOf(u) && standingState(u) !== "banned" && u.creator && u.creator.publicPage === true && normalizeMarketName(u.market) === marketName)
        .sort((a, b) => ((b.creator.localAudiencePct || 0) - (a.creator.localAudiencePct || 0)) || (a.createdAt < b.createdAt ? -1 : 1));
      const byCategory = new Map();
      for (const u of opted) {
        const entry = {
          handle: u.creator.handle,
          localAudiencePct: u.creator.localAudiencePct === undefined ? null : u.creator.localAudiencePct,
          categories: u.creator.categories || [],
          charter: u.creator.charter === true,
          neighborhood: u.creator.neighborhood || "",
          streets: Array.isArray(u.creator.streets) ? u.creator.streets : [],
        };
        for (const raw of entry.categories) {
          const canon = canonicalFromList(raw, CREATOR_CATEGORIES) || raw;
          if (!byCategory.has(canon)) byCategory.set(canon, []);
          byCategory.get(canon).push(entry);
        }
      }
      return json(200, {
        market: marketName,
        allCategories: CREATOR_CATEGORIES,
        categories: CREATOR_CATEGORIES.filter((name) => byCategory.has(name)).map((name) => ({ name, creators: byCategory.get(name) })),
      }, cors);
    }
  }

  // Creator photo serving (Jeff, 2026-10-19). An APPROVED creator's
  // photo is part of their public profile - the /c/<handle> page shows
  // it - so it is served without sign-in for approved creators. Before
  // approval (or after rejection) the photo stays locked down: the
  // owner, the admin, or an approved business whose market is live.
  // This route deliberately sits BEFORE the sign-in wall below.
  // Gallery (Jeff, 2026-10-25): /photo serves the COVER (index 0,
  // the original record key, so every existing surface keeps
  // working); /photo/<n> serves gallery slot n under the same gate.
  if (method === "GET" && seg[0] === "users" && (seg.length === 3 || seg.length === 4) && seg[2] === "photo") {
    const target = await store.get(`user:${seg[1]}`);
    if (!target || target.role !== "creator") return err(404, "Photo not found");
    const photoIdx = seg.length === 4 ? parseInt(seg[3], 10) : 0;
    if (!Number.isInteger(photoIdx) || photoIdx < 0 || photoIdx >= photoCountOf(target.creator)) return err(404, "Photo not found");
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
    const photo = await store.get(photoKey(target.id, photoIdx));
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
  if (method === "POST" && seg[0] === "auth" && seg[1] === "forgot") return handleForgot(event);
  if (method === "POST" && seg[0] === "auth" && seg[1] === "reset") return handleReset(event);
  if (method === "POST" && seg[0] === "auth" && seg[1] === "change-password") return handleChangePassword(event, ctx);
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

  // Metrics sync trigger (UX redesign section 3, 2026-10-24). Same
  // auth and placement discipline as the campaign sweep above and
  // the compliance sweep route: the Netlify scheduled function
  // (netlify/functions/metrics-sync.mjs) POSTs here daily with no
  // session, carrying the x-signl-sweep-token header when
  // SIGNL_SWEEP_TOKEN is set; without a matching token, only an
  // admin session may trigger it. It drives the feature-flagged
  // auto-sync seam in lib/metrics-sync.js: with the flag off (the
  // shipped state) the call only reports the summary as JSON.
  if (method === "POST" && seg[0] === "admin" && seg[1] === "metrics" && seg[2] === "sync") {
    const token = process.env.SIGNL_SWEEP_TOKEN;
    const tokenOk = !!token && (event.headers["x-signl-sweep-token"] || event.headers["X-Signl-Sweep-Token"]) === token;
    if (!tokenOk && (!user || user.role !== "admin")) return err(403, "Admin only");
    const summary = await runMetricsSync({ syncAudience: syncAllConnectedAudiences });
    return json(200, summary);
  }

  // Stripe webhook (Jeff, 2026-10-23). Deliberately BEFORE the
  // sign-in wall: Stripe's servers carry no session, authenticity
  // is the HMAC signature over the raw body, verified inside
  // handleStripeWebhook. When STRIPE_WEBHOOK_SECRET is unset the
  // endpoint answers 503 and nothing is recorded.
  if (method === "POST" && seg[0] === "stripe" && seg[1] === "webhook") {
    return handleStripeWebhook(event);
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
    if (!(await isMarketLive(biz.market))) return err(403, `The ${marketTalkName(biz.market)} market has not launched yet, so there are no creator visits to redeem.`);
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

  // Staff code-use logging (UX redesign section 4, 2026-10-24): at
  // the register, staff enter the creator's AUDIENCE code (not the
  // visit code) and one use is logged against that booking. The
  // booking resolves through the ccode: index the code was issued
  // under, and only for the staff session's own business: a code
  // belonging to another business reads as not found, exactly like
  // an unknown code, so nothing about other businesses leaks. The
  // staff lookup attempt limiter guards this the same way it
  // guards lookup and redeem.
  if (method === "POST" && seg[0] === "staff" && seg[1] === "code-use") {
    if (!staffCtx) return err(401, "Your staff session has ended. Enter the staff PIN to keep going.");
    const biz = staffCtx.business;
    if (businessAccessState(biz) !== "active" || !(await isMarketLive(biz.market))) {
      return err(403, "Staff mode is not open for this business right now.");
    }
    if (!staffLookupAllowed(staffCtx.token)) return err(429, "Too many code entries in a row. Wait a few minutes and try again.");
    const b = parseBody(event);
    const creatorCode = String(b.creatorCode || "").trim().toUpperCase();
    if (!creatorCode) return err(400, "Enter the creator's code");
    const idx = await store.get(`ccode:${creatorCode}`);
    if (!idx || !idx.bookingId) return err(404, "That code does not match any creator code for this business. Check the code and try again.");
    const booking = await store.get(`booking:${idx.bookingId}`);
    if (!booking || booking.businessId !== biz.id) return err(404, "That code does not match any creator code for this business. Check the code and try again.");
    if (booking.status === "cancelled") return err(400, "That visit is cancelled, so its code is not in use");
    await logCodeUse(booking, 1, staffCtx.businessId, "staff", "staff");
    return json(200, { creatorName: booking.creatorName, creatorHandle: booking.creatorHandle || "", codeUseCount: booking.codeUseCount });
  }

  if (!user) return err(401, "Sign in required");

  // ---------- Ask Sig (real AI, Jeff 2026-10-27) ----------
  // POST /api/sig/ask { q, history } -> { source: "ai", text } or
  // { source: "unavailable" } when no AI provider is configured or
  // the provider fails; the client then answers from its canon
  // bank. AI trouble must never surface as an API error here.
  if (method === "POST" && seg[0] === "sig" && seg[1] === "ask") {
    const b = parseBody(event);
    const q = String(b.q || "").trim();
    if (!q) return err(400, "Ask a question first");
    const full = await withFounding(user);
    const lines = [];
    if (user.role === "creator") {
      const f = full.founding || {};
      if (user.lang === "es") lines.push("This person prefers Spanish. Answer in Spanish.");
      lines.push(`Their market is ${f.market || user.market || "unknown"} and it is ${f.marketLive ? "OPEN (live)" : "NOT open yet (founding)"}. Their application status is ${user.status || "unknown"}.`);
      const pc = full.profileCompletion || {};
      lines.push(pc.complete ? "Their profile is finished, so businesses can see them." : `Their profile is NOT finished yet; still missing: ${(pc.missing || []).join(", ") || "nothing recorded"}. A finished profile is the gate for being seen by businesses.`);
      if (full.momentum) lines.push(`Their Momentum is ${full.momentum.points} points.`);
      if (user.creator && user.creator.tierBand) lines.push(`Their tier is ${user.creator.tierBand}.`);
      if (user.creator && user.creator.paidRate) lines.push(`Their listed paid rate is $${user.creator.paidRate}.`);
    } else if (user.role === "business") {
      const live = businessAccessState(user) === "active";
      lines.push(`Their market is ${user.market || "unknown"} and their business is ${live ? "ACTIVE (market open)" : "on the founding list (market not open yet)"}.`);
      if (user.business && user.business.planId) lines.push(`Their plan is ${user.business.planId}.`);
      if (user.business && user.business.preferredLanguage === "es") lines.push("This business owner prefers Spanish. Answer in Spanish.");
    } else if (user.role === "admin") {
      // Sig in Admin (Jeff, 2026-10-28): ground the console chat
      // in the same records the Admin endpoints serve, counted
      // the same way (/admin/applications, /admin/markets,
      // /admin/partners). Read-only: the admin Sig surface gives
      // answers and points at tabs; it takes no actions.
      try {
        const all = await allUsers();
        const flags = await getMarketFlags();
        const today = new Date().toISOString().slice(0, 10);
        const pendC = all.filter((u) => u.role === "creator" && u.status === "pending").length;
        const pendB = all.filter((u) => u.role === "business" && u.status === "pending").length;
        const apprC = all.filter((u) => u.role === "creator" && u.status === "approved" && !isTester(u)).length;
        const apprB = all.filter((u) => u.role === "business" && u.status === "approved").length;
        const foundingWaiting = all.filter((u) => u.role === "business" && u.status === "approved" && businessAccessState(u) !== "active").length;
        const claimsToday = all.filter((u) => u.role === "creator" && String(u.createdAt || "").startsWith(today)).length;
        const liveMarkets = Object.values(flags).filter(Boolean).length;
        const partners = await allPartners(all);
        const paused = partners.filter((p) => p.partner.status === "paused").length;
        const demoSeeded = partners.some((p) => p.partner.code === "demo");
        lines.push(`Live console counts right now: ${pendC} creator applications pending, ${pendB} business applications pending, ${apprC} approved creators, ${apprB} approved businesses, ${foundingWaiting} approved founding businesses not yet activated, ${claimsToday} creator claims today, ${liveMarkets} live markets, ${partners.length} partners (${paused} paused${demoSeeded ? ", demo partner seeded" : ", no demo partner seeded yet"}).`);
        lines.push("This admin surface is read-only for you: answer and explain, and point to the Admin tab where an action lives. Never claim you approved, sent, activated, or changed anything.");
      } catch (e) { /* counts are grounding, never a blocker */ }
    }
    const history = Array.isArray(b.history) ? b.history.filter((t) => t && (t.who === "user" || t.who === "sig") && typeof t.text === "string").map((t) => ({ who: t.who, text: t.text })) : [];
    const ans = await askSigAI({ role: user.role, stateLines: lines.join(" "), question: q, history });
    if (ans.source === "ai") return json(200, { source: "ai", text: ans.text });
    return json(200, { source: "unavailable" });
  }

  // ---------- Stripe subscription checkout (Jeff, 2026-10-23) ----------
  // An ACTIVATED business (or an admin acting for one) starts a
  // subscription Checkout Session for one of the three founding
  // plans. Founding-list businesses are refused: billing never
  // bypasses the founding gate or market activation. Without
  // STRIPE_SECRET_KEY the endpoint no-ops with a 503 and payment
  // stays concierge, exactly as before.
  if (method === "POST" && seg[0] === "billing" && seg[1] === "checkout") {
    if (!stripe.billingConfigured()) return err(503, "Billing is not configured yet. Payment stays concierge for now: Jeff sends the payment step by hand at activation.");
    const b = parseBody(event);
    let biz = null;
    if (user.role === "business") biz = user;
    else if (user.role === "admin" && b.businessId) {
      const target = await store.get(`user:${b.businessId}`);
      if (target && target.role === "business") biz = target;
    }
    if (!biz) return err(403, "Only a business can start a subscription checkout.");
    if (businessAccessState(biz) !== "active") return err(403, FOUNDING_BUSINESS_MESSAGE);
    let priceId = typeof b.priceId === "string" ? b.priceId : null;
    if (!priceId && typeof b.planId === "string") priceId = stripePriceForPlan(b.planId);
    const plan = priceId ? stripePlanForPrice(priceId) : null;
    if (!priceId || !plan) return err(400, "Choose one of the three SIGNL plans.");
    const appUrl = (process.env.APP_URL || "https://app.joinsignl.com").replace(/\/+$/, "");
    const existingCustomer = biz.business && biz.business.subscription && biz.business.subscription.customerId;
    let session = null;
    try {
      session = await stripe.stripeApi("POST", "/v1/checkout/sessions", {
        mode: "subscription",
        success_url: `${appUrl}/?billing=success`,
        cancel_url: `${appUrl}/?billing=canceled`,
        client_reference_id: biz.id,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { businessId: biz.id, priceId, planId: plan.id },
        subscription_data: { metadata: { businessId: biz.id, priceId, planId: plan.id } },
        ...(existingCustomer ? { customer: existingCustomer } : { customer_email: biz.email }),
      });
    } catch (e) {
      console.error("SIGNL Stripe checkout error:", e);
      return err(502, "Stripe could not start checkout. Please try again.");
    }
    await logEvent({ type: "billing_checkout_started", actorId: user.id, actorRole: user.role, subjectId: biz.id, market: biz.market || null, data: { planId: plan.id, priceId, sessionId: session.id || null } });
    return json(200, { url: session.url, sessionId: session.id || null });
  }

  // ---------- Stripe Connect: creator payouts (2026-10-26) ----------
  // Payout setup lives ONLY in the paid lane: a creator never
  // needs it to join, claim, or take a comped visit. Starting it
  // creates (or reuses) their Express account and returns a fresh
  // Stripe-hosted onboarding link; the return/refresh URLs land
  // back in the app, which re-reads the state. Without Stripe
  // keys this no-ops with a 503 and the paid lane stays recorded
  // and concierge-settled, exactly as before.
  if (method === "POST" && seg[0] === "me" && seg[1] === "payouts" && seg[2] === "start") {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    if (!connect.connectConfigured()) return err(503, "Payouts are not live yet. Paid bookings are recorded in the app and settled by hand until the payout rail opens.");
    const record = (await store.get(`user:${user.id}`)) || user;
    record.creator = record.creator || {};
    try {
      let payouts = storedPayouts(record);
      if (!payouts.accountId) {
        const account = await connect.createConnectedAccount(record);
        payouts = { accountId: account.id, ...connect.payoutStateFromAccount(account), updatedAt: nowIso() };
        record.creator.payouts = payouts;
        record.updatedAt = nowIso();
        await store.set(`user:${record.id}`, record);
        await logEvent({ type: "payout_account_created", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market || null, data: {} });
      } else {
        payouts = await refreshCreatorPayouts(record);
      }
      const appUrl = (process.env.APP_URL || "https://app.joinsignl.com").replace(/\/+$/, "");
      const url = await connect.createAccountLink(payouts.accountId, `${appUrl}/?payouts=refresh`, `${appUrl}/?payouts=return`);
      if (!url) throw new Error("Stripe did not return an onboarding link");
      await logEvent({ type: "payout_setup_started", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market || null, data: { status: payouts.status } });
      return json(200, { url, payouts: payoutsClientView(record) });
    } catch (e) {
      console.error("SIGNL payout setup error:", e);
      return err(502, "Stripe could not open payout setup. Please try again.");
    }
  }

  if (method === "GET" && seg[0] === "me" && seg[1] === "payouts" && seg.length === 2) {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    const record = (await store.get(`user:${user.id}`)) || user;
    const payouts = await refreshCreatorPayouts(record);
    return json(200, { payouts: { status: payouts.status, ready: payouts.ready, missing: payouts.missing, updatedAt: payouts.updatedAt }, paymentsLive: connect.connectConfigured() });
  }

  // ---------- Connect Accounts (Jeff, 2026-10-28) ----------
  // A creator connects a platform once; that platform's audience
  // count then syncs from the provider and shows as Synced instead
  // of Self-reported. Tokens live only in platconn: records (see
  // lib/platform-connect.js); nothing below ever returns one. The
  // OAuth start/callback are full-page navigations (the browser
  // leaves for Google and comes back), so they answer with 302s to
  // the app, carrying only a plain status word in the query.

  if (method === "GET" && seg[0] === "me" && seg[1] === "platforms" && seg.length === 2) {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    return json(200, { platforms: await platformConnect.publicStates(user.id), youtubeConfigured: platformConnect.youtubeConfigured() });
  }

  if (method === "GET" && seg[0] === "me" && seg[1] === "platforms" && seg[2] === "youtube" && seg[3] === "start" && seg.length === 4) {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    const base = platformConnect.appBaseUrl();
    if (!platformConnect.youtubeConfigured()) {
      return { statusCode: 302, headers: { Location: `${base}/?yt=unavailable` }, body: "" };
    }
    const state = await platformConnect.createOAuthState(user.id, "youtube");
    return { statusCode: 302, headers: { Location: platformConnect.buildYouTubeAuthUrl(state) }, body: "" };
  }

  if (method === "GET" && seg[0] === "me" && seg[1] === "platforms" && seg[2] === "youtube" && seg[3] === "callback" && seg.length === 4) {
    const base = platformConnect.appBaseUrl();
    if (!user || user.role !== "creator" || !user.creator) {
      return { statusCode: 302, headers: { Location: `${base}/?yt=error` }, body: "" };
    }
    const stateRec = query.state ? await platformConnect.consumeOAuthState(query.state) : null;
    if (!query.code || !stateRec || stateRec.userId !== user.id || stateRec.platform !== "youtube") {
      return { statusCode: 302, headers: { Location: `${base}/?yt=error` }, body: "" };
    }
    try {
      const tokens = await platformConnect.exchangeYouTubeCode(query.code);
      const channel = await platformConnect.fetchYouTubeChannel(tokens.access_token);
      if (!channel) return { statusCode: 302, headers: { Location: `${base}/?yt=error` }, body: "" };
      const conn = await platformConnect.saveYouTubeConnection(user.id, tokens, channel);
      const synced = await syncYouTubeForConnection(conn);
      await logEvent({ type: "platform_connected", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market || null, data: { platform: "youtube", accountLabel: channel.title || null, syncStatus: synced.status } });
      return { statusCode: 302, headers: { Location: `${base}/?yt=connected` }, body: "" };
    } catch (e) {
      console.error("SIGNL YouTube connect error:", e);
      return { statusCode: 302, headers: { Location: `${base}/?yt=error` }, body: "" };
    }
  }

  if (method === "POST" && seg[0] === "me" && seg[1] === "platforms" && seg[2] === "youtube" && seg[3] === "sync" && seg.length === 4) {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    const conn = await platformConnect.getConnection(user.id, "youtube");
    if (!conn) return err(404, "YouTube is not connected");
    const r = await syncYouTubeForConnection(conn);
    const record = (await store.get(`user:${user.id}`)) || user;
    return json(200, { ok: r.ok, status: r.status, user: await withFounding(record), platforms: await platformConnect.publicStates(user.id) });
  }

  if (method === "POST" && seg[0] === "me" && seg[1] === "platforms" && seg[2] === "youtube" && seg[3] === "disconnect" && seg.length === 4) {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    await platformConnect.deleteConnection(user.id, "youtube");
    const record = await clearPlatformSyncMirror(user.id, "youtube");
    await logEvent({ type: "platform_disconnected", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market || null, data: { platform: "youtube" } });
    return json(200, { ok: true, user: await withFounding(record || user), platforms: await platformConnect.publicStates(user.id) });
  }

  // ---------- Stripe Connect: business card on file (2026-10-26) ----------
  // A business never creates a Stripe account: it saves a card
  // once (Checkout in setup mode) and paid bookings confirm
  // against it in one tap. The saved method lands on the record
  // through the webhook; this endpoint only opens the session.
  // Same founding gate as subscription checkout: billing never
  // activates a business by the back door.
  if (method === "POST" && seg[0] === "billing" && seg[1] === "card") {
    if (!connect.connectConfigured()) return err(503, "Billing is not configured yet. Payment stays concierge for now: Jeff sends the payment step by hand at activation.");
    const b = parseBody(event);
    let biz = null;
    if (user.role === "business") biz = user;
    else if (user.role === "admin" && b.businessId) {
      const target = await store.get(`user:${b.businessId}`);
      if (target && target.role === "business") biz = target;
    }
    if (!biz) return err(403, "Only a business can add a card.");
    if (businessAccessState(biz) !== "active") return err(403, FOUNDING_BUSINESS_MESSAGE);
    const record = (await store.get(`user:${biz.id}`)) || biz;
    record.business = record.business || {};
    record.business.billing = record.business.billing || {};
    try {
      if (!record.business.billing.customerId) {
        const customer = await connect.createCustomer(record);
        record.business.billing.customerId = customer.id;
        record.updatedAt = nowIso();
        await store.set(`user:${record.id}`, record);
      }
      const appUrl = (process.env.APP_URL || "https://app.joinsignl.com").replace(/\/+$/, "");
      const session = await connect.createCardSetupSession(record, {
        customerId: record.business.billing.customerId,
        successUrl: `${appUrl}/?card=saved`,
        cancelUrl: `${appUrl}/?card=canceled`,
      });
      await logEvent({ type: "billing_card_setup_started", actorId: user.id, actorRole: user.role, subjectId: biz.id, market: biz.market || null, data: { sessionId: session.id || null } });
      return json(200, { url: session.url, sessionId: session.id || null });
    } catch (e) {
      console.error("SIGNL card setup error:", e);
      return err(502, "Stripe could not open card setup. Please try again.");
    }
  }

  // ---------- self-serve market fix (pending creators) ----------
  // Audit F2 (2026-10-22): the claim's market select defaults to
  // Hampton Roads when a claim link carried no market, and the
  // market was never editable afterward, so a wrong-market claim
  // was a permanent dead end short of a support intervention no
  // screen mentioned. While an application is still PENDING the
  // creator can move it here, under exactly registration's rules:
  // a canonical market plus a home city inside it, or the
  // not-listed typed-city path. Once a decision lands the market
  // is set: this route refuses, and the profile points approved
  // creators at hello@joinsignl.com instead. The change is stamped
  // on the record (marketChangedAt) and logged as an event; queue
  // position and founding standing derive from the record, so
  // they follow the new market on their own.
  if (method === "POST" && seg[0] === "me" && seg[1] === "market") {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    if (user.status !== "pending") return err(403, "Your application has already been decided, so your market is set. Email hello@joinsignl.com and we will help you move it.");
    const b = parseBody(event);
    const fromMarket = user.market;
    const fromCity = user.city || "";
    const unlisted = b.market === UNLISTED;
    const market = unlisted ? { name: UNLISTED, cities: [] } : marketByName(b.market || "");
    if (!market) return err(400, "Choose one of the SIGNL markets");
    if (unlisted) {
      const customCity = String(b.customCity || "").trim().slice(0, 60);
      const customCountry = String(b.customCountry || "").trim().slice(0, 60);
      let customState = String(b.customState || "").trim().slice(0, 60);
      if (!customCity) return err(400, "Tell us your city, so your sign-up counts toward opening SIGNL there");
      if (!customCountry) return err(400, "Tell us your country, so your sign-up counts toward opening SIGNL there");
      if (customState.length === 2) customState = customState.toUpperCase();
      user.market = UNLISTED;
      user.city = customCity;
      user.country = customCountry;
      user.state = customState || null;
      // Typed-city resolution (Jeff, 2026-10-23): the new typed
      // city may already belong to a market; file it there, or
      // store the tie's candidates for a one-tap pick.
      applyTypedCityResolution(user, customCity);
    } else if (user.market === UNLISTED && Array.isArray(user.marketCandidates) && user.marketCandidates.includes(market.name)) {
      // Candidate pick (Jeff, 2026-10-23): the typed city tied
      // between markets at intake and the creator now picks theirs
      // with one tap. The filing keeps the typed city as the home
      // city (the same shape a unique intake resolution stores);
      // the picked metro's own list spelling of the town is
      // stamped as the resolved city.
      const res = resolveTypedCity(user.city || "", { state: user.state, country: user.country });
      const match = (res.matches || []).find((mm) => mm.market === market.name);
      user.market = market.name;
      user.marketResolvedFrom = "typed_city";
      user.marketResolvedCity = match ? match.city : user.city;
      delete user.marketCandidates;
    } else {
      let city = String(b.city || "").trim();
      if (!market.cities.includes(city)) {
        // Keep the current city when it also belongs to the new
        // market; otherwise the creator must pick one inside it,
        // so a record can never carry a city outside its market.
        if (user.city && market.cities.includes(user.city)) city = user.city;
        else return err(400, `Choose your home city in the ${market.name} market`);
      }
      user.market = market.name;
      user.city = city;
      user.country = market.country || "United States";
      user.state = null;
      // An explicit market pick supersedes any earlier typed-city
      // resolution, so its stamps and stored candidates go.
      delete user.marketResolvedFrom;
      delete user.marketResolvedCity;
      delete user.marketCandidates;
    }
    const ts = nowIso();
    user.marketChangedAt = ts;
    user.updatedAt = ts;
    await store.set(`user:${user.id}`, user);
    await logEvent({ type: "market_changed", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { from: fromMarket, to: user.market, fromCity, toCity: user.city || "", via: "pending_self_serve" } });
    return json(200, { user: await withFounding(user) });
  }

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
      // Primary platform + handle (Jeff, 2026-10-22): the handle is
      // the handle ON the primary platform. Changing either one
      // rebuilds the primary profile URL; instagramUrl is only ever
      // written while Instagram is the primary platform, so a
      // TikTok handle can never leak into an instagram.com link.
      if (b.primaryPlatform !== undefined) {
        const nextPlatform = normalizePrimaryPlatform(b.primaryPlatform);
        changes.primaryPlatform = [primaryPlatformOf(c), nextPlatform];
        c.primaryPlatform = nextPlatform;
      }
      if (b.handle) { changes.handle = [c.handle, normalizeHandle(b.handle)]; c.handle = changes.handle[1]; }
      if (b.handle || b.primaryPlatform !== undefined) {
        const plat = primaryPlatformOf(c);
        c.primaryProfileUrl = primaryPlatformUrl(plat, c.handle);
        c.instagramUrl = plat === "instagram" ? `https://instagram.com/${c.handle}` : null;
        // Keep the primary platform's own social link in step with
        // the primary handle, the same backfill signup applies.
        if (plat === "tiktok") { c.tiktokHandle = c.handle; c.tiktokUrl = `https://www.tiktok.com/@${c.handle}`; }
        if (plat === "youtube") c.youtubeChannel = c.handle;
        if (plat === "facebook") c.facebookUrl = `https://www.facebook.com/${c.handle}`;
        if (plat === "x") { c.xHandle = c.handle; c.xUrl = `https://x.com/${c.handle}`; }
        if (plat === "linkedin") c.linkedinUrl = `https://www.linkedin.com/in/${c.handle}`;
      }
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
        // Connect Accounts (2026-10-28): a connected platform's
        // count is authoritative. Whatever an older or stale client
        // posts for that platform is replaced by the last synced
        // count, so a hand edit can never fight the sync. The
        // client disables those inputs anyway; this is the server
        // keeping the same promise on its own side.
        for (const conn of await platformConnect.listConnectionsForUser(user.id)) {
          if (conn && typeof conn.lastCount === "number" && conn.lastCount > 0) {
            stack[conn.platform] = Math.min(AUDIENCE_COUNT_CAP, conn.lastCount);
          }
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
      // Spanish content (Jeff, 2026-10-28): optional creator
      // attribute, simple yes/no (creates content in Spanish at
      // all = yes). Deliberately NOT a completeness field, so
      // existing profiles stay complete whether set or not.
      if (b.spanishContent !== undefined) {
        c.spanishContent = b.spanishContent === true;
        changes.spanishContent = [user.creator.spanishContent === true, c.spanishContent];
      }
      // Spanish-speaking audience share (Spanish layers S2,
      // Jeff, 2026-10-28): optional self-reported percentage,
      // the Spanish twin of localAudiencePct. Same write
      // discipline: an omitted field keeps the stored value,
      // null/empty clears, a number clamps to 0..100, and
      // non-numeric input resolves to null rather than erroring.
      // Deliberately NOT a completeness field.
      if (b.spanishAudiencePct !== undefined) {
        const numPct = b.spanishAudiencePct === null || b.spanishAudiencePct === "" ? NaN : Number(b.spanishAudiencePct);
        const pct = Number.isFinite(numPct) ? Math.max(0, Math.min(100, numPct)) : null;
        changes.spanishAudiencePct = [user.creator.spanishAudiencePct === undefined ? null : user.creator.spanishAudiencePct, pct];
        c.spanishAudiencePct = pct;
      }
      // Language preference (S1): the profile can also set or
      // clear the stored preference (a claim finished on a
      // second device, a support correction). "es" stores it on
      // the user record; "en" clears it back to the unmarked
      // default; anything else is ignored, never an error.
      if (b.lang !== undefined) {
        if (b.lang === "es") user.lang = "es";
        else if (b.lang === "en" || b.lang === "") delete user.lang;
      }
      // Musician openness (Jeff, 2026-10-28): three optional
      // signals, mirroring the Spanish attribute. "I am a
      // musician" plus what they are open to (performing live
      // for businesses, creating music for businesses). Signals
      // only: they change no booking flow, no offer type, no
      // rate, and are deliberately NOT completeness fields.
      if (b.musician !== undefined) {
        c.musician = b.musician === true;
        changes.musician = [user.creator.musician === true, c.musician];
      }
      if (b.musicPerform !== undefined) {
        c.musicPerform = b.musicPerform === true;
        changes.musicPerform = [user.creator.musicPerform === true, c.musicPerform];
      }
      if (b.musicCreate !== undefined) {
        c.musicCreate = b.musicCreate === true;
        changes.musicCreate = [user.creator.musicCreate === true, c.musicCreate];
      }
      if (b.paidRate !== undefined) {
        if (b.paidRate === null || b.paidRate === "") {
          changes.paidRate = [c.paidRate == null ? null : c.paidRate, null];
          c.paidRate = null;
        } else {
          const rate = Math.round(Number(b.paidRate) * 100) / 100;
          if (!Number.isFinite(rate) || rate < PAID_LANE.minRate) {
            return err(400, `Your paid rate must be at least $${fmtPriceS(PAID_LANE.minRate)}, or left blank for no paid bookings. Below that, the payment processing and support cost more than the booking is worth.`);
          }
          if (rate > 100000) return err(400, "That rate is too large to list. Set the rate a business actually books at.");
          changes.paidRate = [c.paidRate == null ? null : c.paidRate, rate];
          c.paidRate = rate;
        }
      }
      // Licensing fee (Jeff, 2026-10-26): optional, like the paid
      // rate. Null/empty means her comped posts cannot be licensed.
      // When set (any amount from $1: a license is a click, not a
      // visit, so the $50 booking floor does not apply), a business
      // can request the standard 90-day license on a delivered
      // comped post at exactly this fee; she approves or declines
      // each request, and keeps 97% when she approves.
      if (b.licensingFee !== undefined) {
        if (b.licensingFee === null || b.licensingFee === "") {
          changes.licensingFee = [c.licensingFee == null ? null : c.licensingFee, null];
          c.licensingFee = null;
        } else {
          const fee = Math.round(Number(b.licensingFee) * 100) / 100;
          if (!Number.isFinite(fee) || fee < 1) {
            return err(400, "Your licensing fee must be at least $1, or left blank if you do not want your comped posts licensed.");
          }
          if (fee > 100000) return err(400, "That fee is too large to list. Set the fee a business actually licenses at.");
          changes.licensingFee = [c.licensingFee == null ? null : c.licensingFee, fee];
          c.licensingFee = fee;
        }
      }
      // Your Three Streets (Build -32): up to 3 streets or
      // neighborhoods where the creator HANGS OUT (not where
      // they live). Free text, deduped, capped at 3. Deliberately
      // NOT a completeness field: nothing gates on it.
      if (b.streets !== undefined) {
        const raw = Array.isArray(b.streets) ? b.streets : [];
        const cleanStreets = [...new Set(raw.map((x) => String(x || "").trim().slice(0, 60)).filter(Boolean))].slice(0, 3);
        changes.streets = [Array.isArray(c.streets) ? c.streets : [], cleanStreets];
        c.streets = cleanStreets;
      }
      if (Array.isArray(b.categories)) c.categories = [...new Set(b.categories.map((x) => canonicalFromList(x, CREATOR_CATEGORIES)).filter((x) => !!x))];
      if (Array.isArray(b.compCategories)) {
        // Paid cash campaigns stay selectable only while the creator is
        // in the Headliners tier; dropping a tier drops the option.
        // Values canonicalize against COMP_CATEGORIES first (taxonomy
        // integrity); PAID_COMP rides outside that list as before.
        c.compCategories = [...new Set(b.compCategories
          .map((x) => (x === PAID_COMP ? PAID_COMP : canonicalFromList(x, COMP_CATEGORIES)))
          .filter((x) => !!x && (COMP_CATEGORIES.includes(x) || (x === PAID_COMP && c.tierBand === "Headliners"))))];
        c.openToPaidCampaigns = c.compCategories.includes(PAID_COMP);
      }
      if (c.tierBand !== "Headliners" && Array.isArray(c.compCategories) && c.compCategories.includes(PAID_COMP)) {
        c.compCategories = c.compCategories.filter((x) => x !== PAID_COMP);
        c.openToPaidCampaigns = false;
      }
      if (b.tiktokHandle !== undefined) { const tk = normalizeHandle(b.tiktokHandle); c.tiktokHandle = tk || null; c.tiktokUrl = tk ? `https://www.tiktok.com/@${tk}` : null; }
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
      // Typed-city resolution (Jeff, 2026-10-23): a still-unlisted
      // creator who corrects their city (or the state/country that
      // disambiguates it) may have typed a town that already
      // belongs to a market; file them under it, or refresh the
      // stored tie candidates.
      if (user.market === UNLISTED && (b.city !== undefined || b.state !== undefined || b.country !== undefined)) {
        const before = user.market;
        applyTypedCityResolution(user, user.city);
        if (user.market !== before) changes.market = [before, user.market];
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
      // Proximity (Build -31): the creator's home-base ZIP. Five
      // digits only; a street address is never asked for and
      // never stored. Deliberately NOT a completeness field: it
      // is prompted at completion and from home until set, and
      // profiles stay complete with or without it.
      if (b.zip !== undefined) {
        const z = String(b.zip || "").trim();
        if (z === "") { changes.zip = [c.zip || "", ""]; c.zip = ""; }
        else if (/^\d{5}$/.test(z)) { changes.zip = [c.zip || "", z]; c.zip = z; }
        else return err(400, "ZIP is the 5 digit code for your home base. Nothing more exact than that, ever.");
      }
      // "Show me in near-you results": default ON once a ZIP
      // exists; OFF removes the creator from proximity grouping
      // only, never from the roster itself.
      if (b.proximityOptOut !== undefined) {
        c.proximityOptOut = b.proximityOptOut === true;
        changes.proximityOptOut = [user.creator.proximityOptOut === true, c.proximityOptOut];
      }
      // Book-me page (Build -31): opt-in public page at
      // /c/<handle>, default OFF. Turning it on stamps when, so
      // the prompts can stop asking.
      if (b.publicPage !== undefined) {
        c.publicPage = b.publicPage === true;
        changes.publicPage = [user.creator.publicPage === true, c.publicPage];
        if (c.publicPage && !c.publicPageAt) c.publicPageAt = ts;
      }
      if (b.pageTheme !== undefined) {
        if (PAGE_THEMES.includes(b.pageTheme)) { changes.pageTheme = [pageThemeOf(user.creator), b.pageTheme]; c.pageTheme = b.pageTheme; }
      }
      // Featured posts: up to 3 Instagram post or reel links,
      // validated whole (one bad link refuses the save).
      if (b.featuredPosts !== undefined) {
        const v = normalizeFeaturedPosts(b.featuredPosts);
        if (!v) return err(400, "Featured posts are up to 3 Instagram post or reel links. Paste the full link to the post itself.");
        changes.featuredPosts = [(c.featuredPosts || []).length, v.length];
        c.featuredPosts = v;
      }
      // "Show my social channels to paying businesses": default
      // ON when socials exist; OFF hides the channel rows even
      // from paid, active businesses.
      if (b.showSocials !== undefined) {
        c.showSocials = b.showSocials !== false;
        changes.showSocials = [user.creator.showSocials === false, c.showSocials];
      }
      // Profession + realtor layer (Jeff, 2026-10-22): profession
      // is optional color from the fixed list; the realtor fields
      // (neighborhood tags, brokerage) are stored sanitized
      // whenever sent, and only SURFACE publicly while the
      // profession is Real estate agent, so switching profession
      // away from real estate retires the layer without deleting
      // what the creator typed.
      if (b.profession !== undefined) {
        const p = cleanProfession(b.profession);
        changes.profession = [c.profession || "", p];
        c.profession = p;
      }
      if (b.farmAreas !== undefined) {
        const farms = cleanFarmAreas(b.farmAreas);
        changes.farmAreas = [(c.farmAreas || []).length, farms.length];
        c.farmAreas = farms;
      }
      if (b.brokerage !== undefined) {
        const firm = String(b.brokerage || "").replace(/\s+/g, " ").trim().slice(0, 120);
        changes.brokerage = [c.brokerage || "", firm];
        c.brokerage = firm;
      }
      if (b.university !== undefined) {
        const resolved = resolveUniversity(b.university);
        changes.university = [universityOfRecord(user), resolved.name];
        c.university = resolved.name;
        user.university = resolved.name;
        c.universityCity = resolved.city;
        c.universityState = resolved.state;
        user.universityCity = resolved.city;
        user.universityState = resolved.state;
        c.universityUnverified = resolved.name ? !resolved.verified : false;
        user.universityUnverified = c.universityUnverified;
      }
      if (b.universityStatus !== undefined) {
        const status = normalizeUniversityStatus(b.universityStatus);
        changes.universityStatus = [universityStatusOfRecord(user), status];
        c.universityStatus = status;
        user.universityStatus = status;
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
      // Business ZIP (Build -31): the business's own address ZIP
      // on file, the anchor proximity bands are measured from.
      // Five digits; empty clears it.
      if (b.zip !== undefined) {
        const z = String(b.zip || "").trim();
        if (z === "") delete bz.zip;
        else if (/^\d{5}$/.test(z)) bz.zip = z;
        else return err(400, "ZIP is the 5 digit code for your business address.");
      }
      // Menu of Moments (Build -32): the business's standing
      // moment, picked on the founding page or the application.
      // A valid id stores; null or empty clears; anything else
      // is ignored and the stored value kept.
      if (b.moment !== undefined) {
        const m = validMoment(b.moment);
        if (m) bz.moment = m;
        else if (b.moment === null || b.moment === "") delete bz.moment;
      }
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
      // Referral-program tie-in (Jeff, 2026-10-25): the
      // business's own tracked link, code, and one-line note
      // from its POS or booking stack, saved once here and
      // shown to creators on every opportunity and booked
      // visit (referralProgramView). Omitted fields keep their
      // current values; an explicit empty string clears one.
      if (b.referralUrl !== undefined || b.referralCode !== undefined || b.referralNote !== undefined) {
        const v = validateReferralProgram({ url: b.referralUrl, code: b.referralCode, note: b.referralNote }, bz);
        if (!v.ok) return err(400, v.error);
        bz.referralUrl = v.url;
        bz.referralCode = v.code;
        bz.referralNote = v.note;
      }
      // Asset packet (Sig Operator, Jeff, 2026-10-28): the
      // business's reusable creator-facing kit, stored nested as
      // business.assetPacket. When the field is present it is
      // validated (every URL must be HTTPS) and stored; an
      // invalid packet is refused whole, never partially saved.
      if (b.assetPacket !== undefined) {
        const v = validateAssetPacket(b.assetPacket, bz);
        if (!v.ok) return err(400, v.error);
        bz.assetPacket = v.packet;
      }
      // Musician openness (Jeff, 2026-10-28): the business-side
      // mirror of the creator's musician signals. Three optional
      // booleans, omitted fields keep their current values, and
      // nothing about offers, rates, or bookings reads them:
      // they only mark the business as open to musicians on its
      // offers and page (see musicOpenView).
      if (b.musicOpen !== undefined) bz.musicOpen = b.musicOpen === true;
      if (b.musicLive !== undefined) bz.musicLive = b.musicLive === true;
      if (b.musicCreated !== undefined) bz.musicCreated = b.musicCreated === true;
      // Student openness (U3): the business-side campus flag,
      // same write discipline as the musician flags above: only
      // a present field writes, so an unrelated profile save can
      // never clear it. Nothing but the offers/page marks read
      // it (see studentOpenView).
      if (b.studentOpen !== undefined) bz.studentOpen = b.studentOpen === true;
      // Preferred language (Spanish layers S3, Jeff,
      // 2026-10-28): the business owner's own language
      // preference, "en" or "es" (absent = "en"). Strictly
      // validated: any other value is ignored and the stored
      // value kept, never an error. Sig honors it (see
      // /api/sig/ask) and Admin can see it; nothing gates on it
      // and the app UI does not re-render for it in this layer.
      if (b.preferredLanguage !== undefined) {
        const pl = String(b.preferredLanguage || "").trim().toLowerCase();
        if (pl === "en" || pl === "es") bz.preferredLanguage = pl;
      }
      // Average ticket (UX redesign section 4, 2026-10-24): the
      // business's typical register spend per customer, set once
      // and editable here. ROAS code-use estimates multiply logged
      // code uses by this until an actual tally replaces them.
      // null or "" clears it (estimates stop until it is set again).
      if (b.averageTicket !== undefined) {
        if (b.averageTicket === null || b.averageTicket === "") {
          delete bz.averageTicket;
        } else {
          const ticket = Number(b.averageTicket);
          if (!Number.isFinite(ticket) || ticket <= 0 || ticket > 100000) return err(400, "Average ticket must be a dollar amount above 0 and no more than 100000");
          bz.averageTicket = roasRound2(ticket);
        }
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

  // ---------- profile photo gallery ----------
  // Upload is a JSON body { dataUrl: "data:image/png;base64,..." } and
  // the bytes live in their own records: photo:{userId} is the cover
  // (slot 0, the original key), photo:{userId}:<n> the rest of the
  // gallery. Serving lives with the public routes above (approved
  // creators' photos are on their public profile; everyone else's
  // stay locked down).
  if (method === "POST" && seg[0] === "me" && seg[1] === "photo" && seg.length === 2) {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    const b = parseBody(event);
    const m = typeof b.dataUrl === "string" && b.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return err(400, "Send the photo as a PNG, JPEG, or WebP data URL");
    const bytes = Math.floor((m[2].length * 3) / 4);
    if (bytes > MAX_PHOTO_BYTES) return err(413, "That photo is too large. Please use one under 2.5 MB.");
    const count = photoCountOf(user.creator);
    let slot = 0;
    if (b.slot !== undefined && b.slot !== null) {
      slot = parseInt(b.slot, 10);
      if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_CREATOR_PHOTOS) return err(400, "That photo slot is not available");
      if (slot > count) return err(400, "Add photos in order: fill the earlier slots first");
      if (slot === count && count >= MAX_CREATOR_PHOTOS) return err(400, `A gallery holds up to ${MAX_CREATOR_PHOTOS} photos`);
    }
    const ts = nowIso();
    await store.set(photoKey(user.id, slot), { contentType: m[1], dataBase64: m[2], bytes, uploadedAt: ts });
    const newCount = Math.max(count, slot + 1);
    user.creator.photoCount = newCount;
    user.creator.hasPhoto = true;
    if (slot === 0) user.creator.photoUploadedAt = ts;
    user.updatedAt = ts;
    await store.set(`user:${user.id}`, user);
    await logEvent({ type: "profile_photo_uploaded", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { contentType: m[1], bytes, slot, photoCount: newCount } });
    return json(200, { ok: true, photoUrl: slot === 0 ? `/api/users/${user.id}/photo` : `/api/users/${user.id}/photo/${slot}`, photoCount: newCount, photos: photoUrlsFor(user) });
  }

  // Make one gallery photo the cover: the byte records rotate so
  // the chosen slot becomes slot 0 (the cover every card reads).
  if (method === "POST" && seg[0] === "me" && seg[1] === "photo" && seg[2] === "cover") {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    const b = parseBody(event);
    const count = photoCountOf(user.creator);
    const slot = parseInt(b.slot, 10);
    if (!Number.isInteger(slot) || slot < 0 || slot >= count) return err(400, "Pick one of your photos to make the cover");
    if (slot > 0) {
      const recs = [];
      for (let i = 0; i < count; i++) recs.push(await store.get(photoKey(user.id, i)));
      const order = [slot, ...recs.map((_, i) => i).filter((i) => i !== slot)];
      for (let pos = 0; pos < count; pos++) {
        const rec = recs[order[pos]];
        if (rec) await store.set(photoKey(user.id, pos), rec);
      }
      user.creator.photoUploadedAt = nowIso();
    }
    user.updatedAt = nowIso();
    await store.set(`user:${user.id}`, user);
    await logEvent({ type: "profile_photo_cover", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { slot, photoCount: count } });
    return json(200, { ok: true, photoCount: count, photos: photoUrlsFor(user) });
  }

  // Remove one gallery photo: later slots shift down to fill the
  // gap, so the gallery is always a dense ordered list.
  if (method === "DELETE" && seg[0] === "me" && seg[1] === "photo" && seg.length === 3) {
    if (user.role !== "creator" || !user.creator) return err(403, "Creators only");
    const count = photoCountOf(user.creator);
    const slot = parseInt(seg[2], 10);
    if (!Number.isInteger(slot) || slot < 0 || slot >= count) return err(404, "Photo not found");
    for (let i = slot; i < count - 1; i++) {
      const next = await store.get(photoKey(user.id, i + 1));
      if (next) await store.set(photoKey(user.id, i), next);
    }
    await store.del(photoKey(user.id, count - 1));
    const newCount = count - 1;
    user.creator.photoCount = newCount;
    user.creator.hasPhoto = newCount > 0;
    user.updatedAt = nowIso();
    await store.set(`user:${user.id}`, user);
    await logEvent({ type: "profile_photo_removed", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { slot, photoCount: newCount } });
    return json(200, { ok: true, photoCount: newCount, photos: photoUrlsFor(user) });
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
    // Partners (Jeff, 2026-10-28): Admin creates and manages
    // distribution partners. Creation makes the login through the
    // normal account shape; the partner sets their own password
    // through Forgot password. Edits cover markets, share, and
    // status only; a partner's code never changes once issued.
    if (seg[1] === "partners" && seg.length === 2 && method === "GET") {
      const partners = await allPartners();
      return json(200, {
        partners: partners.map((u) => ({
          id: u.id,
          email: u.email,
          ...publicPartner(u.partner),
          links: partnerLinksFor(publicPartner(u.partner), query.origin || undefined),
        })),
      });
    }
    if (seg[1] === "partners" && seg.length === 2 && method === "POST") {
      const b = parseBody(event);
      if (!b.name || typeof b.name !== "string" || !b.name.trim()) return err(400, "Partner name is required");
      if (!isEmail(b.email || "")) return err(400, "A valid login email is required");
      const markets = validPartnerMarkets(b.markets);
      if (!markets || !markets.length) return err(400, "Assign at least one real market");
      const sharePct = b.sharePct === undefined ? 60 : Number(b.sharePct);
      if (!Number.isFinite(sharePct) || sharePct <= 0 || sharePct > 100) return err(400, "Share must be between 1 and 100");
      const made = await createPartnerUser({ name: b.name.trim(), type: b.type, contactName: typeof b.contactName === "string" ? b.contactName.trim() : "", email: String(b.email).toLowerCase(), markets, sharePct, actorId: user.id });
      if (made.error) return err(409, made.error);
      return json(201, { partner: { id: made.user.id, email: made.user.email, ...publicPartner(made.user.partner), links: partnerLinksFor(publicPartner(made.user.partner)) } });
    }
    if (seg[1] === "partners" && seg[2] === "demo" && seg.length === 3 && method === "POST") {
      const seeded = await ensureDemoPartner(user.id);
      const p = publicPartner(seeded.user.partner);
      return json(200, { created: seeded.created, partner: { id: seeded.user.id, email: seeded.user.email, ...p, links: partnerLinksFor(p) } });
    }
    if (seg[1] === "partners" && seg.length === 3 && method === "PATCH") {
      const target = await store.get(`user:${seg[2]}`);
      if (!target || target.role !== "partner" || !target.partner) return err(404, "Partner not found");
      const b = parseBody(event);
      if (b.markets !== undefined) {
        const markets = validPartnerMarkets(b.markets);
        if (!markets || !markets.length) return err(400, "Assign at least one real market");
        target.partner.markets = markets;
        target.market = markets[0];
      }
      if (b.sharePct !== undefined) {
        const sharePct = Number(b.sharePct);
        if (!Number.isFinite(sharePct) || sharePct <= 0 || sharePct > 100) return err(400, "Share must be between 1 and 100");
        target.partner.sharePct = sharePct;
      }
      if (b.status !== undefined) {
        if (b.status !== "active" && b.status !== "paused") return err(400, "Status must be active or paused");
        target.partner.status = b.status;
      }
      if (typeof b.contactName === "string") target.partner.contactName = b.contactName.trim();
      if (typeof b.name === "string" && b.name.trim()) target.partner.name = b.name.trim();
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "partner_updated", actorId: user.id, actorRole: "admin", subjectId: target.id, data: { code: target.partner.code } });
      return json(200, { partner: { id: target.id, email: target.email, ...publicPartner(target.partner), links: partnerLinksFor(publicPartner(target.partner)) } });
    }
    if (method === "GET" && seg[1] === "applications") {
      const all = await allUsers();
      await ensureBusinessAnchors(all);
      const users = all.filter((u) => u.role !== "admin");
      const { approvedRank, pendingRank } = creatorRanks(all);
      const [allBk, allPo, allRv, allBz] = await Promise.all([allBookings(), allPosts(), allReviews(), allBizReviews()]);
      const momentum = createMomentum({ users: all, bookings: allBk, posts: allPo, reviews: allRv, bizReviews: allBz });
      const attach = (u) => {
        const pub = publicUser(u);
        // Admin-only visibility of the internal decision markers
        // (publicUser strips them from every client payload; this
        // endpoint is behind admin auth).
        if (u.approvedBy) pub.approvedBy = u.approvedBy;
        if (u.decisionReason) pub.decisionReason = u.decisionReason;
        if (u.decisionNote) pub.decisionNote = u.decisionNote;
        if (u.rejectionReason) pub.rejectionReason = u.rejectionReason;
        // Typed-city suggestion (Jeff, 2026-10-23): an unlisted
        // record whose typed city already belongs to a market gets
        // the resolver's suggestion inline, so it can be filed
        // with one tap (POST /admin/users/file-market). Computed
        // on every read; the record itself is never moved here.
        if (u.market === UNLISTED) {
          const res = resolveTypedCity(u.city || "", { state: u.state, country: u.country });
          if (res.status === "unique") pub.marketSuggestion = { status: "unique", market: res.market, city: res.city, typedCity: u.city || "" };
          else if (res.status === "ambiguous") pub.marketSuggestion = { status: "ambiguous", markets: res.markets, city: res.city, typedCity: u.city || "" };
        }
        if (u.role === "creator") {
          pub.university = universityOfRecord(u);
          pub.universityStatus = universityStatusOfRecord(u);
          pub.universityUnverified = u.universityUnverified === true || !!(u.creator && u.creator.universityUnverified === true);
          pub.campusBadge = campusBadgeFor(u);
          if (pub.creator) pub.creator = { ...pub.creator, university: pub.university, universityStatus: pub.universityStatus, universityUnverified: pub.universityUnverified, primaryPlatform: primaryPlatformOf(pub.creator), primaryPlatformLabel: primaryPlatformLabel(primaryPlatformOf(pub.creator)), primaryProfileUrl: primaryProfileOf(pub.creator).url };
          pub.foundingPriority = approvedRank.get(u.id) || null;
          pub.queuePosition = pendingRank.get(u.id) || null;
          pub.momentum = momentum.summaryFor(u);
        }
        if (u.role === "business") {
          // Preferred language (S3): attached explicitly so
          // Admin sees it before anyone writes to this business.
          pub.preferredLanguage = (u.business && u.business.preferredLanguage) || "en";
        }
        return pub;
      };
      const pending = users.filter((u) => u.status === "pending").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const decided = users.filter((u) => u.status !== "pending").sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1));
      // Founding roster counts (Jeff, 2026-10-21): approval alone is
      // not the launch number any more. The quick claim holds the
      // spot with almost nothing on file, so this strip separates
      // approved from approved AND profile-complete (the only
      // creators businesses can actually see). Creators only;
      // testers never count toward the roster, matching the markets
      // endpoint. Computed from the records on every read.
      const LAUNCH_MARKET_LABELS = [
        ["Virginia Beach", "Virginia Beach (Hampton Roads)"],
        ["Richmond", "Richmond"],
        ["Raleigh", "Raleigh/The Triangle"],
        ["Washington DC", "Washington DC"],
      ];
      const rosterCounts = (list) => ({
        pending: list.filter((u) => u.status === "pending").length,
        approved: list.filter((u) => u.status === "approved" && !isTester(u)).length,
        approvedComplete: list.filter((u) => u.status === "approved" && !isTester(u) && profileCompleteOf(u)).length,
      });
      const creatorsAll = users.filter((u) => u.role === "creator");
      // Auto-decided counts (internal, admin only): records the
      // standing rules decided without a person, all time and
      // today (America/New_York, the same calendar the campaign
      // ceiling uses). Derived from the record markers themselves.
      const etToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      const etDay = (iso) => {
        if (!iso) return "";
        try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso)); } catch (e) { return ""; }
      };
      const autoApproved = creatorsAll.filter((u) => u.status === "approved" && typeof u.approvedBy === "string" && u.approvedBy.startsWith("auto_"));
      const autoRejected = creatorsAll.filter((u) => u.status === "rejected" && u.decisionReason === "auto_test");
      const auto = {
        approved: autoApproved.length,
        rejected: autoRejected.length,
        approvedToday: autoApproved.filter((u) => etDay(u.reviewedAt) === etToday).length,
        rejectedToday: autoRejected.filter((u) => etDay(u.reviewedAt) === etToday).length,
      };
      const summary = {
        markets: LAUNCH_MARKET_LABELS.map(([name, label]) => ({ market: name, label, ...rosterCounts(creatorsAll.filter((u) => normalizeMarketName(u.market) === name)) })),
        all: rosterCounts(creatorsAll),
        auto,
      };
      return json(200, { pending: pending.map(attach), decided: decided.map(attach), summary });
    }
    // Admin profile view (Jeff, 2026-10-26): the Requests card's
    // "View profile" opens the applicant's full SIGNL profile
    // exactly as a business would see it. The public /c/ page only
    // resolves for approved, profile-complete creators, so a
    // pending applicant (the very person Jeff is deciding on) had
    // no viewable profile at all. This endpoint serves the SAME
    // Discover card payload (publicCreator + momentum + badges +
    // standing) for any creator record, behind admin auth only.
    if (method === "GET" && seg[1] === "creators" && seg[2]) {
      const target = await store.get(`user:${seg[2]}`);
      if (!target || target.role !== "creator") return err(404, "Creator not found");
      const all = await allUsers();
      const { approvedRank, pendingRank } = creatorRanks(all);
      const [cpBk, cpPo, cpRv, cpBz] = await Promise.all([allBookings(), allPosts(), allReviews(), allBizReviews()]);
      const momentum = createMomentum({ users: all, bookings: cpBk, posts: cpPo, reviews: cpRv, bizReviews: cpBz });
      const card = await publicCreator(target, user, approvedRank.get(target.id) || pendingRank.get(target.id) || null);
      card.momentum = momentum.summaryFor(target);
      card.badges = momentum.badgesFor(target);
      card.standing = standingState(target);
      card.applicationStatus = target.status;
      return json(200, { creator: card });
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
          primaryProfileUrl: primaryProfileOf(u.creator).url,
          market: normalizeMarketName(u.market),
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
          creatorsApprovedComplete: inMarket.filter((u) => u.role === "creator" && u.status === "approved" && !isTester(u) && profileCompleteOf(u)).length,
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
      // A human rejection of a creator may carry one reason
      // category from the fixed list (audit F4): it is stored on
      // the record, rides the rejection event, and is named in the
      // rejection email. Any other value reads as no reason given.
      // This handler is human-admin only; the auto-decision path
      // never reaches it, so auto-rejections stay silent.
      const rejectionReason = b.decision === "reject" && target.role === "creator" && REJECTION_REASONS.includes(b.reason) ? b.reason : null;
      target.status = b.decision === "approve" ? "approved" : "rejected";
      target.reviewedAt = nowIso();
      target.reviewedBy = user.id;
      if (rejectionReason) target.rejectionReason = rejectionReason;
      if (b.decision === "approve") delete target.rejectionReason;
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: b.decision === "approve" ? "application_approved" : "application_rejected", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { applicantRole: target.role, email: target.email, ...(rejectionReason ? { rejectionReason } : {}) } });
      if (b.decision === "reject" && target.role === "creator") {
        // Rejection email (audit F4): queued as an event always,
        // sent when the SMTP transport is configured, best-effort
        // exactly like the approval email.
        try {
          const mail = rejectionEmail(target, rejectionReason);
          await deliverEmail("rejection", target, mail.subject, mail.text, null);
        } catch (e) { /* email is best-effort */ }
      }
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
    // Auto-decision cleanup on demand: re-runs the standing-rule
    // pass over pending records and returns its audit (the same
    // pass runs once on its own after deploy). Admin only, like
    // every decision surface.
    if (method === "POST" && seg[1] === "auto-decisions" && seg[2] === "run") {
      const audit = await runAutoDecisionCleanup();
      return json(200, { ok: true, audit });
    }
    if (method === "GET" && seg[1] === "auto-decisions") {
      const rec = await store.get(AUTO_DECISION_CLEANUP_KEY);
      return json(200, { cleanup: rec || null });
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
      const targets = all.filter((u) => u.role === "business" && u.business && normalizeMarketName(u.market) === market.name && u.status === "approved" && businessAccessState(u) !== "active");
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
    // Extended to businesses (2026-10-24): the flag lives on any
    // user record, the Stats tester count already counts every
    // flagged user, and campaign sends already skip any flagged
    // account's email, so a business tester is the same mechanism
    // with its own event names (business_marked_tester /
    // business_unmarked_tester).
    if (method === "POST" && seg[1] === "tester") {
      const b = parseBody(event);
      const target = await store.get(`user:${b.userId}`);
      if (!target || (target.role !== "creator" && target.role !== "business")) return err(404, "Account not found");
      if (typeof b.tester !== "boolean") return err(400, "tester must be true or false");
      target.tester = b.tester;
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      const prefix = target.role === "business" ? "business" : "creator";
      await logEvent({ type: b.tester ? `${prefix}_marked_tester` : `${prefix}_unmarked_tester`, actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { email: target.email, tester: b.tester } });
      return json(200, { user: publicUser(target) });
    }
    // File an unlisted record under a market (Jeff, 2026-10-23):
    // the admin tap behind the inline resolver suggestion on the
    // applications queue. The posted market must be one the
    // resolver currently derives from the record's typed city
    // (the unique answer, or one of the tie's candidates), so the
    // endpoint can never file a record somewhere its own city
    // does not point. The typed city stays as the home city;
    // existing records move ONLY through this tap, never silently.
    if (method === "POST" && seg[1] === "users" && seg[2] === "file-market") {
      const b = parseBody(event);
      const target = b.userId ? await store.get(`user:${b.userId}`) : null;
      if (!target || target.role === "admin") return err(404, "Application not found");
      if (target.market !== UNLISTED) return err(400, "That record is already filed under a market");
      const wanted = marketByName(String(b.market || ""));
      if (!wanted) return err(400, "Choose one of the SIGNL markets");
      const res = resolveTypedCity(target.city || "", { state: target.state, country: target.country });
      const candidates = res.status === "unique" ? [res.market] : res.status === "ambiguous" ? res.markets : [];
      if (!candidates.includes(wanted.name)) {
        return err(400, candidates.length
          ? `${target.city || "That city"} resolves to ${candidates.join(" or ")}, not ${wanted.name}`
          : `${target.city || "That city"} does not belong to any SIGNL market yet`);
      }
      const match = (res.matches || []).find((mm) => mm.market === wanted.name);
      const fromCity = target.city || "";
      target.market = wanted.name;
      target.marketResolvedFrom = "admin_suggestion";
      target.marketResolvedCity = res.status === "unique" ? res.city : match ? match.city : fromCity;
      target.marketFiledBy = user.id;
      target.marketFiledAt = nowIso();
      delete target.marketCandidates;
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "market_filed", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { from: UNLISTED, to: target.market, typedCity: fromCity, via: "admin_suggestion" } });
      return json(200, { user: publicUser(target) });
    }
    if (method === "GET" && seg[1] === "events") {
      // Guarded like the rest of Hardening A (INCIDENT-2026-10-25):
      // if the event-log read fails, the tab must still render —
      // an empty, flagged payload — never hang or 500. listEvents
      // itself is bounded (newest 1,000 keys max), so this guard is
      // the backstop, not the fix.
      try {
        const events = await listEvents({ limit: Math.min(2000, parseInt(query.limit, 10) || 500) });
        const filtered = query.type ? events.filter((e) => e.type === query.type) : events;
        return json(200, { events: filtered, total: filtered.length });
      } catch (e) {
        console.error("SIGNL admin events read failed (rendering empty, degraded):", e);
        return json(200, { events: [], total: 0, degraded: true });
      }
    }
    if (method === "GET" && seg[1] === "stats") {
      const users = (await allUsers()).filter((u) => u.role !== "admin");
      const offers = await allOffers();
      const bookings = await allBookings();
      const posts = await allPosts();
      const perMarket = {};
      for (const m of MARKETS) perMarket[m.name] = { creators: 0, businesses: 0, bookings: 0, posts: 0 };
      for (const u of users) {
        const mkey = normalizeMarketName(u.market);
        if (!perMarket[mkey]) continue;
        if (u.role === "creator" && u.status === "approved" && !isTester(u)) perMarket[mkey].creators += 1;
        if (u.role === "business" && u.status === "approved") perMarket[mkey].businesses += 1;
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
      // Spanish + campus layers readout (S4, Jeff, 2026-10-28):
      // read-only, computed from the same records on every call;
      // nothing here is stored. Per market: creator totals,
      // approvals, finished profiles, the Spanish-content flag,
      // how many carry a Spanish-reach %, and claims inside the
      // window (?days=, default 30) with the Spanish subset
      // (Spanish-content toggle OR a stored lang=es preference).
      // Unlisted sign-ups group by typed city + country, exactly
      // like unlistedByCity above, so non-launch markets (the
      // LATAM radar) show up as their own rows. Testers are out
      // of every count. Campus Leads come from the same momentum
      // pass Admin applications uses (U2); business language is
      // the S3 preferredLanguage split.
      const daysParam = Number(query.days);
      const periodDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.max(1, Math.min(365, Math.floor(daysParam))) : 30;
      const sinceMs = Date.now() - periodDays * 86400000;
      const layerRows = {};
      for (const u of users) {
        if (u.role !== "creator" || isTester(u)) continue;
        let key;
        if (u.market === UNLISTED) {
          const region = u.country || u.state || "";
          key = `${u.city || "Unknown"}${region ? ", " + region : ""}`;
        } else key = normalizeMarketName(u.market);
        const row = layerRows[key] || (layerRows[key] = { market: key, creators: 0, approved: 0, complete: 0, spanishFlagged: 0, withSpanishPct: 0, claimsInPeriod: 0, spanishClaimsInPeriod: 0 });
        row.creators += 1;
        if (u.status === "approved") row.approved += 1;
        if (profileCompleteOf(u)) row.complete += 1;
        const spanish = !!(u.creator && u.creator.spanishContent === true);
        if (spanish) row.spanishFlagged += 1;
        if (u.creator && typeof u.creator.spanishAudiencePct === "number") row.withSpanishPct += 1;
        const createdMs = Date.parse(u.createdAt || "");
        if (Number.isFinite(createdMs) && createdMs >= sinceMs) {
          row.claimsInPeriod += 1;
          if (spanish || u.lang === "es") row.spanishClaimsInPeriod += 1;
        }
      }
      const layersMomentum = createMomentum({ users, bookings, posts });
      const leadMap = {};
      for (const u of users) {
        if (u.role !== "creator" || isTester(u)) continue;
        const cl = layersMomentum.detailFor(u).campusLead;
        if (cl && cl.qualified) {
          const entry = leadMap[cl.university] || (leadMap[cl.university] = { university: cl.university, leads: 0, handles: [] });
          entry.leads += 1;
          if (u.creator && u.creator.handle) entry.handles.push(u.creator.handle);
        }
      }
      const businessLanguage = { en: 0, es: 0 };
      for (const u of users) {
        if (u.role !== "business") continue;
        if (u.business && u.business.preferredLanguage === "es") businessLanguage.es += 1;
        else businessLanguage.en += 1;
      }
      const layers = {
        periodDays,
        markets: Object.values(layerRows).sort((a, b) => b.creators - a.creators),
        campusLeads: Object.values(leadMap).sort((a, b) => b.leads - a.leads),
        businessLanguage,
      };
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
        layers,
      });
    }
    // Creator outreach campaigns (Jeff, 2026-10-19): status,
    // import, arm, disarm. Sending itself lives in
    // runCampaignSweep (scheduled function + sweep endpoint above);
    // these routes only manage the queue and the arm switch.
    if (method === "GET" && seg[1] === "campaign" && !seg[2]) {
      const campaignId = validCampaignId(query.campaignId) ? query.campaignId : DEFAULT_CAMPAIGN_ID;
      const senderProfiles = {};
      for (const name of CAMPAIGN_MAILBOXES) senderProfiles[name] = senderProfile(name).available;
      // Guarded like the rest of Hardening A (INCIDENT-2026-10-25):
      // if the campaign reads fail, the tab must still render — a
      // zeroed, flagged payload — never hang or 500. The reads
      // themselves are bounded now (keys + parallel getMany, one
      // shared scan for both sent-today derivations), so this guard
      // is the backstop, not the fix.
      try {
        const cfg = await getCampaignConfig(campaignId);
        const recipients = await listCampaignRecipients(campaignId);
        const counts = campaignCounts(recipients);
        const recentSends = recipients
          .filter((r) => r.status === "sent")
          .sort((a, b) => ((a.sentAt || "") < (b.sentAt || "") ? 1 : -1))
          .slice(0, 10)
          .map((r) => ({ email: r.email, name: r.name || "", handle: r.handle || "", market: r.market || "", sentAt: r.sentAt || null, messageRef: r.messageRef || null, fromMailbox: CAMPAIGN_MAILBOXES.includes(r.sentFrom) ? r.sentFrom : "default" }));
        const sentStats = await campaignSentTodayStats(new Date());
        return json(200, { campaign: campaignView(cfg, counts, sentStats.total, sentStats.byProfile), counts, recentSends, senderProfiles });
      } catch (e) {
        console.error("SIGNL admin campaign read failed (rendering zeroed, degraded):", e);
        const zeroCounts = { queued: 0, sent: 0, bounced: 0, skipped: 0, total: 0 };
        const fallbackCfg = { id: campaignId, armed: false, armedAt: null, armedBy: null, disarmedAt: null, disarmReason: null, lastError: null, lastRunAt: null, totalSent: 0, fromMailbox: "default", createdAt: null, updatedAt: null };
        return json(200, { campaign: campaignView(fallbackCfg, zeroCounts, null, null), counts: zeroCounts, recentSends: [], senderProfiles, degraded: true });
      }
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
        if (!isEmail(email)) { invalid.push({ email: email || null, reason: "invalid email" }); continue; }
        let handle = "";
        let market = "";
        let opener = "";
        let name = "";
        let bizFields = {};
        if (campaignId === BUSINESS_CAMPAIGN_ID) {
          // Business wave recipients are businesses, not creators:
          // no handle, no opener. The template needs the business
          // name, a greeting, the prose category for the sentence,
          // the app category for the prebuilt link, and the
          // neighborhood. handle stays empty on purpose: claim
          // evidence only ever indexes recipients WITH a handle,
          // so a business recipient can never be read as creator
          // evidence.
          const businessName = String(item.businessName || "").trim().slice(0, 120);
          const greeting = String(item.greeting || "").trim().slice(0, 80);
          const category = String(item.category || "").trim().slice(0, 80);
          const appCategory = String(item.appCategory || "").trim().slice(0, 60);
          const neighborhood = String(item.neighborhood || "").trim().slice(0, 120);
          market = normalizeMarketName(String(item.market || "Virginia Beach").trim().slice(0, 60)) || "Virginia Beach";
          if (!businessName) { invalid.push({ email, reason: "businessName is required" }); continue; }
          if (!greeting) { invalid.push({ email, reason: "greeting is required" }); continue; }
          if (!category) { invalid.push({ email, reason: "category is required" }); continue; }
          if (!BUSINESS_CATEGORIES.includes(appCategory)) { invalid.push({ email, reason: "appCategory must be one of the app business categories" }); continue; }
          if (!neighborhood) { invalid.push({ email, reason: "neighborhood is required" }); continue; }
          name = businessName;
          bizFields = { businessName, greeting, category, appCategory, neighborhood };
        } else {
          handle = String(item.handle || "").trim().replace(/^@/, "").slice(0, 40);
          market = String(item.market || "").trim().slice(0, 60);
          opener = String(item.opener || "").trim().slice(0, 280);
          name = String(item.name || "").trim().slice(0, 120);
          if (!handle) { invalid.push({ email, reason: "handle is required" }); continue; }
          if (!market) { invalid.push({ email, reason: "market is required" }); continue; }
          if (!opener) { invalid.push({ email, reason: "opener is required" }); continue; }
        }
        const key = `campaign-recipient:${campaignId}:${email}`;
        const existing = await store.get(key);
        if (existing) { duplicates += 1; continue; }
        const ts = nowIso();
        if (testerEmails.has(email)) {
          await store.set(key, { campaignId, email, name, handle, market, opener, ...bizFields, status: "skipped", skipReason: "tester_account", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
          skipped += 1;
          continue;
        }
        if (skipSet.has(email)) {
          await store.set(key, { campaignId, email, name, handle, market, opener, ...bizFields, status: "skipped", skipReason: "blocklist", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
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
            await store.set(key, { campaignId, email, name, handle, market, opener, ...bizFields, status: "skipped", skipReason: "cross_campaign", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
            skipped += 1;
            crossCampaign += 1;
            continue;
          }
        }
        await store.set(key, { campaignId, email, name, handle, market, opener, ...bizFields, status: "queued", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
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
    // Sender mailbox selection (Jeff, 2026-10-24): which sender
    // profile a campaign's mail leaves from. Values are the
    // CAMPAIGN_MAILBOXES keys; "default" is the shipped behavior
    // (hello@joinsignl.com). Selecting a signlteam profile does
    // not activate it: the profile sends only once its SMTP vars
    // exist in the environment, and until then the sweep skips
    // the campaign rather than send from the wrong identity.
    if (method === "POST" && seg[1] === "campaign" && seg[2] === "sender") {
      const b = parseBody(event);
      const campaignId = b.campaignId === undefined ? DEFAULT_CAMPAIGN_ID : b.campaignId;
      if (!validCampaignId(campaignId)) return err(400, "campaignId must be lowercase letters, numbers, and dashes");
      if (!CAMPAIGN_MAILBOXES.includes(b.fromMailbox)) return err(400, `fromMailbox must be one of: ${CAMPAIGN_MAILBOXES.join(", ")}`);
      let cfg = await getCampaignConfig(campaignId);
      if (!cfg.createdAt) cfg.createdAt = nowIso();
      cfg.fromMailbox = b.fromMailbox;
      await saveCampaignConfig(cfg);
      await logEvent({ type: "campaign_sender_changed", actorId: user.id, actorRole: "admin", subjectId: null, market: null, data: { campaignId, fromMailbox: b.fromMailbox } });
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
      const disc = await discoverCards(query, { id: "__preview__", role: "business", market: null });
      return json(200, { creators: disc.creators.map(decoratePreviewCard), universities: disc.universities, preview: true });
    }
    if (method === "GET" && seg[1] === "preview" && seg[2] === "creator" && seg[3]) {
      const target = await store.get(`user:${seg[3]}`);
      if (!target || target.role !== "creator" || target.status !== "approved") return err(404, "Creator not found");
      const { users, momentum } = await momentumContext();
      const { approvedRank } = creatorRanks(users);
      const card = await publicCreator(target, { id: "__preview__", role: "business", market: null }, approvedRank.get(target.id) || null);
      card.momentum = momentum.summaryFor(target);
      card.standing = standingState(target);
      return json(200, { creator: decoratePreviewCard(card), preview: true });
    }
    // Creator-side preview (Jeff, 2026-10-25): the creator Offers
    // deck had nothing to test against — real open offers are zero
    // pre-launch and the real marketplace is never seeded. These
    // simulated open offers exist only inside preview: shaped
    // exactly like the real /open-offers payload, built fresh per
    // request, and applying to one writes NOTHING (no application,
    // no notification, no event).
    if (method === "GET" && seg[1] === "preview" && seg[2] === "open-offers") {
      return json(200, { offers: previewOpenOffers(), preview: true });
    }
    if (method === "POST" && seg[1] === "preview" && seg[2] === "apply") {
      const b = parseBody(event);
      const offer = previewOpenOffers().find((o) => o.id === b.offerId);
      if (!offer) return err(404, "That preview offer does not exist");
      return json(201, { preview: true, applied: true, offerId: offer.id, note: "Simulation only: no application was written and the business is not notified." });
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
        market: targetCreator ? targetCreator.market : String(b.market || "Virginia Beach"),
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
    // offers. Validates the target and the visit-type right (ad use
    // comes with paid visits only, on every plan; rights model
    // adopted 2026-10-21), returns a flagged confirmation, and
    // writes NOTHING: no ad_use_declared event, no notification,
    // no Momentum.
    if (method === "POST" && seg[1] === "preview" && seg[2] === "ad-use") {
      const b = parseBody(event);
      const plan = planById(b.planId || "") || PLANS[0];
      const visitKind = b.visitKind === "paid" ? "paid" : "comp";
      if (!visitRightsForVisit(visitKind).adUse) return err(400, "Ad use comes with paid visits only. A comp visit covers native sharing only, on every plan.");
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
          visitKind,
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
    // Preview license request (Jeff, 2026-10-26): licensing a
    // comped post, simulated with the same discipline. Validates
    // the creator and her listed licensing fee, runs the REAL fee
    // math, returns a flagged simulated request, and writes
    // NOTHING: no request, no event, no notification, no escrow.
    if (method === "POST" && seg[1] === "preview" && seg[2] === "license-request") {
      const b = parseBody(event);
      const targetCreator = b.creatorId ? await store.get(`user:${b.creatorId}`) : null;
      if (!targetCreator || targetCreator.role !== "creator" || targetCreator.status !== "approved" || isTester(targetCreator)) return err(400, "Target creator is not an approved creator");
      const fee = Number(targetCreator.creator && targetCreator.creator.licensingFee);
      if (!Number.isFinite(fee) || fee < 1) return err(400, "That creator has not listed a licensing fee, so there is no license to preview.");
      const math = paidMath(fee);
      return json(201, {
        preview: true,
        licenseRequest: {
          preview: true,
          creatorId: targetCreator.id,
          creatorHandle: targetCreator.creator ? targetCreator.creator.handle : null,
          fee: math.rate,
          businessTotal: math.businessTotal,
          creatorNet: math.creatorNet,
          platformFee: math.platformFee,
          licenseDays: LICENSE_WINDOW_DAYS,
          escrowState: "held",
          note: "Simulation only: no request saved, the creator is not contacted, and no payment is recorded.",
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

  // ---------- founding business roster preview (first 60 seconds, Jeff, 2026-10-29) ----------
  // The ONE read a founding business gets before activation, and
  // it is a preview, not product access. It exists so a business
  // that just signed up can SEE what SIGNL is before any payment
  // decision. As of BUILD -30 (Jeff, 2026-10-29) the payload
  // carries NO roster counts and NO creator cards: totals and
  // thin-market framing are anti-marketing while rosters are
  // small, and counts only become an asset at scale. What it
  // carries instead is category presence: the canonical creator
  // categories that have at least one finished creator in the
  // business's own market (presence only, never a count), from
  // the same discoverCards query Discover answers. The client
  // pairs it with mechanics and personalization (the Sig-drafted
  // first offer, the local-reach explainer, founding pricing).
  // It creates nothing, favorites nothing, and opens no
  // marketplace section: the founding gate below still refuses
  // discover, favorites, offers, bookings and the rest exactly as
  // before. Placed ahead of that gate and ahead of the approved
  // gate on purpose: a business whose application is still in
  // review sees the same Founding Status page, so it gets the
  // same preview.
  if (method === "GET" && seg[0] === "me" && seg[1] === "roster-preview" && seg.length === 2) {
    if (!user || user.role !== "business") return err(403, "Businesses only");
    if (!isFoundingBusiness(user)) return err(403, "Your business is active. Your full roster is under Find creators.");
    await ensureBusinessAnchors(await allUsers());
    const freshMe = await store.get(`user:${user.id}`);
    const myAnchor = (freshMe && freshMe.business && freshMe.business.anchor) || (user.business && user.business.anchor) || null;
    const disc = await discoverCards({ market: user.market }, user);
    const present = new Set();
    for (const c of disc.creators) {
      for (const raw of (c.profile && c.profile.categories) || []) {
        const canon = canonicalFromList(raw, CREATOR_CATEGORIES) || raw;
        if (canon) present.add(canon);
      }
    }
    // Proximity preview (Build -31): which distance bands have
    // finished creators in them for THIS business, and which
    // categories those bands cover. Bands and categories only:
    // no band ever carries a creator count.
    const bandCats = new Map();
    for (const card of disc.creators) {
      if (!card.distanceBand) continue;
      if (!bandCats.has(card.distanceBand)) bandCats.set(card.distanceBand, new Set());
      for (const raw of (card.profile && card.profile.categories) || []) {
        const canon = canonicalFromList(raw, CREATOR_CATEGORIES) || raw;
        if (canon) bandCats.get(card.distanceBand).add(canon);
      }
    }
    return json(200, {
      preview: true,
      viewerAnchor: myAnchor,
      market: user.market,
      marketLive: await isMarketLive(user.market),
      categories: CREATOR_CATEGORIES.filter((name) => present.has(name)),
      proximity: {
        hasZip: !!zipCentroid(user.business && user.business.zip),
        bands: PROXIMITY_BANDS.filter((band) => bandCats.has(band)).map((band) => ({ band, categories: CREATOR_CATEGORIES.filter((name) => bandCats.get(band).has(name)) })),
      },
    });
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
  // ---------- partner self-service (Jeff, 2026-10-28) ----------
  // A partner reads only their own summary, computed from records
  // stamped with their own code. There is no partner-id parameter
  // anywhere on these routes: the session decides whose data it is.
  if (seg[0] === "partner" && seg[1] === "summary" && seg.length === 2 && method === "GET") {
    if (!user || user.role !== "partner" || !user.partner) return err(403, "Partners only");
    return json(200, await partnerSummary(user));
  }
  if (seg[0] === "partner" && seg[1] === "qr" && seg.length === 2 && method === "GET") {
    if (!user || user.role !== "partner" || !user.partner) return err(403, "Partners only");
    const partner = publicPartner(user.partner);
    const kind = query.kind === "business" ? "business" : "creator";
    const link = partnerLinksFor(partner).find((l) => l.market === query.market);
    if (!link) return err(404, "No link for that market");
    try {
      const qrcode = require("qrcode-generator");
      const qr = qrcode(0, "M");
      qr.addData(link[kind]);
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 6, margin: 8, scalable: true });
      return { statusCode: 200, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" }, body: svg };
    } catch (e) {
      return err(501, "QR generation is unavailable on this deployment; the link works on its own.");
    }
  }

  if (method === "GET" && seg[0] === "me" && seg[1] === "founding") {
    if (user.role !== "creator") return err(403, "Creators only");
    const summaryRaw = await foundingSummary(user);
    const summary = publicFounding(summaryRaw);
    const { approvedRank } = creatorRanks(await allUsers());
    const card = await publicCreator(user, user, approvedRank.get(user.id) || null);
    const buzz = await creatorBuzz(user);
    const today = nowIso().slice(0, 10);
    if (user.foundingViewedOn !== today) {
      user.foundingViewedOn = today;
      user.updatedAt = nowIso();
      await store.set(`user:${user.id}`, user);
      await logEvent({ type: "founding_status_viewed", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { priorityPosition: summaryRaw.priorityPosition, marketLive: summaryRaw.marketLive } });
    }
    return json(200, { founding: summary, card, buzz });
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
        return err(403, `The ${marketTalkName(user.market)} market has not launched yet. Founding creators keep priority in the order they signed up, and ${marketTalkName(user.market)} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}.`);
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
  //   ?category=      creator content category, or a comma-separated
  //                   list of them (matches ANY of them: OR)
  //   ?compCategory=  a comp category the creator accepts (business
  //                   category fit: "what would they take from us")
  //   ?followersMin= / ?followersMax=   follower-count range
  //   ?minLocalPct=   minimum % of the creator's followers in market
  //                   (the lead differentiator: no major platform
  //                   shows an SMB this number)
  //   ?paid=1         only creators open to paid cash campaigns
  //   ?q=             name or handle text search
  //   ?sort=          founding (default) | score | momentum | fit
  //                   (fit = matching fit against the requesting
  //                   business's own record, lib/fit.js)
  if (method === "GET" && seg[0] === "discover") {
    // The query itself lives in discoverCards() so the admin Business
    // Preview answers with the identical roster, filters, and sorts.
    const disc = await discoverCards(query, user);
    return json(200, { creators: disc.creators, universities: disc.universities });
  }

  // ---------- deck state: Later piles + not-a-fit (Jeff, 2026-10-26) ----------
  // Per user, per deck: the Later pile (parked ids, in parked
  // order) and the hidden list (not a fit / not for me). The decks
  // read these to order and filter their queues; the records touch
  // nothing else (no offers, creators or bookings are mutated).
  if (seg[0] === "deck-state") {
    const normDeck = (d) => ({
      later: Array.isArray(d && d.later) ? d.later.filter((x) => typeof x === "string") : [],
      hidden: Array.isArray(d && d.hidden) ? d.hidden.filter((x) => typeof x === "string") : [],
      usedLater: !!(d && d.usedLater),
    });
    const loadDecks = async () => {
      const rec = (await store.get(`deckstate:${user.id}`)) || {};
      return { discover: normDeck(rec.discover), offers: normDeck(rec.offers) };
    };
    if (method === "GET") return json(200, { decks: await loadDecks() });
    if (method === "POST") {
      const b = parseBody(event);
      const deck = b.deck === "discover" || b.deck === "offers" ? b.deck : null;
      const action = ["later", "unlater", "hide", "unhide"].includes(b.action) ? b.action : null;
      const itemId = typeof b.itemId === "string" && b.itemId ? b.itemId : null;
      if (!deck || !action || !itemId) return err(400, "deck, action and itemId are required");
      const decks = await loadDecks();
      const d = decks[deck];
      if (action === "later") {
        if (!d.later.includes(itemId)) d.later.push(itemId);
        d.hidden = d.hidden.filter((x) => x !== itemId);
        d.usedLater = true;
      } else if (action === "unlater") {
        d.later = d.later.filter((x) => x !== itemId);
      } else if (action === "hide") {
        if (!d.hidden.includes(itemId)) d.hidden.push(itemId);
        d.later = d.later.filter((x) => x !== itemId);
      } else if (action === "unhide") {
        d.hidden = d.hidden.filter((x) => x !== itemId);
      }
      await store.set(`deckstate:${user.id}`, decks);
      return json(200, { decks });
    }
    return err(405, "Method not allowed");
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
        moment: validMoment(b.moment) || validMoment(user.business && user.business.moment),
        createdAt: ts,
        updatedAt: ts,
      };
      // Sig Operator (Jeff, 2026-10-28): rebook offers carry a
      // normalized brief and the asset-packet flag like every
      // created offer (comp defaults to not attached).
      offer.assetPacketAttached = b.assetPacketAttached !== undefined ? b.assetPacketAttached === true : false;
      offer.brief = normalizeBriefInput(b.brief, "comp", briefSeedFromFields(offer));
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
        if (!Number.isFinite(cashRate) || cashRate < PAID_LANE.minRate) return err(400, `A cash offer starts at $${fmtPriceS(PAID_LANE.minRate)}. Below that, the payment processing and support cost more than the booking is worth. Comp offers have no minimum beyond the dignity floor for the tiers you target.`);
        dollarCap = Math.round(cashRate);
        // Stripe Connect (2026-10-26): selecting a creator for a
        // paid offer charges the card on file, so the card comes
        // before the offer exists. Rail off: no gate, as before.
        if (connect.connectConfigured() && !businessCardOnFile(user)) {
          return err(400, "Add a card before posting a paid offer. When you pick a creator, the booking charges your card on file and SIGNL holds the money until the post is live. Add your card in the Plan tab, under Your plan.");
        }
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
          if (block) return err(400, `A $${fmtMoneyS(dollarCap)} comp is below the dignity floor for ${block.tier} (floor $${fmtPriceS(block.floor)}, typical $${fmtPriceS(COMP_GUIDANCE[block.tier].typicalLow)} to $${fmtPriceS(COMP_GUIDANCE[block.tier].typicalHigh)}). Raise the comp value to $${fmtPriceS(block.floor)} or more, or remove ${block.tier} from who can apply. Token comps burn the roster's trust, so SIGNL does not send them.`);
        }
        if (!targetCreator && !targetTiers && dollarCap < COMP_GUIDANCE.Neighbors.floor) {
          return err(400, `A comp offer starts at $${fmtPriceS(COMP_GUIDANCE.Neighbors.floor)} of value. Below that it is a token, and token comps burn the roster's trust. Raise the value, or send a direct offer to one creator instead.`);
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
        // Spanish content requirement (Jeff, 2026-10-28):
        // optional, defaults off, never required. Display and
        // Discover filtering only; it never blocks an application.
        requiresSpanish: b.requiresSpanish === true,
        cashRate,
        targetTiers,
        title: String(b.title).trim().slice(0, 140),
        whatComped: String(b.whatComped).trim(),
        includes: String(b.includes || b.whatComped).trim().slice(0, 600),
        experience: String(b.experience || "").trim().slice(0, 600),
        templateId: typeof b.templateId === "string" ? b.templateId.slice(0, 40) : null,
        // Packaged play (R1): template metadata only; the brief
        // object carries everything the play decided.
        play: typeof b.play === "string" ? b.play.slice(0, 40) : null,
        // Menu of Moments (Build -32): the moment this offer is
        // for, picked in the composer. Packaging only.
        moment: validMoment(b.moment),
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
      // Sig Operator (Jeff, 2026-10-28): EVERY created offer stores
      // a normalized brief (the request's brief when one is sent,
      // derived from the offer's own fields when absent) and the
      // asset-packet flag: paid offers carry the business's packet
      // by default, comp offers do not, and an explicit
      // assetPacketAttached in the request overrides either way.
      offer.assetPacketAttached = b.assetPacketAttached !== undefined ? b.assetPacketAttached === true : kind === "paid";
      offer.brief = normalizeBriefInput(b.brief, kind, briefSeedFromFields(offer));
      if (lane === "open") {
        const tl = offerTimeline({ applyWindowDays: b.applyWindowDays, windowDays: b.windowDays, windowStartAt: b.windowStartAt }, Date.parse(ts));
        Object.assign(offer, tl);
        if (wantsDraft) {
          // Drafts carry the timeline they WOULD publish with, so
          // the composer preview is honest before the market opens.
          offer.draftTimeline = true;
        }
      }
      // Offer dedupe (UX redesign section 5, 2026-10-24): an
      // identical OPEN offer from the same business is a twin, not
      // a new offer. Same lane, same kind, same normalized title,
      // same amount (dollarCap and the cashRate rate field), same
      // covers, same spots, same target creator (creatorId, null
      // for open offers), and the same apply/window days when
      // stored: refuse with 409 and the existing offer's id, so
      // the client can point at the one already open instead of
      // creating a duplicate. Drafts are exempt (a draft is not
      // open), and a closed or expired twin never blocks.
      if (offer.status === "open") {
        const normTitle = (t) => String(t || "").trim().replace(/\s+/g, " ").toLowerCase();
        const existing = (await allOffers()).find((x) => {
          if (x.businessId !== user.id || x.status !== "open") return false;
          if ((x.creatorId || null) !== (offer.creatorId || null)) return false;
          if (laneOf(x) !== laneOf(offer) || kindOf(x) !== kindOf(offer)) return false;
          if (normTitle(x.title) !== normTitle(offer.title)) return false;
          if (Number(x.dollarCap) !== Number(offer.dollarCap)) return false;
          if ((x.cashRate === null || x.cashRate === undefined ? null : Number(x.cashRate)) !== (offer.cashRate === null || offer.cashRate === undefined ? null : Number(offer.cashRate))) return false;
          if (coversOf(x) !== coversOf(offer)) return false;
          if (Number(x.spots) !== Number(offer.spots)) return false;
          if (x.applyWindowDays !== undefined && offer.applyWindowDays !== undefined && Number(x.applyWindowDays) !== Number(offer.applyWindowDays)) return false;
          if (x.windowDays !== undefined && offer.windowDays !== undefined && Number(x.windowDays) !== Number(offer.windowDays)) return false;
          return true;
        });
        if (existing) return json(409, { error: "This offer is already open", existingOfferId: existing.id });
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
        // Sig Operator (Jeff, 2026-10-28): every offer reads with
        // a brief (stored, or derived for legacy offers), and a
        // businessAssetPacket slot the role branches fill below.
        brief: briefForOffer(o),
        businessAssetPacket: null,
        bookedCount: bookings.filter((bk) => bk.offerId === o.id).length,
        filledCount: filledCountFor(o.id, bookings),
        applicationCount: apps.filter((a) => a.offerId === o.id && a.status !== "withdrawn").length,
        strength: offerStrength(o),
      }));
      if (user.role === "business") {
        out = out.filter((o) => o.businessId === user.id);
        // The business's own view of its offers carries its
        // referral program as active (it rides on every offer;
        // see referralProgramView). Their own record is in
        // hand, so no extra read is needed.
        const ownReferral = referralProgramView(user.business);
        if (ownReferral) out = out.map((o) => ({ ...o, businessReferralProgram: ownReferral }));
        // The business's own view also carries its own current
        // asset packet on every offer.
        const ownPacket = assetPacketView(user.business);
        out = out.map((o) => ({ ...o, businessAssetPacket: ownPacket }));
      }
      else if (user.role === "creator") {
        out = out.filter((o) => o.market === user.market && o.status === "open" && (!o.creatorId || o.creatorId === user.id));
        // Charter early access (Build -31): a fresh open offer is
        // simply not in a non-Charter creator's feed yet. No
        // marker, no "you missed out" copy: it appears at +24h.
        const feedMarketLive = await isMarketLive(user.market);
        out = out.filter((o) => offerVisibleToCreator(o, user, Date.now(), feedMarketLive));
        // The creator's checklist ("They can / They can't") depends on
        // the visit type (rights follow the visit, never the plan;
        // see visitRightsForVisit). Attach both per offer, plus the
        // business's public review-page links when it has set them
        // (the "Their review pages" courtesy block).
        const bizIds = [...new Set(out.map((o) => o.businessId))];
        const plans = {};
        const reviewLinks = {};
        const referralPrograms = {};
        const musicOpen = {};
        const studentOpen = {};
        const assetPackets = {};
        for (const id of bizIds) {
          const biz = await store.get(`user:${id}`);
          plans[id] = biz && biz.business ? biz.business.plan : null;
          reviewLinks[id] = biz && biz.business ? reviewLinksView(biz.business) : null;
          referralPrograms[id] = biz && biz.business ? referralProgramView(biz.business) : null;
          musicOpen[id] = biz && biz.business ? musicOpenView(biz.business) : null;
          studentOpen[id] = biz && biz.business ? studentOpenView(biz.business) : null;
          assetPackets[id] = biz && biz.business ? assetPacketView(biz.business) : null;
        }
        out = out.map((o) => ({ ...o, businessPlan: plans[o.businessId] || null, visitRights: visitRightsForVisit(kindOf(o)), businessReviewLinks: reviewLinks[o.businessId] || null, businessReferralProgram: referralPrograms[o.businessId] || null, businessMusicOpen: musicOpen[o.businessId] || null, businessStudentOpen: studentOpen[o.businessId] || null, businessAssetPacket: offerAssetPacketAttached(o) ? (assetPackets[o.businessId] || null) : null }));
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
      if (!(await isMarketLive(user.market))) return err(403, `Offers go live when your market opens. ${marketTalkName(user.market)} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}; your draft is saved and ready to publish that day.`);
      if (kindOf(offer) === "comp" && Array.isArray(offer.targetTiers) && offer.targetTiers.length) {
        const block = dignityBlock(offer.dollarCap, offer.targetTiers);
        if (block) return err(400, `A $${fmtMoneyS(offer.dollarCap)} comp is below the dignity floor for ${block.tier} (floor $${fmtPriceS(block.floor)}). Raise the comp value or remove ${block.tier} from who can apply before publishing.`);
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
          if (block) return err(400, `A $${fmtMoneyS(cap)} comp is below the dignity floor for ${block.tier} (floor $${fmtPriceS(block.floor)}). Raise the comp value to $${fmtPriceS(block.floor)} or more, or remove ${block.tier} from who can apply.`);
        } else if (laneOf(offer) === "open" && cap < COMP_GUIDANCE.Neighbors.floor) {
          return err(400, `A comp offer starts at $${fmtPriceS(COMP_GUIDANCE.Neighbors.floor)} of value.`);
        }
        changes.dollarCap = [offer.dollarCap, cap];
        offer.dollarCap = cap;
      }
      if (b.cashRate !== undefined && kindOf(offer) === "paid") {
        const rate = Math.round(Number(b.cashRate) * 100) / 100;
        if (!Number.isFinite(rate) || rate < PAID_LANE.minRate) return err(400, `A cash offer starts at $${fmtPriceS(PAID_LANE.minRate)}.`);
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
        if (block) return err(400, `A $${fmtMoneyS(offer.dollarCap)} comp is below the dignity floor for ${block.tier} (floor $${fmtPriceS(block.floor)}). Raise the comp value or remove ${block.tier} from who can apply.`);
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
      // Sig Operator (Jeff, 2026-10-28): a brief in the patch
      // replaces the stored brief, normalized with the offer's
      // own fields as the seed (empty hook / mustMention / timing
      // fall back to experience / includes / visitWindow, exactly
      // as at create time). The packet flag flips independently.
      // Note: this brief object is a different field from
      // paidBrief and IS allowed on comp offers.
      if (b.brief !== undefined) {
        changes.brief = [offer.brief || null, normalizeBriefInput(b.brief, kindOf(offer), briefSeedFromFields(offer))];
        offer.brief = changes.brief[1];
      }
      if (b.assetPacketAttached !== undefined) {
        changes.assetPacketAttached = [offerAssetPacketAttached(offer), b.assetPacketAttached === true];
        offer.assetPacketAttached = changes.assetPacketAttached[1];
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
      // Charter early access (Build -31): inside the window the
      // offer is not available to a non-Charter creator at all,
      // exactly as if it were not posted yet.
      if (!offerVisibleToCreator(offer, user, Date.now(), await isMarketLive(offer.market))) return err(404, "Offer not available");
      if (offer.status !== "open") return err(409, "This offer is not taking applications right now");
      if (offer.market !== user.market) return err(403, "This offer is in a different market");
      if (offer.applicationsCloseAt && Date.now() > Date.parse(offer.applicationsCloseAt)) return err(409, "Applications for this offer have closed");
      const tier = normalizeTierBand(user.creator ? user.creator.tierBand : "");
      if (Array.isArray(offer.targetTiers) && offer.targetTiers.length && !offer.targetTiers.includes(tier)) return err(403, `This offer is for ${offer.targetTiers.join(", ")} creators. Your tier is ${tier}.`);
      if (kindOf(offer) === "comp" && !(Array.isArray(offer.targetTiers) && offer.targetTiers.length) && Number(offer.dollarCap) < (COMP_GUIDANCE[tier] || {}).floor) return err(403, `This comp is below your tier's guidance floor ($${fmtPriceS((COMP_GUIDANCE[tier] || {}).floor)}), so it is not shown to ${tier}. That floor exists to protect the roster from token comps.`);
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
      if (existing.some((bk) => bk.creatorId === user.id)) return err(409, "You already booked this offer");
      if (existing.length >= offer.spots) return err(409, "All spots on this offer are booked");
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
      await notifyMilestone(offer.businessId, "booking_confirmed",
        `${user.name} (@${(user.creator && user.creator.handle) || "creator"}) accepted "${offer.title}". Visit code ${booking.code} is live: redeem it at the counter when they visit.`,
        `Booked: ${user.name} accepted your SIGNL offer`,
        [`Good news: ${user.name} (@${(user.creator && user.creator.handle) || "creator"}) accepted your offer "${offer.title}" and the visit is booked.`, "", `Their visit code is ${booking.code}. When they visit, redeem the code at the counter (the Counter tab, or staff mode with your PIN). Redemption starts their 48 hour post clock.`, "", "Open SIGNL: https://app.joinsignl.com", "", "SIGNL"].join("\n"),
        { bookingId: booking.id, offerId: offer.id });
      return json(201, { booking: await withPostState(booking) });
    }
    if (method === "POST" && seg.length === 3 && seg[2] === "decline") {
      if (user.role !== "creator") return err(403, "Creators only");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer) return err(404, "Offer not found");
      if (offer.creatorId !== user.id) return err(403, "Only the invited creator can decline this offer");
      // An accepted offer is a booked visit, not an invitation any
      // more: declining it would mark the offer declined while the
      // booking (and the business's expectation) stays live, and the
      // two records would disagree. Refuse and point at the visit.
      const declineBookings = await allBookings();
      if (declineBookings.some((bk) => bk.offerId === offer.id && bk.creatorId === user.id && bk.status !== "expired" && bk.status !== "cancelled")) {
        return err(409, "You already accepted this offer, so it cannot be declined. Your visit is in My Visits: message the business there if you cannot make it.");
      }
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
      // Charter early access (Build -31): the board hides a fresh
      // open offer from non-Charter creators for its first 24h.
      if (!offerVisibleToCreator(o, user, now, await isMarketLive(o.market))) continue;
      const mine = apps.filter((a) => a.offerId === o.id);
      const myApp = mine.find((a) => a.creatorId === user.id && a.status !== "withdrawn");
      const biz = await store.get(`user:${o.businessId}`);
      // Matching fit note (lib/fit.js): one short line, present
      // only when this offer is a genuinely strong match for the
      // viewing creator (category overlap or same city). It is an
      // explanation, never an eligibility change: the board's
      // filtering above is untouched.
      const fitBusiness = {
        category: o.category || "",
        market: o.market || "",
        city: biz ? (biz.city || "") : "",
        neighborhood: biz && biz.business ? (biz.business.neighborhood || "") : "",
      };
      const myFitInput = creatorFitInputOf(user);
      const fitNote = buildFitNote(computeFit(fitBusiness, myFitInput), fitBusiness, myFitInput);
      out.push({
        ...o,
        lane: "open",
        kind: kindOf(o),
        filledCount: filledCountFor(o.id, bookings),
        applicationCount: mine.filter((a) => ["applied", "selected", "backfill_offered", "backfill_accepted"].includes(a.status)).length,
        stackCap: Math.max(o.spots, o.spots * APPLICATION_STACK_PER_SPOT),
        myApplication: myApp ? { id: myApp.id, status: myApp.status } : null,
        strength: offerStrength(o),
        fitNote,
        businessPlan: biz && biz.business ? biz.business.plan : null,
        visitRights: visitRightsForVisit(kindOf(o)),
        businessReviewLinks: biz && biz.business ? reviewLinksView(biz.business) : null,
        businessReferralProgram: biz && biz.business ? referralProgramView(biz.business) : null,
        businessMusicOpen: biz && biz.business ? musicOpenView(biz.business) : null,
        businessStudentOpen: biz && biz.business ? studentOpenView(biz.business) : null,
        businessAbout: biz && biz.business ? (biz.business.about || "") : "",
        businessNeighborhood: biz && biz.business ? (biz.business.neighborhood || "") : "",
        paidMath: kindOf(o) === "paid" ? paidMath(Number(o.cashRate)) : null,
        // Sig Operator (Jeff, 2026-10-28): every board offer reads
        // with a brief, and the business's asset packet rides along
        // only when the offer carries it.
        brief: briefForOffer(o),
        businessAssetPacket: offerAssetPacketAttached(o) ? (biz && biz.business ? assetPacketView(biz.business) : null) : null,
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
      const all = rows.map((r) => r.value).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const notes = all.slice(0, 40);
      // Tab badges (UX redesign section 2, 2026-10-24): unread
      // counts by surface, computed over ALL of the user's unread
      // notifications (not just the 40 the list returns), grouped
      // by kind. Only kinds that exist in the code are mapped;
      // unmapped kinds count toward the total only. Messages count
      // the "message_received" notifications the message-send route
      // writes for the other participant (one live signal per
      // thread), so an unread thread badges Messages once.
      const BADGE_OFFER_KINDS = user.role === "business"
        ? ["application_received", "offer_declined", "creator_declined", "backfill_filled", "offer_deadline", "offer_nudge"]
        : ["offer_received", "backfill_offered", "application_selected", "application_received", "offer_declined", "creator_declined", "backfill_filled", "offer_deadline", "offer_nudge"];
      const BADGE_VISIT_KINDS = ["booking_confirmed", "clock_started", "proof_submitted", "post_verified", "rating_received", "performance_reported", "performance_updated", "register_tally", "paid_booking_received"];
      const BADGE_MESSAGE_KINDS = ["message_received"];
      const unread = all.filter((n) => !n.readAt);
      const countKinds = (kinds) => unread.filter((n) => kinds.includes(n.kind)).length;
      const badges = {
        offers: countKinds(BADGE_OFFER_KINDS),
        visits: countKinds(BADGE_VISIT_KINDS),
        messages: countKinds(BADGE_MESSAGE_KINDS),
        total: unread.length,
      };
      return json(200, { notifications: notes, unreadCount: unread.length, badges });
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

  // ---------- performance readout (Sig Operator, Jeff, 2026-10-28) ----------
  if (method === "GET" && seg[0] === "me" && seg[1] === "performance-readout") {
    if (user.role === "business") {
      // A founding business has no live numbers yet: it gets the
      // honest empty readout (200, the funnel line, no zero grid),
      // not the founding gate's refusal.
      if (isFoundingBusiness(user)) {
        return json(200, { role: "business", empty: true, founding: true, recommendation: { type: "next", text: "Your funnel fills in once your campaigns are live.", action: "create_offer" } });
      }
      return json(200, await businessPerformanceReadout(user));
    }
    if (user.role === "creator") {
      return json(200, await creatorPerformanceReadout(user));
    }
    return err(403, "The performance readout is for creators and businesses");
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
    // Stripe Connect (2026-10-26): while the rail is live, a paid
    // booking charges the business's card on file at booking, so
    // the card comes first. With the rail off this gate does not
    // exist and the recorded flow is exactly as before.
    if (connect.connectConfigured() && !businessCardOnFile(user)) {
      return err(400, "Add a card before booking paid visits. Paid bookings charge your card on file when you book, and SIGNL holds the money until the creator's post is live. Add your card in the Plan tab, under Your plan.");
    }
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
      // Sig Operator (Jeff, 2026-10-28): a direct paid booking's
      // brief derives from its paidBrief text (the hook is the
      // paidBrief), and the business's current asset packet is
      // snapshotted onto the booking (paid is attached by
      // default). The paidBrief field itself is unchanged.
      brief: normalizeBriefInput(b.brief, "paid", { hook: String(b.paidBrief || "").trim().slice(0, PAID_BRIEF_MAX) }),
      assetPacket: assetPacketView(user.business),
      paidLane: {
        rate: math.rate,
        businessTotal: math.businessTotal,
        creatorNet: math.creatorNet,
        platformFee: math.platformFee,
        licenseDays: LICENSE_WINDOW_DAYS,
        licenseNote: "Standard license included: repost + ad use for 90 days from the post date, never longer.",
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
    // Stripe Connect (2026-10-26): authorize the card on file for
    // the booking total, held on the platform side. A charge that
    // fails unwinds the booking entirely: no booking, no codes,
    // no charge, and the business hears why in plain words.
    const directFunds = await attachPaidFunds(booking, user);
    if (directFunds && directFunds.state === "charge_failed") {
      await store.del(`booking:${booking.id}`);
      await store.del(`code:${code}`);
      await store.del(`ccode:${creatorCode}`);
      return err(502, "Your card could not be charged, so the booking was not made. Check the card in the Plan tab and try again.");
    }
    if (directFunds) {
      booking.updatedAt = nowIso();
      await store.set(`booking:${booking.id}`, booking);
    }
    await logEvent({ type: "paid_booking_created", actorId: user.id, actorRole: "business", subjectId: booking.id, market: booking.market, data: { creatorId: creator.id, rate: math.rate, businessTotal: math.businessTotal, creatorNet: math.creatorNet, platformFee: math.platformFee, escrowState: "held", hasBrief: !!booking.paidBrief } });
    await notifyMilestone(creator.id, "paid_booking_received",
      `${booking.businessName || "A business"} booked you at your listed rate of $${fmtPriceS(math.rate)}. $${fmtMoneyS(math.creatorNet)} is recorded as held by SIGNL until your post is live. Visit code ${code}.`,
      `Paid booking: ${booking.businessName || "a business"} booked you at $${fmtPriceS(math.rate)}`,
      [`${booking.businessName || "A business"} booked you at your listed rate of $${fmtPriceS(math.rate)}.`, "", `${booking.paidLane.paymentNote} Your share is $${fmtMoneyS(math.creatorNet)} of the $${fmtPriceS(math.rate)} rate.`, "", `Your visit code is ${code}: show it at the counter when you visit. The visit window is 7 days from booking.`, "", "Open SIGNL: https://app.joinsignl.com", "", "Jeff", "Founder, SIGNL"].join("\n"),
      { bookingId: booking.id });
    await promptCreatorPayoutSetup(booking, creator);
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
    await notifyMilestone(booking.creatorId, "clock_started",
      `Your visit to ${booking.businessName || "the business"} is redeemed and your 48 hour post clock is running. Post by ${milestoneDeadlineText(booking.postDeadline)}, then paste the Instagram link in the app. A post inside the week still counts, as a late delivery.`,
      `Your 48 hour post clock started: ${booking.businessName || "your SIGNL visit"}`,
      [`Your visit to ${booking.businessName || "the business"} was just confirmed, so your post clock is running.`, "", `Post within 48 hours, by ${milestoneDeadlineText(booking.postDeadline)}, then paste the full Instagram post or reel link in the app as your proof. On time is what keeps your Momentum climbing, and a post inside the week still counts, as a late delivery.`, "", "Open SIGNL: https://app.joinsignl.com", "", "Jeff", "Founder, SIGNL"].join("\n"),
      { bookingId: booking.id });
    return json(200, { booking: await withPostState(booking) });
  }

  if (seg[0] === "bookings" && seg.length === 3 && seg[2] === "replacement" && method === "POST") {
    if (user.role !== "business") return err(403, "Businesses only");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.businessId !== user.id) return err(404, "Booking not found");
    const state = await withPostState(booking);
    // The Visit Guarantee trigger is the week, not the 48 hours
    // (Jeff's reframe, 2026-10-26): 48 hours is the standard a post
    // is due by, and a post inside the week still counts as a late
    // delivery. A replacement opens only once the hard stop (one
    // week after redemption) passes with no post.
    const pastHardStop = !!booking.redeemedAt && Date.now() >= Date.parse(pauseAtFor(booking));
    if (state.postState !== "overdue" || !pastHardStop) return err(409, "Replacements open when a full week passes with no post. Creators have up to a week; 48 hours is the standard they are held to.");
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
    await notifyMilestone(booking.businessId, "proof_submitted",
      `${user.name} posted for "${booking.title}"${post.onTime ? " (on time)" : " (late)"}. Open the link, confirm it is live under Posts, then report register tallies as they come in.`,
      `${user.name} posted for your SIGNL visit`,
      [`${user.name} just submitted their post for "${booking.title}"${post.onTime ? ", on time" : ", late"}.`, "", `Post: ${url}`, "", "Open it, confirm it is live in the app under Posts, and report register tallies as customers use the creator's code: the tally is what builds your SIGNL ROAS Score.", "", "Open SIGNL: https://app.joinsignl.com", "", "SIGNL"].join("\n"),
      { bookingId: booking.id, postId: post.id });
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
    if (booking) {
      await notifyMilestone(post.creatorId, "post_verified",
        `${booking.businessName || "The business"} confirmed your post is live. This visit is complete.`,
        `Visit complete: ${booking.businessName || "the business"} confirmed your post`,
        [`${booking.businessName || "The business"} confirmed your post is live, so this visit is complete.`, "", "When the business rates the visit and your post numbers come in, they land on the same booking in the app.", "", "Open SIGNL: https://app.joinsignl.com", "", "Jeff", "Founder, SIGNL"].join("\n"),
        { bookingId: booking.id, postId: post.id });
    }
    return json(200, { post });
  }

  // ---------- post licensing (Jeff, 2026-10-26) ----------
  // A business licenses a delivered COMPED post for the one
  // standard license (90 days of repost + paid ad use) at the
  // creator's listed licensing fee. The creator approves or
  // declines each request; nothing is licensed without her yes.
  // Money follows the paid lane exactly: paidMath splits the fee
  // (business pays fee + 3%, the creator keeps 97%), the amount is
  // recorded as held at request and released at grant (the right
  // is the delivery), refunded on a decline. Founding-billing
  // honesty applies throughout: recorded, no card charged, and
  // while the Stripe rail is live a license would charge the
  // business's card on file the same way a paid booking does.
  // Available on every plan; there is no plan gate on licensing.
  if (seg[0] === "posts" && seg.length === 3 && seg[2] === "license-request" && method === "POST") {
    if (user.role !== "business") return err(403, "Businesses only");
    const post = await store.get(`post:${seg[1]}`);
    if (!post || post.businessId !== user.id) return err(404, "Post not found");
    const booking = await store.get(`booking:${post.bookingId}`);
    if (!booking) return err(404, "That visit is not on record");
    if (booking.kind === "paid") return err(400, "This post came from a paid visit, which already includes the standard 90-day license. There is nothing more to license.");
    if (post.license && post.license.status === "granted" && Date.parse(post.license.windowEndsAt) > Date.now()) {
      return err(409, `This post is already licensed until ${String(post.license.windowEndsAt).slice(0, 10)}.`);
    }
    const existing = (await store.list("license:")).map((r) => r.value).filter((l) => l.postId === post.id && l.status === "pending");
    if (existing.length) return err(409, "A license request on this post is already waiting on the creator.");
    // Same rail rule as a paid booking: while Stripe Connect is
    // live, a granted license charges the card on file, so the
    // card comes first. Inert while the rail is off.
    if (connect.connectConfigured() && !businessCardOnFile(user)) {
      return err(400, "Add a card before licensing posts. Licenses charge your card on file when the creator approves, and SIGNL holds the payment until then. Add your card in the Plan tab, under Your plan.");
    }
    const creator = await store.get(`user:${post.creatorId}`);
    const fee = creator && creator.creator ? Number(creator.creator.licensingFee) : NaN;
    if (!creator || creator.role !== "creator" || !Number.isFinite(fee) || fee < 1) {
      return err(400, "This creator has not listed a licensing fee, so this post cannot be licensed. Comp visits still cover native sharing: you can share the post on your own channels with the creator tagged.");
    }
    const math = paidMath(fee);
    const ts = nowIso();
    const rec = {
      id: crypto.randomUUID(),
      postId: post.id,
      bookingId: post.bookingId,
      businessId: user.id,
      businessName: (user.business && user.business.businessName) || post.businessName || "",
      creatorId: post.creatorId,
      creatorHandle: creator.creator ? creator.creator.handle : "",
      fee: math.rate,
      businessTotal: math.businessTotal,
      creatorNet: math.creatorNet,
      platformFee: math.platformFee,
      licenseDays: LICENSE_WINDOW_DAYS,
      status: "pending",
      escrowState: "held",
      paymentNote: "License recorded, no card charged. SIGNL holds the payment until the creator decides.",
      createdAt: ts,
      respondedAt: null,
      windowEndsAt: null,
    };
    await store.set(`license:${rec.id}`, rec);
    await logEvent({ type: "license_requested", actorId: user.id, actorRole: "business", subjectId: rec.id, market: booking.market || user.market, data: { postId: post.id, bookingId: post.bookingId, creatorId: post.creatorId, fee: rec.fee, businessTotal: rec.businessTotal, creatorNet: rec.creatorNet } });
    try {
      const threadId = [user.id, post.creatorId].sort().join("__");
      const msg = {
        id: crypto.randomUUID(),
        threadId,
        fromId: user.id,
        toId: post.creatorId,
        body: `${rec.businessName || "A business"} wants to license your post from your comp visit for 90 days of reposting and ad use, at your $${fmtPriceS(rec.fee)} licensing fee. You would keep $${fmtMoneyS(rec.creatorNet)}. Nothing is licensed unless you approve it: decide on the post in your visits. Your post: ${post.url}`,
        createdAt: ts,
      };
      await store.set(`message:${msg.id}`, msg);
      await logEvent({ type: "message_sent", actorId: user.id, actorRole: "business", subjectId: msg.id, market: user.market, data: { toId: post.creatorId, toRole: "creator", threadId, bodyLength: msg.body.length, system: "license_request" } });
    } catch (e) { /* the request stands even if the note fails */ }
    return json(201, { licenseRequest: rec });
  }

  if (seg[0] === "license-requests" && seg.length === 1 && method === "GET") {
    let rows = (await store.list("license:")).map((r) => r.value);
    if (user.role === "creator") rows = rows.filter((l) => l.creatorId === user.id);
    else if (user.role === "business") rows = rows.filter((l) => l.businessId === user.id);
    else return err(403, "Creators and businesses only");
    const out = [];
    for (const l of rows) {
      const post = await store.get(`post:${l.postId}`);
      out.push({ ...l, postUrl: post ? post.url : null });
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return json(200, { licenseRequests: out });
  }

  if (seg[0] === "license-requests" && seg.length === 3 && seg[2] === "respond" && method === "POST") {
    if (user.role !== "creator") return err(403, "Creators only");
    const rec = await store.get(`license:${seg[1]}`);
    if (!rec || rec.creatorId !== user.id) return err(404, "License request not found");
    if (rec.status !== "pending") return err(409, "This request was already decided.");
    const b = parseBody(event);
    const decision = b.decision === "approve" ? "approve" : b.decision === "decline" ? "decline" : null;
    if (!decision) return err(400, "Say approve or decline.");
    const ts = nowIso();
    rec.respondedAt = ts;
    const post = await store.get(`post:${rec.postId}`);
    const biz = await store.get(`user:${rec.businessId}`);
    const bizName = rec.businessName || (biz && biz.business ? biz.business.businessName : "") || "The business";
    if (decision === "approve") {
      rec.status = "granted";
      rec.escrowState = "released";
      rec.windowEndsAt = licenseWindowEnd(Date.now()).toISOString();
      await store.set(`license:${rec.id}`, rec);
      if (post) {
        post.license = { requestId: rec.id, fee: rec.fee, grantedAt: ts, windowEndsAt: rec.windowEndsAt, status: "granted" };
        await store.set(`post:${post.id}`, post);
      }
      await logEvent({ type: "license_granted", actorId: user.id, actorRole: "creator", subjectId: rec.id, market: user.market, data: { postId: rec.postId, bookingId: rec.bookingId, businessId: rec.businessId, fee: rec.fee, creatorNet: rec.creatorNet, windowEndsAt: rec.windowEndsAt } });
      try {
        const threadId = [rec.businessId, user.id].sort().join("__");
        const msg = {
          id: crypto.randomUUID(),
          threadId,
          fromId: user.id,
          toId: rec.businessId,
          body: `Good news: your license on this post is granted. You can repost it and run it as an ad for 90 days, through ${rec.windowEndsAt.slice(0, 10)}. Declare the ad use on the post when you run it so the creator's record shows it. The post: ${post ? post.url : ""}`,
          createdAt: ts,
        };
        await store.set(`message:${msg.id}`, msg);
        await logEvent({ type: "message_sent", actorId: user.id, actorRole: "creator", subjectId: msg.id, market: user.market, data: { toId: rec.businessId, toRole: "business", threadId, bodyLength: msg.body.length, system: "license_granted" } });
      } catch (e) { /* the grant stands even if the note fails */ }
      return json(200, { licenseRequest: rec, post });
    }
    rec.status = "declined";
    rec.escrowState = "refunded";
    await store.set(`license:${rec.id}`, rec);
    await logEvent({ type: "license_declined", actorId: user.id, actorRole: "creator", subjectId: rec.id, market: user.market, data: { postId: rec.postId, bookingId: rec.bookingId, businessId: rec.businessId, fee: rec.fee } });
    try {
      const threadId = [rec.businessId, user.id].sort().join("__");
      const msg = {
        id: crypto.randomUUID(),
        threadId,
        fromId: user.id,
        toId: rec.businessId,
        body: `Heads up: the creator declined the license request on this post, so it stays native sharing only: you can share it on your own channels with the creator tagged, with no ad use. Nothing was charged. The post: ${post ? post.url : ""}`,
        createdAt: ts,
      };
      await store.set(`message:${msg.id}`, msg);
      await logEvent({ type: "message_sent", actorId: user.id, actorRole: "creator", subjectId: msg.id, market: user.market, data: { toId: rec.businessId, toRole: "business", threadId, bodyLength: msg.body.length, system: "license_declined" } });
    } catch (e) { /* the decline stands even if the note fails */ }
    return json(200, { licenseRequest: rec });
  }

  // Ad use (Jeff, 2026-10-19; rights model adopted 2026-10-21;
  // license standardized 2026-10-26): a business declares it is
  // running a delivered post as an ad. The right attaches to the
  // LICENSE, never the plan: a paid visit's post carries the
  // standard 90-day license from the post date; a comp visit's post
  // carries it only when the creator granted a license request on
  // that post, and its 90 days run from the grant. Declaring logs
  // ad_use_declared, notifies the creator in-app (a message in
  // their thread), and awards the creator +25 Momentum, computed
  // from this stored declaration like every other point. One
  // declaration per post.
  if (seg[0] === "posts" && seg.length === 3 && seg[2] === "ad-use" && method === "POST") {
    if (user.role !== "business") return err(403, "Businesses only");
    const post = await store.get(`post:${seg[1]}`);
    if (!post || post.businessId !== user.id) return err(404, "Post not found");
    if (post.adUseDeclaredAt) return err(409, "This post is already declared for ad use");
    const booking = await store.get(`booking:${post.bookingId}`);
    const isPaidVisit = !!booking && booking.kind === "paid";
    const license = post.license && post.license.status === "granted" ? post.license : null;
    if (!isPaidVisit && !license) {
      return err(403, "Ad use comes with paid visits only, or with a license the creator grants on this post. This was a comp visit, which covers native sharing only; paid visits include the standard 90-day license.");
    }
    const windowEnd = isPaidVisit ? adUseWindowEnd(post) : new Date(license.windowEndsAt);
    if (Date.now() > windowEnd.getTime()) {
      return err(403, isPaidVisit
        ? `The 90-day ad window for this post closed on ${windowEnd.toISOString().slice(0, 10)}. Paid-visit ad rights run 90 days from the post date, never longer.`
        : `The 90-day license on this post closed on ${windowEnd.toISOString().slice(0, 10)}. A new license from the creator would reopen it.`);
    }
    const ts = nowIso();
    post.adUseDeclaredAt = ts;
    post.adUseDeclaredBy = user.id;
    post.adUseWindowEndsAt = windowEnd.toISOString();
    await store.set(`post:${post.id}`, post);
    const bizName = (user.business && user.business.businessName) || post.businessName || "A SIGNL business";
    await logEvent({ type: "ad_use_declared", actorId: user.id, actorRole: "business", subjectId: post.id, market: booking ? booking.market : user.market, data: { bookingId: post.bookingId, creatorId: post.creatorId, visitKind: isPaidVisit ? "paid" : "comp", basis: isPaidVisit ? "paid" : "license", url: post.url, windowEndsAt: post.adUseWindowEndsAt } });
    // In-app notification: a message in the existing thread, so the
    // creator sees it in Messages and on the visit card.
    try {
      const threadId = [user.id, post.creatorId].sort().join("__");
      const msg = {
        id: crypto.randomUUID(),
        threadId,
        fromId: user.id,
        toId: post.creatorId,
        body: isPaidVisit
          ? `Good news: ${bizName} is using your post from your paid visit in an ad. Paid visits include the standard license: repost and ad rights for 90 days from the post date, and this earned you +25 Momentum points. Your post: ${post.url}`
          : `Good news: ${bizName} is using your post in an ad under the 90-day license you granted on it, and this earned you +25 Momentum points. Your post: ${post.url}`,
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
    return json(200, { posts: posts.map((p) => postWithPerformance(p)) });
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
    await notifyMilestone(booking.creatorId, "rating_received",
      `${review.businessName} rated your visit ${stars} star${stars === 1 ? "" : "s"}${comment ? `: "${comment}"` : ""}.`,
      `${review.businessName} rated your visit ${stars} star${stars === 1 ? "" : "s"}`,
      [`${review.businessName} rated your visit to them ${stars} star${stars === 1 ? "" : "s"}.${comment ? ` Their note: "${comment}"` : ""}`, "", "Ratings count toward SIGNL Elite once you have five of them, and they show on your public profile once you have three.", "", "Open SIGNL: https://app.joinsignl.com", "", "Jeff", "Founder, SIGNL"].join("\n"),
      { bookingId: booking.id });
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

  // Post-performance report (Jeff, 2026-10-19 round 2; time series
  // since the UX redesign, 2026-10-24): the creator adds the post's
  // numbers after the day-7 email asks, and can UPDATE them as the
  // post keeps growing. Each report appends a snapshot to
  // post.snapshots[]: provided numbers override, unprovided ones
  // carry forward from the latest known set, and the flat
  // post.views/likes/comments/shares fields always mirror the
  // latest snapshot so every existing reader keeps working.
  // post.reportedAt is set by the FIRST report only; Momentum's +5
  // is computed from reportedAt, so it still lands exactly once.
  // Comments and shares joined the report with the SIGNL ROAS Score
  // (Jeff, 2026-10-19): they are two of the four numbers the media
  // side of the score prices. Creator-reported numbers are labeled
  // as such (source "creator_report") until the Meta sync provider
  // lands; nothing here is ever presented as synced.
  if (method === "POST" && seg[0] === "bookings" && seg.length === 3 && seg[2] === "performance") {
    if (user.role !== "creator") return err(403, "Creators report their own post numbers");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking || booking.creatorId !== user.id) return err(404, "Booking not found");
    const post = (await allPosts()).find((p) => p.bookingId === booking.id);
    if (!post) return err(400, "No post proof on this visit yet");
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
    const isFirstReport = !post.reportedAt;
    const carry = (provided, key) => (provided !== null ? provided : typeof post[key] === "number" && Number.isFinite(post[key]) ? post[key] : null);
    const snapshot = {
      at: nowIso(),
      views: carry(views, "views"),
      likes: carry(likes, "likes"),
      comments: carry(comments, "comments"),
      shares: carry(shares, "shares"),
      source: "creator_report",
    };
    if (!Array.isArray(post.snapshots)) post.snapshots = [];
    post.snapshots.push(snapshot);
    post.views = snapshot.views;
    post.likes = snapshot.likes;
    post.comments = snapshot.comments;
    post.shares = snapshot.shares;
    if (isFirstReport) post.reportedAt = snapshot.at;
    post.lastSnapshotAt = snapshot.at;
    await store.set(`post:${post.id}`, post);
    await logEvent({ type: isFirstReport ? "post_performance_reported" : "post_performance_updated", actorId: user.id, actorRole: "creator", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, views: post.views == null ? null : post.views, likes: post.likes == null ? null : post.likes, comments: post.comments == null ? null : post.comments, shares: post.shares == null ? null : post.shares, snapshots: post.snapshots.length } });
    if (isFirstReport) {
      await notifyMilestone(booking.businessId, "performance_reported",
        `${user.name} reported their post numbers for "${booking.title}" (${post.views == null ? "no views figure" : `${post.views} views`}). Your results on this booking are updated.`,
        `${user.name} reported post numbers for your visit`,
        [`${user.name} reported the numbers on their post for "${booking.title}": ${post.views == null ? "views not reported" : `${post.views} views`}, ${post.likes == null ? "likes not reported" : `${post.likes} likes`}, ${post.comments == null ? "comments not reported" : `${post.comments} comments`}, ${post.shares == null ? "shares not reported" : `${post.shares} shares`}.`, "", "They feed the media-value side of your SIGNL ROAS Score on this booking. The register side is still yours to report under Bookings.", "", "Open SIGNL: https://app.joinsignl.com", "", "SIGNL"].join("\n"),
        { bookingId: booking.id, postId: post.id });
    } else {
      // Later snapshot updates are quieter: an in-app note for the
      // business, no email. The first report already carried the
      // milestone fan-out.
      await notifyUser(booking.businessId, "performance_updated",
        `${user.name} updated their post numbers for "${booking.title}" (${post.views == null ? "no views figure" : `${post.views} views`} now). Your results on this booking are updated.`,
        { bookingId: booking.id, postId: post.id });
    }
    return json(200, { post: postWithPerformance(post) });
  }

  // Code-use logging (UX redesign section 4, 2026-10-24): the
  // business owner (or an admin) logs audience-code uses against a
  // booking in one tap, as they happen at the register. Body
  // { count } is optional (a whole number 1..500, default 1); one
  // codeuse record is stored per call and booking.codeUseCount
  // carries the running total the ROAS estimate reads. Creators
  // never log uses: they share the code, the business counts it.
  if (method === "POST" && seg[0] === "bookings" && seg.length === 3 && seg[2] === "code-uses") {
    if (user.role === "creator") return err(403, "Businesses log code uses; creators share the code");
    const booking = await store.get(`booking:${seg[1]}`);
    if (!booking) return err(404, "Booking not found");
    if (user.role === "business" && booking.businessId !== user.id) return err(404, "Booking not found");
    if (booking.status === "cancelled") return err(400, "This booking is cancelled, so its code is not in use");
    const b = parseBody(event);
    let count = 1;
    if (b.count !== undefined && b.count !== null && b.count !== "") {
      count = Number(b.count);
      if (!Number.isInteger(count) || count < 1 || count > 500) return err(400, "Code use count must be a whole number from 1 to 500");
    }
    await logCodeUse(booking, count, user.id, "owner", user.role);
    return json(200, { booking: await withPostState(booking) });
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
    if (user.id === booking.businessId) {
      await notifyMilestone(booking.creatorId, "register_tally",
        `${booking.businessName || "The business"} reports ${count} customer${count === 1 ? "" : "s"} used your code ${booking.creatorCode || ""} ($${fmtMoneyS(booking.redemptions.basketTotal)} rung up). That is tracked register spend from your post.`,
        `Your code drove $${fmtMoneyS(booking.redemptions.basketTotal)} at ${booking.businessName || "the register"}`,
        [`${booking.businessName || "The business"} just reported their register tally for your visit: ${count} customer${count === 1 ? "" : "s"} used your code ${booking.creatorCode || ""}, $${fmtMoneyS(booking.redemptions.basketTotal)} rung up in total.`, "", "That tracked register spend sits on your booking and your track record: it is the floor of what your post provably drove.", "", "Open SIGNL: https://app.joinsignl.com", "", "Jeff", "Founder, SIGNL"].join("\n"),
        { bookingId: booking.id });
    }
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
      // System records (the book-me thread opener line) render
      // inside a conversation but never form a thread of their
      // own in the list.
      const mine = rows.map((r) => r.value).filter((m) => !m.system && (m.fromId === user.id || m.toId === user.id));
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
      // Message badge signal (UX redesign section 2, 2026-10-24):
      // a stored message notifies the other participant, kind
      // "message_received" with the thread id, so the Messages tab
      // badge has something real to count. One live signal per
      // thread: while an unread one is already waiting, further
      // messages in the same thread do not stack more.
      const priorNotes = await store.list(`note:${other.id}:`);
      const alreadySignaled = priorNotes.some((r) => r.value && r.value.kind === "message_received" && !r.value.readAt && r.value.data && r.value.data.threadId === threadId);
      if (!alreadySignaled) {
        await notifyUser(other.id, "message_received", `${user.name} sent you a message.`, { threadId, messageId: msg.id, fromId: user.id });
      }
      await logEvent({ type: "message_sent", actorId: user.id, actorRole: user.role, subjectId: msg.id, market: user.market, data: { toId: other.id, toRole: other.role, threadId, bodyLength: body.length } });
      return json(201, { message: msg });
    }
  }

  return err(404, "Route not found");
}

// The email builders are exported alongside the router so the verify
// suites can assert on the exact copy a creator receives.
module.exports = { route, passwordResetEmail, approvalEmail, rejectionEmail, REJECTION_REASONS, signupConfirmationEmail, claimConfirmationEmail, profileCompletionReminderEmail, recruiterKitEmail, strikePauseEmail, createMomentum, runComplianceSweep, roasFor, performanceSummary, enrichRoasEstimateInputs, normalizeBriefInput, briefForOffer, validateAssetPacket, assetPacketView, postSeries, complianceReminderEmail, postPerformanceEmail, postPerformanceUpdateEmail, runOfferSweep, runCampaignSweep, runProfileCompletionReminderSweep, runProfileBackfill, profileCompleteOf, profileCompletionFor, PRIMARY_PLATFORMS, normalizePrimaryPlatform, primaryPlatformOf, primaryPlatformLabel, primaryPlatformUrl, primaryProfileOf, normalizeAudienceStack, audienceStackOf, audienceTotalOf, campaignEmail, crossoverEmail, campaignEmailFor, businessWaveEmail, businessSignupLink, DEFAULT_CAMPAIGN_ID, CROSSOVER_CAMPAIGN_ID, BUSINESS_CAMPAIGN_ID, HELLO_CAMPAIGN_ID, CAMPAIGN_MAILBOXES, campaignFromMailbox, teamMailDailyCap, STANDARD_VISIT, visitRightsForVisit, adUseWindowEnd, LICENSE_WINDOW_DAYS, RECRUITER_KIT_FLAG_KEY, COMP_GUIDANCE, offerTimeline, dignityBlock, offerStrength, CREATOR_FREE_LINE, PAID_BRIEF_GUIDANCE, PAID_BRIEF_MAX, VISIT_GUARANTEE_LINE, STRIKE_LIMIT, STRIKE_PROBATION_COUNT, PREVIEW_STAFF_DEMO, coversOf, coversText, noShowStrikesOf, strikeStatusLine, REFERRAL_MILESTONES, ELITE_RULE, UNIVERSITY_OPTIONS, normalizeUniversity, universityOfRecord, sameUniversity, campusBadgeText, UNIVERSITY_STATUSES, UNIVERSITY_STATUS_LABELS, normalizeUniversityStatus, universityStatusOfRecord, universityStatusLabel, campusBadgeFor, universityKey, resolveUniversity, collegesData, cleanProfession, cleanFarmAreas, creatorIsRealtor, validateReferralProgram, referralProgramOf, referralProgramView, musicOpenView, studentOpenView };
