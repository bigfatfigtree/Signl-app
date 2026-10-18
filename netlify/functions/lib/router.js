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
const LAUNCH_WINDOW_TEXT = "60 to 90 days";
const TERMS_VERSION = "2026-10-18";
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

const H48 = 48 * 60 * 60 * 1000;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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
  if (pub && pub.role === "creator") pub.founding = publicFounding(await foundingSummary(user));
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

function signupConfirmationEmail(user, band) {
  const first = (user.name || "").split(" ")[0] || "there";
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
  const first = (user.name || "").split(" ")[0] || "there";
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
    "National platforms sell reach. We sell regulars.",
    "The SIGNL team",
    "hello@joinsignl.com",
  );
  return { subject, text: lines.join("\n") };
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

async function publicCreator(u, viewer, foundingPriority) {
  const history = await creatorHistory(u.id);
  const impact = computeLocalImpactScore(u.creator || {}, history);
  let isFavorite = false;
  if (viewer && viewer.role === "business") {
    isFavorite = !!(await store.get(`favorite:${viewer.id}:${u.id}`));
  }
  return {
    userId: u.id,
    name: u.name,
    market: u.market,
    city: u.city || "",
    createdAt: u.createdAt,
    foundingBand: foundingPriority === undefined ? null : foundingBand(foundingPriority),
    photoUrl: u.creator && u.creator.hasPhoto ? `/api/users/${u.id}/photo` : null,
    profile: u.creator,
    localImpactScore: impact ? impact.score : null,
    scoreComponents: impact ? impact.components : null,
    history,
    isFavorite,
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
  return { ...booking, post, postState: postState(booking, post) };
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
    return err(403, "Business accounts are not open yet. Founding businesses join the founding business list at joinsignl.com/businesses.html to lock in founding pricing ($299/mo Self-Service, $799/mo Managed). Business accounts open when your market launches.");
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
    if (b.agreedTerms !== true) return err(400, "Please agree to the Terms of Service and Privacy Policy, and to receiving account and marketing emails from SIGNL.");
    const suggestedTier = tierForFollowers(followers);
    const tier = TIERS.some((t) => t.id === b.tierBand) ? b.tierBand : suggestedTier;
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
      followerCount: followers,
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
      topAudienceCities: cleanStringList(b.topAudienceCities, null, 5),
      localAudiencePct: localPct,
      localAudienceSource: "Self-reported",
      localAudienceAsOf: ts.slice(0, 10),
      agreedHonestPosts: true,
      agreedFtcDisclosure: true,
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
        ? { handle: user.creator.handle, city: user.city, state: user.state, country: user.country, unlisted: user.market === UNLISTED, followerCount: user.creator.followerCount, tierBand: user.creator.tierBand, suggestedTier: user.creator.suggestedTier, localAudiencePct: user.creator.localAudiencePct, localAudienceSource: user.creator.localAudienceSource, categories: user.creator.categories, compCategories: user.creator.compCategories, openToPaidCampaigns: user.creator.openToPaidCampaigns, termsVersion: TERMS_VERSION, marketingEmailConsent: true }
        : { businessName: user.business.businessName, category: user.business.category, plan: user.business.plan, planPriceMonthly: user.business.planPriceMonthly },
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
        followerCount: user.creator.followerCount,
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

  // Auth
  if (method === "POST" && seg[0] === "auth" && seg[1] === "register") return handleRegister(event);
  if (method === "POST" && seg[0] === "auth" && seg[1] === "login") return handleLogin(event);
  if (method === "POST" && seg[0] === "auth" && seg[1] === "logout") return handleLogout(event, ctx);
  if (method === "GET" && seg[0] === "auth" && seg[1] === "me") {
    if (!user) return err(401, "Not signed in");
    return json(200, { user: await withFounding(user) });
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
      if (b.followerCount !== undefined) { changes.followerCount = [c.followerCount, Math.max(0, parseInt(b.followerCount, 10) || 0)]; c.followerCount = changes.followerCount[1]; c.computedTier = tierForFollowers(c.followerCount); c.suggestedTier = c.computedTier; }
      if (b.avgViews !== undefined) c.avgViews = Math.max(0, parseInt(b.avgViews, 10) || 0);
      if (b.tierBand && TIERS.some((t) => t.id === b.tierBand)) c.tierBand = b.tierBand;
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
  // the bytes live in their own record: photo:{userId}. Serving is
  // locked down: the owner, the admin, or an approved business whose
  // market is live. Anonymous visitors can never fetch a creator photo.
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

  if (method === "GET" && seg[0] === "users" && seg.length === 3 && seg[2] === "photo") {
    const target = await store.get(`user:${seg[1]}`);
    if (!target || target.role !== "creator") return err(404, "Photo not found");
    const allowed =
      user.id === target.id ||
      user.role === "admin" ||
      (user.role === "business" && user.status === "approved" && (await isMarketLive(user.market)));
    if (!allowed) return err(403, "That photo is not public");
    const photo = await store.get(`photo:${target.id}`);
    if (!photo) return err(404, "Photo not found");
    return {
      statusCode: 200,
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store" },
      body: photo.dataBase64,
      isBase64Encoded: true,
    };
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
  if (seg[0] === "admin") {
    if (user.role !== "admin") return err(403, "Admin only");
    if (method === "GET" && seg[1] === "applications") {
      const all = await allUsers();
      const users = all.filter((u) => u.role !== "admin");
      const { approvedRank, pendingRank } = creatorRanks(all);
      const attach = (u) => {
        const pub = publicUser(u);
        if (u.role === "creator") {
          pub.foundingPriority = approvedRank.get(u.id) || null;
          pub.queuePosition = pendingRank.get(u.id) || null;
        }
        return pub;
      };
      const pending = users.filter((u) => u.status === "pending").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const decided = users.filter((u) => u.status !== "pending").sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1));
      return json(200, { pending: pending.map(attach), decided: decided.map(attach) });
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
  if (method === "GET" && seg[0] === "discover") {
    const users = await allUsers();
    let creators = users.filter((u) => u.role === "creator" && u.status === "approved");
    const market = query.market || (user.role === "business" ? user.market : null);
    if (market) creators = creators.filter((u) => u.market === marketByName(market)?.name);
    if (query.tier) creators = creators.filter((u) => u.creator && u.creator.tierBand === query.tier);
    if (query.category) creators = creators.filter((u) => u.creator && u.creator.categories.includes(query.category));
    if (query.q) {
      const q = query.q.toLowerCase();
      creators = creators.filter((u) => u.name.toLowerCase().includes(q) || (u.creator && u.creator.handle.toLowerCase().includes(q)));
    }
    const { approvedRank } = creatorRanks(users);
    const out = [];
    for (const c of creators) out.push(await publicCreator(c, user, approvedRank.get(c.id) || null));
    // Default sort is founding priority: earliest founding sign-ups
    // first, which is the priority promise made at sign-up. Businesses
    // can re-sort by Local Impact Score with ?sort=score.
    if (query.sort === "score") {
      out.sort((a, b) => (b.localImpactScore || 0) - (a.localImpactScore || 0));
    } else {
      out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    }
    return json(200, { creators: out });
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
        spots,
        status: "open",
        createdAt: ts,
        updatedAt: ts,
      };
      await store.set(`offer:${offer.id}`, offer);
      await logEvent({ type: "offer_created", actorId: user.id, actorRole: "business", subjectId: offer.id, market: offer.market, data: { title: offer.title, dollarCap, spots, targeted: !!targetCreator, creatorId: offer.creatorId, category: offer.category } });
      return json(201, { offer });
    }
    if (method === "GET" && seg.length === 1) {
      const offers = await allOffers();
      const bookings = await allBookings();
      let out = offers.map((o) => ({ ...o, bookedCount: bookings.filter((bk) => bk.offerId === o.id).length }));
      if (user.role === "business") out = out.filter((o) => o.businessId === user.id);
      else if (user.role === "creator") out = out.filter((o) => o.market === user.market && o.status === "open" && (!o.creatorId || o.creatorId === user.id));
      out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return json(200, { offers: out });
    }
    if (method === "POST" && seg.length === 3 && seg[2] === "accept") {
      if (user.role !== "creator") return err(403, "Creators only");
      const offer = await store.get(`offer:${seg[1]}`);
      if (!offer || offer.status !== "open") return err(404, "Offer not available");
      if (offer.creatorId && offer.creatorId !== user.id) return err(403, "This offer was sent to a different creator");
      if (offer.market !== user.market) return err(403, "This offer is in a different market");
      const b = parseBody(event);
      const existing = (await allBookings()).filter((bk) => bk.offerId === offer.id);
      if (existing.length >= offer.spots) return err(409, "All spots on this offer are booked");
      if (existing.some((bk) => bk.creatorId === user.id)) return err(409, "You already booked this offer");
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
    booking.postDeadline = new Date(Date.parse(ts) + H48).toISOString();
    booking.updatedAt = ts;
    await store.set(`booking:${booking.id}`, booking);
    await logEvent({ type: "visit_confirmed_by_business", actorId: user.id, actorRole: "business", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, code: booking.code, postDeadline: booking.postDeadline } });
    await logEvent({ type: "code_redeemed", actorId: user.id, actorRole: "business", subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, code: booking.code, method: "business_confirm", postDeadline: booking.postDeadline } });
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
      booking.postDeadline = new Date(Date.parse(ts) + H48).toISOString();
      booking.updatedAt = ts;
      await store.set(`booking:${booking.id}`, booking);
      await logEvent({ type: "code_redeemed", actorId: user.id, actorRole: user.role, subjectId: booking.id, market: booking.market, data: { creatorId: booking.creatorId, code: booking.code, method: "counter_code", postDeadline: booking.postDeadline, dollarCap: booking.dollarCap } });
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
    if (!/^https?:\/\/.+/i.test(url)) return err(400, "Paste the full link to your post");
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
    await store.set(`booking:${booking.id}`, booking);
    await logEvent({ type: "post_submitted", actorId: user.id, actorRole: "creator", subjectId: post.id, market: booking.market, data: { bookingId: booking.id, businessId: booking.businessId, url, onTime, hoursAfterRedeem: post.hoursAfterRedeem, includesDisclosure: post.includesDisclosure, category: booking.category } });
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

  if (seg[0] === "posts" && method === "GET") {
    let posts = await allPosts();
    if (user.role === "creator") posts = posts.filter((p) => p.creatorId === user.id);
    else if (user.role === "business") posts = posts.filter((p) => p.businessId === user.id);
    posts.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
    return json(200, { posts });
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

module.exports = { route };
