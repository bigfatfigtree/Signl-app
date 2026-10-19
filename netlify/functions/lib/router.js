// SIGNL API router. One Netlify Function (api.js) delegates here.
// All routes are under /api/*. Every state change writes an event via
// lib/events.js and stamps updatedAt on the record it touches.
const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { logEvent, listEvents } = require("./events");
const { MARKETS, TIERS, CREATOR_CATEGORIES, COMP_CATEGORIES, BUSINESS_CATEGORIES, PLANS, tierForFollowers } = require("./markets");
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
// Creators tier (15k+) only: on top of comps, these creators can also be
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
// creator's content. Paid hero campaigns are a separate product
// (bespoke paid creator work at a 20% platform fee) and have nothing
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

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, passwordSalt, ...rest } = u;
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
    sorted.filter((u) => u.status === "approved").forEach((u, i) => approvedRank.set(u.id, i + 1));
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
  reviewHigh: 10,
  streakBonus: 25,
  streakEvery: 5,
  adUse: 25,
  performanceReport: 5,
  latePenalty: -10,
  noShowPenalty: -25,
  neverPostedPenalty: -50,
};

function referralCounts(users) {
  const counts = new Map(); // lowercased handle -> { signups, approved, signupsList }
  for (const u of users) {
    if (!u.referredBy) continue;
    const key = String(u.referredBy).trim().toLowerCase();
    if (!key) continue;
    const rec = counts.get(key) || { signups: 0, approved: 0, list: [] };
    rec.signups += 1;
    rec.list.push(u);
    if (u.role === "creator" && u.status === "approved") rec.approved += 1;
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
  const referrals = referralCounts(users);
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

  function detailFor(user) {
    const empty = { signups: 0, approved: 0, points: 0, ledger: [], checklist: [], floorApplied: false };
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
      if (s.role === "creator" && s.status === "approved") {
        push("referral_approved", `A creator you recruited was approved (@${(s.creator && s.creator.handle) || "creator"})`, MOMENTUM_POINTS.referralApproved, s.reviewedAt || s.createdAt);
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
    for (const r of reviewsByCreator.get(user.id) || []) {
      if (Number(r.stars) >= 4) {
        push("review_high", `${r.stars}-star business review received`, MOMENTUM_POINTS.reviewHigh, r.createdAt);
      }
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
      { id: "reviews", label: "Earn a 4-5 star business review (+10 each)", points: MOMENTUM_POINTS.reviewHigh, done: (reviewsByCreator.get(user.id) || []).some((r) => Number(r.stars) >= 4) },
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
    };
  }

  function summaryFor(user) {
    const d = detailFor(user);
    return { signups: d.signups, approved: d.approved, points: d.points };
  }

  return { detailFor, summaryFor };
}

// Loads the full dataset once and returns a Momentum calculator.
// Every Momentum read in a request goes through one of these so the
// numbers can never disagree between surfaces.
async function momentumContext() {
  const [users, bookings, posts, reviews] = await Promise.all([allUsers(), allBookings(), allPosts(), allReviews()]);
  return { users, momentum: createMomentum({ users, bookings, posts, reviews }) };
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
    foundingCreatorsInMarket: inMarket.filter((u) => u.status === "approved").length,
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
    // Momentum rides on the creator's own profile payload in full
    // detail (total, ledger, ways-to-earn checklist) so the dashboard
    // can run the profile-completion incentive loop.
    const { momentum } = await momentumContext();
    pub.momentum = momentum.detailFor(user);
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
  if (!user || !user.creator || user.creator.tierBand !== "Creators") return null;
  return "One more thing, because you are in the Creators tier (15k+ followers): you are also eligible for paid campaigns, where a business pays you cash on top of the comped experience. Creators tier members are first in line for paid campaigns when they open in your market.";
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
    ];
    if (band) lines.push(`You are in the first ${band} creators to sign up in ${user.city}. That founding standing never expires.`);
    lines.push(
      "",
      `SIGNL has not opened in ${place} yet, and your sign-up is how that changes: we open new markets where creator sign-ups pile up. When ${user.city} opens, founding sign-ups there are first in line, and we email you the moment it happens.`,
      "",
      "The deal, as agreed: businesses comp you a meal or service, you post your honest experience within 48 hours, and you disclose the comp in the post. Nobody can ever ask you for a positive post.",
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
  ];
  if (band) lines.push(`You are in the first ${band} creators to sign up in ${user.market}. That founding standing never expires.`);
  lines.push(
    "",
    `What happens next: when you are approved, we email you again and your founding status page opens at app.joinsignl.com. ${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}, and founding creators get first pick of offers when it does.`,
    "",
    "The deal, as agreed: businesses comp you a meal or service, you post your honest experience within 48 hours, and you disclose the comp in the post. Nobody can ever ask you for a positive post.",
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

function approvalEmail(user, band) {
  const first = greetingName(user);
  const paidLine = paidCampaignLine(user);
  // Referral ask lands at approval, when the creator is in (Jeff,
  // 2026-10-18): rosterBenefitsLines carries their personal invite
  // link, the credited roster, the Momentum points, and the
  // visibility benefit.
  if (user.market === UNLISTED) {
    const subject = `You are approved: founding creator for ${user.city}`;
    const lines = [
      `Hi ${first},`,
      "",
      `Good news: your application was reviewed and approved. You are a Founding Creator for ${user.city}, and your founding status page is live.`,
    ];
    if (band) lines.push(`You are in the first ${band} to sign up in ${user.city}. When ${user.city} opens, founding sign-ups are first in line for offers.`);
    lines.push(
      "",
      "Sign in to see your status and keep your profile current: https://app.joinsignl.com",
      "",
      `${user.city} is not an open market yet. We open new markets where creator sign-ups pile up, and the moment ${user.city} opens, we email you again.`,
      "",
      ...rosterBenefitsLines(user, user.city),
      ...(paidLine ? [paidLine, ""] : []),
      "National platforms sell reach. We sell regulars.",
      "The SIGNL team",
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
  if (band) lines.push(`You are in the first ${band} founding creators in ${user.market}. Founding creators are shown to businesses in sign-up order, earliest first.`);
  lines.push(
    "",
    "Sign in to see your status and keep your profile current: https://app.joinsignl.com",
    "",
    `${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}. The moment it opens, we email you again, and founding creators get first pick of every offer. Your local audience percentage is the number businesses look at first, so keep it honest and current.`,
    "",
    ...rosterBenefitsLines(user, user.market),
    ...(paidLine ? [paidLine, ""] : []),
    "National platforms sell reach. We sell regulars.",
    "The SIGNL team",
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
  const recipients = users.filter((u) => u.role === "creator" && u.status === "approved");
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
  let creators = users.filter((u) => u.role === "creator" && u.status === "approved" && standingState(u) !== "banned");
  const market = query.market || (viewer && viewer.role === "business" ? viewer.market : null);
  if (market) creators = creators.filter((u) => u.market === (marketByName(market) || {}).name);
  if (query.tier) creators = creators.filter((u) => u.creator && u.creator.tierBand === query.tier);
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
    creators = creators.filter((u) => u.creator && u.creator.openToPaidCampaigns === true);
  }
  if (query.q) {
    const q = query.q.toLowerCase();
    creators = creators.filter((u) => u.name.toLowerCase().includes(q) || (u.creator && u.creator.handle.toLowerCase().includes(q)));
  }
  const { approvedRank } = creatorRanks(users);
  const [bookings, posts, reviews] = await Promise.all([allBookings(), allPosts(), allReviews()]);
  const momentum = createMomentum({ users, bookings, posts, reviews });
  const bookedUp = await bookedUpCreatorIds(users, bookings);
  const out = [];
  for (const c of creators) {
    const card = await publicCreator(c, viewer, approvedRank.get(c.id) || null);
    // Roster standing rides on the card: it is part of the order
    // businesses were promised creators would be seen in.
    card.momentum = momentum.summaryFor(c);
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
    createdAt: u.createdAt,
    foundingBand: foundingPriority === undefined ? null : foundingBand(foundingPriority),
    photoUrl: u.creator && u.creator.hasPhoto ? `/api/users/${u.id}/photo` : null,
    profile: u.creator,
    totalAudience: audienceTotalOf(u.creator || {}),
    audienceStack: audienceView(u.creator || {}).platforms,
    visitIncludes: STANDARD_VISIT.summary,
    bestWork: bestWorkCards(u.creator || {}),
    trackRecord,
    reviewSummary: reviewSummaryOf(reviewList),
    reviews: reviewList.slice(0, 10),
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
  const unlisted = u.market === UNLISTED;
  const audience = audienceView(c);
  return {
    name: u.name,
    handle: c.handle,
    instagramUrl: c.instagramUrl || `https://instagram.com/${c.handle}`,
    photoUrl: c.hasPhoto ? `/api/users/${u.id}/photo` : null,
    market: unlisted ? u.city || "" : u.market,
    unlisted,
    city: u.city || "",
    neighborhood: c.neighborhood || "",
    tierBand: c.tierBand || null,
    followerCount: c.followerCount || 0,
    totalAudience: audience.total,
    audienceStack: audience.platforms,
    categories: c.categories || [],
    compCategories: (c.compCategories || []).filter((x) => x !== PAID_COMP),
    localAudiencePct: c.localAudiencePct === undefined ? null : c.localAudiencePct,
    localAudienceSource: c.localAudienceSource || "Self-reported",
    localImpactScore: impact ? impact.score : null,
    momentumPoints: momentum.summaryFor(u).points,
    foundingBand: foundingBand(approvedRank.get(u.id) || null),
    bestWork: bestWorkCards(c),
    trackRecord,
    reviewSummary: reviewSummaryOf(reviewList),
    reviews: reviewList.slice(0, 10),
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
  return { ...booking, post, postState: postState(booking, post), compliance: complianceStatusFor(booking, post, creatorStanding) };
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

// The sweep: one pass over every redeemed-but-unposted booking,
// driving reminders, the day-8 pause, and the day-9 ban. Idempotent:
// every step stamps the booking or the user record before it acts, so
// a re-run never double-sends or double-punishes. Called by the
// Netlify scheduled function (netlify/functions/compliance-sweep.mjs),
// by the admin endpoint, and opportunistically (throttled) from the
// request path. Returns a summary of what it did.
async function runComplianceSweep() {
  const summary = { checked: 0, reminder1: 0, reminder2: 0, reminder3: 0, lateMarked: 0, paused: 0, banned: 0, performance: 0, expired: 0 };
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
  return summary;
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
//     already skip-filtered by whoever prepares the import.
//   - Sending happens only in runCampaignSweep(): the campaign must
//     be ARMED (Jeff arms it in the admin UI) and the clock must be
//     inside the send window, 08:00-21:00 America/New_York.
//   - Batches are small (8), total sends per campaign are capped at
//     80 in code, and more than 2 send failures in one run stop the
//     run and set campaign.lastError. An emptied queue auto-disarms.
//   - "bounced" exists as a recipient status for the day bounce
//     handling is automated; v1 never sets it (SMTP send results
//     cannot see bounces), so counts report it honestly as 0.
const DEFAULT_CAMPAIGN_ID = "founding-creators-2026-10";
const CAMPAIGN_BATCH_SIZE = 8;
const CAMPAIGN_SEND_CAP = 80;
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

// The Jeff-approved outreach email (2026-10-19), rendered server
// side from the recipient's slots. Plain text, first name only,
// no em dashes. The market paragraph differs for Hampton Roads
// (the November / Black Friday launch market) vs everywhere else.
function campaignEmail(recipient) {
  const market = String(recipient.market || "");
  const subject = `A founding creator spot in ${market}`;
  const marketParagraph = market === "Hampton Roads"
    ? "Hampton Roads launches in November, and our opening push is Black Friday weekend. Founding creators are joining now, in sign-up order, and the first ones in get seen first when businesses start choosing."
    : `${market} is a founding market: sign-ups are open now and offers open city by city as the roster fills, in the next 30 to 90 days. Founding creators join in sign-up order, and the first ones in get seen first when businesses start choosing.`;
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
    `app.joinsignl.com/?handle=${encodeURIComponent(String(recipient.handle || "").replace(/^@/, ""))}&market=${encodeURIComponent(market)}`,
    "",
    "Two minutes, and no fees for creators, ever. If it's not for you, you won't hear from me again.",
    "",
    "Jeff",
    "Founder, SIGNL",
    "hello@joinsignl.com | joinsignl.com",
    "National platforms sell reach. We sell regulars.",
  ];
  return { subject, text: lines.join("\n") };
}

function campaignWindowOpen(date) {
  const hourRaw = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: CAMPAIGN_WINDOW.timeZone }).format(date);
  const hour = ((parseInt(hourRaw, 10) % 24) + 24) % 24;
  return hour >= CAMPAIGN_WINDOW.startHour && hour < CAMPAIGN_WINDOW.endHour;
}

// One campaign sweep pass over every campaign config. Sends only
// for armed campaigns inside the window. Returns a summary; the
// scheduled function (netlify/functions/campaign-sweep.mjs) and the
// admin endpoint are the callers. `opts.now` exists for the verify
// suites (TEST_MODE only at the endpoint) so the window can be
// time-traveled deterministically.
async function runCampaignSweep(opts = {}) {
  const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
  const summary = { campaigns: 0, armed: 0, windowClosed: 0, attempted: 0, sent: 0, failed: 0, capReached: 0, disarmed: 0 };
  const configs = (await store.list("campaign:")).map((r) => r.value);
  for (const cfg of configs) {
    if (!cfg || !cfg.id) continue;
    summary.campaigns += 1;
    if (!cfg.armed) continue;
    summary.armed += 1;
    if (!campaignWindowOpen(now)) { summary.windowClosed += 1; continue; }
    const recipients = await listCampaignRecipients(cfg.id);
    let counts = campaignCounts(recipients);
    cfg.lastRunAt = now.toISOString();
    if (counts.sent >= CAMPAIGN_SEND_CAP) {
      cfg.armed = false;
      cfg.disarmedAt = now.toISOString();
      cfg.disarmReason = "send_cap_reached";
      await saveCampaignConfig(cfg);
      await logEvent({ type: "campaign_send_cap_reached", actorId: null, actorRole: "system", subjectId: null, market: null, data: { campaignId: cfg.id, totalSent: counts.sent, cap: CAMPAIGN_SEND_CAP } });
      summary.capReached += 1;
      summary.disarmed += 1;
      continue;
    }
    const batch = recipients
      .filter((r) => r.status === "queued")
      .slice(0, Math.min(CAMPAIGN_BATCH_SIZE, CAMPAIGN_SEND_CAP - counts.sent));
    let failures = 0;
    let lastReason = null;
    for (let i = 0; i < batch.length; i++) {
      if (failures > CAMPAIGN_MAX_FAILURES_PER_RUN) break;
      const recipient = batch[i];
      const mail = campaignEmail(recipient);
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
    } else if (cfg.armed && counts.sent >= CAMPAIGN_SEND_CAP) {
      cfg.armed = false;
      cfg.disarmedAt = now.toISOString();
      cfg.disarmReason = "send_cap_reached";
      await logEvent({ type: "campaign_send_cap_reached", actorId: null, actorRole: "system", subjectId: null, market: null, data: { campaignId: cfg.id, totalSent: counts.sent, cap: CAMPAIGN_SEND_CAP } });
      summary.capReached += 1;
      summary.disarmed += 1;
    }
    await saveCampaignConfig(cfg);
  }
  return summary;
}

function campaignView(cfg, counts) {
  return {
    id: cfg.id,
    armed: !!cfg.armed,
    armedAt: cfg.armedAt || null,
    disarmedAt: cfg.disarmedAt || null,
    disarmReason: cfg.disarmReason || null,
    lastError: cfg.lastError || null,
    lastRunAt: cfg.lastRunAt || null,
    totalSent: counts ? counts.sent : cfg.totalSent || 0,
    sendCap: CAMPAIGN_SEND_CAP,
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

// After a proof lands, a paused creator unpauses automatically UNLESS
// another redeemed visit is still sitting in its pause window. A ban
// is never lifted here: reinstatement is a human decision.
async function unpauseIfClear(creator, sourceBookingId) {
  if (standingState(creator) !== "paused") return false;
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
  // Launch shape: business accounts are closed. Founding businesses join
  // the list on joinsignl.com and lock in founding pricing; accounts open
  // when their market launches. (TEST_MODE re-opens this for the suites.)
  if (role === "business" && !TEST_MODE) {
    return err(403, "Business accounts are not open yet. Founding businesses join the founding business list at joinsignl.com/businesses.html to lock in founding pricing ($299/mo Self-Service, $599/mo Growth, $999/mo Managed). Business accounts open when your market launches.");
  }
  if (!isEmail(b.email || "")) return err(400, "A valid email is required");
  if (typeof b.password !== "string" || b.password.length < 10) return err(400, "Password must be at least 10 characters");
  if (!b.name || typeof b.name !== "string") return err(400, "Name is required");
  const unlisted = b.market === UNLISTED;
  if (unlisted && role !== "creator") return err(400, "Business accounts open when a market launches. Join the founding business list at joinsignl.com/businesses.html.");
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
    name: b.name.trim(),
    passwordSalt: salt,
    passwordHash: hash,
    status: "pending",
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

  if (role === "creator") {
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
        // Paid cash campaigns are a Creators-tier (15k+) option only.
        if (tier === "Creators" && Array.isArray(b.compCategories) && b.compCategories.includes(PAID_COMP) && !list.includes(PAID_COMP)) list.push(PAID_COMP);
        return list;
      })(),
      openToPaidCampaigns: tier === "Creators" && Array.isArray(b.compCategories) && b.compCategories.includes(PAID_COMP),
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
    const plan = planById(b.planId || "self-service") || PLANS[0];
    user.business = {
      businessName: String(b.businessName).trim(),
      category: BUSINESS_CATEGORIES.includes(b.category) ? b.category : "Other",
      plan: plan.id,
      planName: `${plan.name} $${plan.priceMonthly}/mo`,
      planPriceMonthly: plan.priceMonthly,
      planMinMonths: plan.minMonths,
      billingStatus: "Founding billing: plan recorded, no card charged. Billing starts at launch.",
      planSelectedAt: ts,
    };
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
        ? { handle: user.creator.handle, city: user.city, neighborhood: user.creator.neighborhood, state: user.state, country: user.country, unlisted: user.market === UNLISTED, followerCount: user.creator.followerCount, audienceStack: user.creator.audienceStack, totalAudience: user.creator.totalAudience, tierBand: user.creator.tierBand, suggestedTier: user.creator.suggestedTier, localAudiencePct: user.creator.localAudiencePct, localAudienceSource: user.creator.localAudienceSource, categories: user.creator.categories, compCategories: user.creator.compCategories, openToPaidCampaigns: user.creator.openToPaidCampaigns, agreedPostCompliance: true, termsVersion: TERMS_VERSION, marketingEmailConsent: true, ...(user.referredBy ? { referredBy: user.referredBy } : {}) }
        : { businessName: user.business.businessName, category: user.business.category, plan: user.business.plan, planPriceMonthly: user.business.planPriceMonthly, ...(user.referredBy ? { referredBy: user.referredBy } : {}) },
  });
  if (role === "creator") {
    // Registration IS the complete profile build at launch: the profile
    // fields are all collected up front, so this fires here. A photo can
    // still be added afterwards (profile_photo_uploaded).
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
        followerCount: user.creator.followerCount,
        audienceStack: user.creator.audienceStack,
        totalAudience: user.creator.totalAudience,
        avgViews: user.creator.avgViews,
        tierBand: user.creator.tierBand,
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
      const mail = signupConfirmationEmail(user, band);
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
  // Post-compliance sweep: drives the 48h reminders, the day-8 pause,
  // and the day-9 ban. Throttled to roughly hourly here (the Netlify
  // scheduled function and the admin endpoint are the explicit
  // triggers), and it must never break a request either.
  try { await maybeRunComplianceSweep(); } catch (e) { /* sweep is best-effort on the request path */ }
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
      plans: PLANS,
      paidCampaignsComp: PAID_COMP,
      unlistedMarket: UNLISTED,
      standardVisit: STANDARD_VISIT,
      audiencePlatforms: AUDIENCE_PLATFORMS,
      termsVersion: TERMS_VERSION,
      email: { enabled: emailEnabled() },
      launch: {
        creatorSignupOpen: true,
        businessSignupOpen: TEST_MODE,
        launchWindow: LAUNCH_WINDOW_TEXT,
        marketLive: await marketLiveMap(),
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
          .filter((u) => u.role === "creator" && u.status === "approved" && standingState(u) !== "banned" && u.creator && String(u.creator.handle || "").toLowerCase() === handleKey)
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
    // creator's photo locks down with their profile page.
    let allowed = target.status === "approved" && standingState(target) !== "banned";
    if (!allowed && user) {
      allowed =
        user.id === target.id ||
        user.role === "admin" ||
        (user.role === "business" && user.status === "approved" && (await isMarketLive(user.market)));
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

  if (!user) return err(401, "Sign in required");

  // ---------- profile ----------
  if (method === "PATCH" && seg[0] === "me" && seg[1] === "profile") {
    const b = parseBody(event);
    const ts = nowIso();
    if (user.role === "creator" && user.creator) {
      const c = { ...user.creator };
      const changes = {};
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
      if (Array.isArray(b.categories)) c.categories = b.categories.filter((x) => CREATOR_CATEGORIES.includes(x));
      if (Array.isArray(b.compCategories)) {
        // Paid cash campaigns stay selectable only while the creator is
        // in the Creators tier; dropping a tier drops the option.
        c.compCategories = b.compCategories.filter((x) => COMP_CATEGORIES.includes(x) || (x === PAID_COMP && c.tierBand === "Creators"));
        c.openToPaidCampaigns = c.compCategories.includes(PAID_COMP);
      }
      if (c.tierBand !== "Creators" && Array.isArray(c.compCategories) && c.compCategories.includes(PAID_COMP)) {
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
      if (b.localAudiencePct !== undefined) {
        const pct = b.localAudiencePct === null || b.localAudiencePct === "" ? null : Math.max(0, Math.min(100, Number(b.localAudiencePct)));
        changes.localAudiencePct = [c.localAudiencePct, pct];
        c.localAudiencePct = pct;
        c.localAudienceSource = pct === null ? null : "Self-reported";
        c.localAudienceAsOf = pct === null ? null : ts.slice(0, 10);
      }
      user.creator = c;
      user.updatedAt = ts;
      await store.set(`user:${user.id}`, user);
      await logEvent({ type: "profile_updated", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { changes } });
      if (changes.localAudiencePct) {
        await logEvent({ type: "local_audience_updated", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { from: changes.localAudiencePct[0], to: changes.localAudiencePct[1], source: "Self-reported" } });
      }
      return json(200, { user: await withFounding(user) });
    }
    if (user.role === "business" && user.business) {
      const bz = { ...user.business };
      if (b.businessName) bz.businessName = String(b.businessName).trim();
      if (b.category && BUSINESS_CATEGORIES.includes(b.category)) bz.category = b.category;
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
    };
    user.updatedAt = nowIso();
    await store.set(`user:${user.id}`, user);
    await logEvent({ type: "plan_selected", actorId: user.id, actorRole: "business", subjectId: user.id, market: user.market, data: { plan: plan.id, planPriceMonthly: plan.priceMonthly, source: "dashboard", billingStatus: user.business.billingStatus } });
    return json(200, { user: publicUser(user) });
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
    return json(200, { ok: true, sweep: summary });
  }
  if (seg[0] === "admin") {
    if (user.role !== "admin") return err(403, "Admin only");
    if (method === "GET" && seg[1] === "applications") {
      const all = await allUsers();
      const users = all.filter((u) => u.role !== "admin");
      const { approvedRank, pendingRank } = creatorRanks(all);
      const [allBk, allPo, allRv] = await Promise.all([allBookings(), allPosts(), allReviews()]);
      const momentum = createMomentum({ users: all, bookings: allBk, posts: allPo, reviews: allRv });
      const attach = (u) => {
        const pub = publicUser(u);
        if (u.role === "creator") {
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
      const [lbBk, lbPo, lbRv] = await Promise.all([allBookings(), allPosts(), allReviews()]);
      const momentum = createMomentum({ users: all, bookings: lbBk, posts: lbPo, reviews: lbRv });
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
          creatorsApproved: inMarket.filter((u) => u.role === "creator" && u.status === "approved").length,
          creatorsPending: inMarket.filter((u) => u.role === "creator" && u.status === "pending").length,
          businessesApproved: inMarket.filter((u) => u.role === "business" && u.status === "approved").length,
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
        if (u.role === "creator" && u.status === "approved") perMarket[u.market].creators += 1;
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
          approved: users.filter((u) => u.status === "approved").length,
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
      return json(200, { campaign: campaignView(cfg, counts), counts, recentSends });
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
      let imported = 0;
      let duplicates = 0;
      let skipped = 0;
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
        if (skipSet.has(email)) {
          await store.set(key, { campaignId, email, name, handle, market, opener, status: "skipped", skipReason: "blocklist", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
          skipped += 1;
          continue;
        }
        await store.set(key, { campaignId, email, name, handle, market, opener, status: "queued", sentAt: null, messageRef: null, importedAt: ts, updatedAt: ts });
        imported += 1;
      }
      const recipients = await listCampaignRecipients(campaignId);
      const counts = campaignCounts(recipients);
      await logEvent({ type: "campaign_recipients_imported", actorId: user.id, actorRole: "admin", subjectId: null, market: null, data: { campaignId, imported, duplicates, skipped, invalid: invalid.length } });
      return json(200, { campaignId, imported, duplicates, skipped, invalid, counts });
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
      return json(200, { campaign: campaignView(cfg, counts), counts });
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
      target.standing = { state: "good", reason: null, at: nowIso(), bookingId: null, reinstatedBy: user.id, previousState: previous };
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "account_reinstated", actorId: user.id, actorRole: "admin", subjectId: target.id, market: target.market, data: { previousState: previous, note: String(b.note || "").slice(0, 300) } });
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
        if (standingState(targetCreator) === "banned") return err(400, "That creator redeemed a comp and never posted, so they cannot be booked again.");
        if (standingState(targetCreator) === "paused") return err(400, "That creator is paused until a late post lands. Pick another creator for now.");
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
    return err(404, "Unknown admin route");
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
  // Discovery, offers, bookings, the counter, posts, and messages only
  // operate in markets an admin has activated. Until then, an approved
  // creator's world is their founding status page, and no business
  // account can exist in production at all.
  const MARKETPLACE_SECTIONS = ["discover", "favorites", "offers", "bookings", "counter", "posts", "messages"];
  if (user.role !== "admin" && MARKETPLACE_SECTIONS.includes(seg[0])) {
    if (!(await isMarketLive(user.market))) {
      return err(403, `The ${user.market} market has not launched yet. Founding creators keep priority in the order they signed up, and ${user.market} opens to businesses in the next ${LAUNCH_WINDOW_TEXT}.`);
    }
  }

  // ---------- discovery ----------
  // Business-facing creator search (spec: files/signl-business-search-
  // spec.md in the goal workspace). Every filter reads a field stored
  // on the creator record; nothing is computed from outside data.
  //   ?market=        market name (default: the business's own market)
  //   ?neighborhood=  case-insensitive text match on the creator's
  //                   neighborhood/area (also matches their city)
  //   ?tier=          tier band (Neighbors / Locals / Creators)
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
        if (c) out.push(await publicCreator(c, user));
      }
      return json(200, { favorites: out });
    }
    if (method === "POST") {
      const b = parseBody(event);
      const creator = await store.get(`user:${b.creatorId}`);
      if (!creator || creator.role !== "creator") return err(404, "Creator not found");
      const key = `favorite:${user.id}:${creator.id}`;
      const existing = await store.get(key);
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
    if (method === "POST" && seg.length === 1) {
      if (user.role !== "business") return err(403, "Businesses only");
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
        if (standingState(targetCreator) === "banned") return err(400, "That creator redeemed a comp and never posted, so they cannot be booked again.");
        if (standingState(targetCreator) === "paused") return err(400, "That creator is paused until a late post lands. Pick another creator for now.");
      }
      const ts = nowIso();
      const offer = {
        id: crypto.randomUUID(),
        businessId: user.id,
        businessName: user.business.businessName,
        market: user.market,
        category: user.business.category,
        creatorId: targetCreator ? targetCreator.id : null,
        creatorHandle: targetCreator && targetCreator.creator ? targetCreator.creator.handle : null,
        title: String(b.title).trim(),
        whatComped: String(b.whatComped).trim(),
        dollarCap,
        visitWindow: String(b.visitWindow || "").trim(),
        windowMode: b.windowMode === "thisweek" ? "thisweek" : "7days",
        spots,
        status: "open",
        createdAt: ts,
        updatedAt: ts,
      };
      await store.set(`offer:${offer.id}`, offer);
      await logEvent({ type: "offer_created", actorId: user.id, actorRole: "business", subjectId: offer.id, market: offer.market, data: { title: offer.title, dollarCap, spots, targeted: !!targetCreator, creatorId: offer.creatorId, category: offer.category, windowMode: offer.windowMode } });
      return json(201, { offer });
    }
    if (method === "GET" && seg.length === 1) {
      const offers = await allOffers();
      const bookings = await allBookings();
      let out = offers.map((o) => ({ ...o, bookedCount: bookings.filter((bk) => bk.offerId === o.id).length }));
      if (user.role === "business") out = out.filter((o) => o.businessId === user.id);
      else if (user.role === "creator") {
        out = out.filter((o) => o.market === user.market && o.status === "open" && (!o.creatorId || o.creatorId === user.id));
        // The creator's checklist ("They can / They can't") depends on
        // the business's plan (rights follow the plan; see
        // visitRightsForPlan). Attach both per offer.
        const bizIds = [...new Set(out.map((o) => o.businessId))];
        const plans = {};
        for (const id of bizIds) {
          const biz = await store.get(`user:${id}`);
          plans[id] = biz && biz.business ? biz.business.plan : null;
        }
        out = out.map((o) => ({ ...o, businessPlan: plans[o.businessId] || null, visitRights: visitRightsForPlan(plans[o.businessId] || null) }));
      }
      out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return json(200, { offers: out });
    }
    if (method === "POST" && seg.length === 3 && seg[2] === "accept") {
      if (user.role !== "creator") return err(403, "Creators only");
      // Compliance standing gates new bookings: a paused creator
      // delivers the missing post first; a banned creator is done.
      if (standingState(user) === "banned") return err(403, "Your account was closed to offers after a comped visit was redeemed and no post was delivered. Contact hello@joinsignl.com if you believe this is wrong.");
      if (standingState(user) === "paused") return err(403, "Your account is paused until the late post from your last visit is checked off. Paste the post link under My Visits and new offers open again.");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.status !== "open") return err(404, "Offer not available");
      if (offer.creatorId && offer.creatorId !== user.id) return err(403, "This offer was sent to a different creator");
      if (offer.market !== user.market) return err(403, "This offer is in a different market");
      const b = parseBody(event);
      const allBk = await allBookings();
      const existing = allBk.filter((bk) => bk.offerId === offer.id);
      if (existing.length >= offer.spots) return err(409, "All spots on this offer are booked");
      if (existing.some((bk) => bk.creatorId === user.id)) return err(409, "You already booked this offer");
      // Weekly visit cap (creator's own setting): offers still
      // arrive at cap, but accepting waits for next week.
      const cap = maxVisitsPerWeekOf(user);
      if (visitsThisWeek(allBk, user.id, Date.now()) >= cap) {
        return err(403, `You are at your max of ${cap} visit${cap === 1 ? "" : "s"} this week (your setting, under Profile). This offer stays in your Offers tab: accept it next week, or raise your weekly max if you want more.`);
      }
      const code = await genCode();
      const ts = nowIso();
      const booking = {
        id: crypto.randomUUID(),
        offerId: offer.id,
        businessId: offer.businessId,
        businessName: offer.businessName,
        creatorId: user.id,
        creatorName: user.name,
        creatorHandle: user.creator ? user.creator.handle : "",
        market: offer.market,
        category: offer.category,
        title: offer.title,
        whatComped: offer.whatComped,
        dollarCap: offer.dollarCap,
        visitWindow: offer.visitWindow,
        windowMode: offer.windowMode || "7days",
        redeemBy: redeemByFor(offer, new Date(ts)),
        visitDate: (b.visitDate || "").trim(),
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
      };
      await store.set(`booking:${booking.id}`, booking);
      await store.set(`code:${code}`, { bookingId: booking.id });
      await logEvent({ type: "offer_accepted", actorId: user.id, actorRole: "creator", subjectId: offer.id, market: offer.market, data: { businessId: offer.businessId, visitDate: booking.visitDate } });
      await logEvent({ type: "booking_code_issued", actorId: user.id, actorRole: "creator", subjectId: booking.id, market: offer.market, data: { code, offerId: offer.id, businessId: offer.businessId, dollarCap: offer.dollarCap } });
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
      return json(200, { offer });
    }
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
      const ts = nowIso();
      booking.redeemedAt = ts;
      booking.redeemMethod = "counter_code";
      booking.codeStatus = "burned";
      booking.status = "redeemed";
      booking.postDeadline = new Date(Date.parse(ts) + COMPLIANCE.onTimeHours * 3600 * 1000).toISOString();
      booking.updatedAt = ts;
      await store.set(`booking:${booking.id}`, booking);
      await logEvent({ type: "code_redeemed", actorId: user.id, actorRole: user.role, subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, code: booking.code, method: "counter_code", postDeadline: booking.postDeadline, dollarCap: booking.dollarCap } });
      await sendStaffNotice(booking, "redeem");
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

  // ---------- business reviews (post-visit) ----------
  // Plumbing only (Jeff, 2026-10-19): a business whose visit completed
  // (the post came in and the booking completed) can leave ONE review
  // per booking: 1-5 stars plus a short comment, attributed to the
  // business name, stored as review:{id} and logged as
  // business_review_left. Reviews surface on the creator's public
  // profile, discovery card, and preview profile the moment they
  // exist. There is no business-facing entry UI yet (it ships with
  // business accounts) and nothing is ever seeded: a creator with no
  // completed visits simply has no review section anywhere.
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
    const comment = String(b.comment == null ? "" : b.comment).trim().slice(0, 500);
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

  // Post-performance report (Jeff, 2026-10-19 round 2): the creator
  // adds the post's views and likes after the day-7 email asks. Two
  // optional fields, at least one required, one report per post. The
  // numbers live on the post record; Momentum's +5 is computed from
  // reportedAt, so it can only ever land once.
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
    if (views === "invalid" || likes === "invalid") return err(400, "Views and likes must be whole numbers, 0 or more");
    if (views === null && likes === null) return err(400, "Add at least one number: views or likes");
    if (views !== null) post.views = views;
    if (likes !== null) post.likes = likes;
    post.reportedAt = nowIso();
    await store.set(`post:${post.id}`, post);
    await logEvent({ type: "post_performance_reported", actorId: user.id, actorRole: "creator", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, views: post.views == null ? null : post.views, likes: post.likes == null ? null : post.likes } });
    return json(200, { post });
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
module.exports = { route, approvalEmail, signupConfirmationEmail, recruiterKitEmail, createMomentum, runComplianceSweep, runCampaignSweep, campaignEmail, DEFAULT_CAMPAIGN_ID, STANDARD_VISIT, visitRightsForPlan, RECRUITER_KIT_FLAG_KEY };
