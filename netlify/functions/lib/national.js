// National business accounts (Build -178, 2026-11-16).
//
// A national account is a business whose scope is "national": it
// reaches creators in every Magpie market instead of one city.
// Its user.market carries the NATIONAL_MARKET sentinel ("National")
// — never a real market, never in MARKETS, never in config:markets,
// never in launch math. Its campaigns are a NEW record type
// (ncampaign:{id}), never offers: the offer lifecycle is welded to
// one market and to market-live state, and bolting a cross-market
// lane onto it would leak exceptions into every existing flow.
//
// Record prefixes owned by this module:
//   ncampaign:{id}                        a national campaign
//   nhand:{campaignId}:{creatorId}        one creator's hand-raise
//   nfulfill:{campaignId}:{creatorId}     gift fulfillment for a pick
//   nshortlist:{businessId}:{creatorId}   a business's saved creator
//
// LOADER RULE: every read here is a single prefix list or a
// getMany over known keys. No serial per-key store.get loops over
// a prefix, nothing awaited on any other route's request path.
const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { logEvent } = require("./events");
const { MARKETS, normalizeMarketName, CREATOR_CATEGORIES, canonicalFromList } = require("./markets");
const { isListedInMarket, audienceShareInMarket, listedMarketsFor } = require("./audience-markets");

const NATIONAL_MARKET = "National";

// The tracking honesty copy (spec §2.4). Platform copy, not brand
// copy: the brand may not edit it in this build, so it lives here
// once and every surface renders the same words.
const TRACKING_NOTE = "If you are picked, you get your own discount code and your own shopping link. When someone buys through them, the brand's store counts that sale as coming from you. That is how the brand knows your posts worked, and it is the number Magpie shows you afterward. Your code and link are the only tracking. Magpie does not follow your followers, and the brand cannot see your account details beyond what your public Magpie profile already shows.";

const RAISE_EXPLAINER = "Raise your hand = tap to say you are interested. It is not an application and it does not promise you the spot.";

const HAND_STATE_LINES = {
  raised: "You raised your hand. The brand picks its creators after the deadline below.",
  picked: "You were picked. Magpie will message you here with the details and next steps.",
  not_picked: "The brand picked its creators for this one. You are first in line for their next campaign.",
  withdrawn: "You took your hand back. You can raise it again while this campaign is open.",
  none: "",
};

const FULFILL_STATUSES = ["pending", "shipped", "delivered", "posted", "reported", "withdrawn"];
const VERIFY_CHECKLIST_KEYS = ["websiteResolves", "nameMatches", "storeExists"];

// ---------- scope helpers (spec §1.1) ----------
// Scope lives on the business sub-record. An absent scope reads
// "market" everywhere, so every existing business record behaves
// exactly as before with no migration and no backfill.
function businessScopeOf(user) {
  return user && user.business && user.business.scope === "national" ? "national" : "market";
}
function isNationalBusiness(user) {
  return !!user && user.role === "business" && businessScopeOf(user) === "national";
}
function isNationalSentinelMarket(market) {
  return typeof market === "string" && normalizeMarketName(market) === NATIONAL_MARKET;
}
// The sentinel never groups with a real market. Any per-market
// grouping that starts from a user record drops national accounts
// through this predicate (spec §7.3).
function countsTowardMarket(user) {
  return !!user && !isNationalSentinelMarket(user.market);
}

function brandDisplayName(user) {
  const b = (user && user.business) || {};
  return String(b.brandName || b.businessName || (user && user.name) || "").trim();
}

// ---------- website validation (spec §1.2, §5.3) ----------
// Host-validated at write time: a real http(s) URL whose host has
// a dot and no spaces. The host is what the duplicate-brand
// warning and the creator-facing profile both read.
function validateWebsiteUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, error: "Add the brand's website. Creators check it before they trust a campaign." };
  let u;
  try {
    u = new URL(value.includes("://") ? value : `https://${value}`);
  } catch (e) {
    return { ok: false, error: "That website address does not look right. Paste the full address, like https://yourbrand.com." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "The website must start with http:// or https://" };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || !host.includes(".") || /\s/.test(host)) return { ok: false, error: "That website address does not look right. Paste the full address, like https://yourbrand.com." };
  return { ok: true, url: u.toString().slice(0, 500), host };
}
function websiteHostOf(url) {
  const v = validateWebsiteUrl(url);
  return v.ok ? v.host : "";
}

// Focus markets: real market names only, canonicalized, deduped.
// The sentinel and unknown names drop out by construction —
// canonical names come from the MARKETS list itself.
function cleanFocusMarkets(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    const canonical = normalizeMarketName(String(raw || ""));
    const hit = MARKETS.find((m) => m.name === canonical);
    if (hit && !out.includes(hit.name)) out.push(hit.name);
    if (out.length >= 12) break;
  }
  return out;
}

function cleanCategories(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    const c = canonicalFromList(String(raw || ""), CREATOR_CATEGORIES) || null;
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, CREATOR_CATEGORIES.length);
}

// ---------- campaign state (spec §3, §13) ----------
// The deadline flip is computed on read, the way offer windows
// already compute states on read: an open campaign whose deadline
// has passed READS as closed everywhere, with no cron dependency.
function campaignStatusOnRead(c, nowMs) {
  if (!c) return "draft";
  if (c.status === "open" && c.raiseByAt && Date.parse(c.raiseByAt) <= (nowMs || Date.now())) return "closed";
  return c.status;
}
function campaignOnRead(c, nowMs) {
  if (!c) return c;
  const status = campaignStatusOnRead(c, nowMs);
  return status === c.status ? c : { ...c, status };
}

// ---------- the creator-feed fence (spec §4.1) ----------
// An open national campaign reaches a creator if and only if:
// the creator is approved, their profile is finished, the tester
// rules mirror the offer fence (testOnly campaigns reach testers
// only; sample campaigns and tester-owned brands reach nobody),
// and the brand is verified. Market is NOT a condition: a creator
// in any market — listed, unlaunched, or "Not listed yet" — sees
// it. Pure function of the three records so it unit-tests without
// a store.
function campaignVisibleToCreator(campaign, brand, creator, deps) {
  if (!campaign || !brand || !creator) return false;
  if (campaign.status !== "open") return false;
  if (!isNationalBusiness(brand)) return false;
  if (brand.status !== "approved") return false;
  if (!brand.business.verifiedAt) return false;
  if (creator.role !== "creator" || creator.status !== "approved") return false;
  if (!deps.profileCompleteOf(creator)) return false;
  const testerViewer = deps.isTester(creator);
  if (campaign.testOnly) return testerViewer;
  if (campaign.sample) return false;
  if (deps.isTester(brand)) return false;
  if (testerViewer) return false;
  return true;
}

// Why a creator cannot see / use a campaign, in plain words, for
// the campaign page's own state line. Returns "" when visible.
function campaignHiddenReason(campaign, brand, creator, deps) {
  if (!campaign) return "This campaign is not here anymore.";
  if (campaignVisibleToCreator(campaign, brand, creator, deps)) return "";
  if (campaign.status !== "open") return "This campaign is not open right now.";
  if (creator.status !== "approved") return "Your account is still being reviewed, so campaigns open up once you are approved.";
  if (!deps.profileCompleteOf(creator)) return "Finish your profile and campaigns like this one open up for you.";
  return "This campaign is not open right now.";
}

// ---------- publish gates (spec §5.2, §2.2, §13) ----------
// Every refusal names the specific missing thing. Drafts save
// freely; publishing is where legitimacy is enforced.
function publishGateErrors(campaign, bizUser) {
  const errs = [];
  if (!bizUser || !isNationalBusiness(bizUser)) { errs.push("Only a national account can publish a national campaign."); return errs; }
  if (bizUser.status !== "approved") errs.push("Your account is still being reviewed. Campaigns can go out once Magpie approves your account.");
  if (!bizUser.business || bizUser.business.accessState !== "active") errs.push("Your account is on the founding list. Campaigns go out when Magpie activates your account.");
  if (!bizUser.business || !bizUser.business.verifiedAt) errs.push("Magpie has not verified your brand yet. Verification is quick: we check your website and your store, and then your campaigns can go out.");
  const b = bizUser.business || {};
  if (!b.logoUrl) errs.push("Add your logo before this campaign can go out. Creators check it.");
  if (!b.website) errs.push("Add your website before this campaign can go out. Creators check it.");
  if (!String(campaign.title || "").trim()) errs.push("Give the campaign a headline in plain words, like \"Try our liquid vitamins, free\".");
  if (String(campaign.whatYouGet || "").trim().length < 12) errs.push("Say what the creator gets, as a thing: \"3 products of your choice, free\" — a few more words so it is clear.");
  if (!String(campaign.whatWeAsk || "").trim()) errs.push("Say what you ask for, in one line: the posts you want and tagging your brand.");
  if (!Number.isInteger(campaign.picksCount) || campaign.picksCount < 1) errs.push("Say how many creators you will pick (1 or more).");
  if (!campaign.raiseByAt || Number.isNaN(Date.parse(campaign.raiseByAt))) errs.push("Pick the date creators raise a hand by.");
  else if (Date.parse(campaign.raiseByAt) <= Date.now()) errs.push("The hand-raise deadline has passed. Pick a date in the future.");
  return errs;
}

// Creator eligibility for being PICKED (spec §13): the hand stays
// on record whatever happens; eligibility is recomputed at read.
function raiserEligibility(creator, campaign, deps) {
  if (!creator) return { eligible: false, reason: "That account is not on Magpie anymore." };
  if (creator.status !== "approved") return { eligible: false, reason: "Their account is not approved right now." };
  if (!deps.profileCompleteOf(creator)) return { eligible: false, reason: "Their profile is not finished right now." };
  if (deps.isTester(creator) && !(campaign && campaign.testOnly)) return { eligible: false, reason: "Tester accounts are not picked for real campaigns." };
  return { eligible: true, reason: "" };
}

// ---------- record builders ----------
// The national business record, in exactly the shape registration
// builds for a market business (spec §10: share the builder shape
// so the record can never drift), with scope national, the
// sentinel market, plan null, and the brand fields added.
function buildNationalBusinessUser(input, deps) {
  const ts = deps.nowIso();
  const id = crypto.randomUUID();
  const password = crypto.randomBytes(18).toString("base64url");
  const { salt, hash } = auth.hashPassword(password);
  const website = validateWebsiteUrl(input.website);
  const businessName = String(input.businessName || input.brandName || "").trim().slice(0, 120);
  const currency = ["USD", "GBP", "CAD", "NZD", "EUR"].includes(String(input.currency || "").toUpperCase()) ? String(input.currency).toUpperCase() : "USD";
  return {
    id,
    role: "business",
    email: String(input.email || "").trim().toLowerCase(),
    name: String(input.name || businessName).trim().slice(0, 120),
    passwordSalt: salt,
    passwordHash: hash,
    status: "pending",
    tester: false,
    market: NATIONAL_MARKET,
    city: "",
    state: null,
    country: String(input.country || "United States").trim().slice(0, 60) || "United States",
    createdAt: ts,
    updatedAt: ts,
    reviewedAt: null,
    reviewedBy: null,
    termsVersion: deps.termsVersion || null,
    termsAcceptedAt: ts,
    marketingEmailConsent: false,
    marketingConsentAt: null,
    business: {
      scope: "national",
      currency,
      businessName,
      brandName: String(input.brandName || businessName).trim().slice(0, 120),
      category: "Other",
      neighborhood: "",
      zip: "",
      about: String(input.about || "").trim().slice(0, 600),
      brandAbout: String(input.brandAbout || input.about || "").trim().slice(0, 600),
      website: website.ok ? website.url : "",
      logoUrl: String(input.logoUrl || "").trim().slice(0, 500),
      focusMarkets: cleanFocusMarkets(input.focusMarkets),
      verifiedAt: null,
      verifiedBy: null,
      verifyChecklist: null,
      plan: null,
      planName: null,
      planPriceMonthly: null,
      planMinMonths: null,
      billingStatus: "National account. No plan yet: Magpie will share plan options before anything is ever charged.",
      planSelectedAt: null,
      accessState: "founding",
      activatedAt: null,
      activatedBy: null,
      reviewLinks: {},
      discountEnabled: false,
      discountPct: null,
      referralUrl: "",
      referralCode: "",
      referralNote: "",
      monthlyTalentBudget: deps.managedTalentBudgetDefault || 0,
    },
  };
}

function newCampaignRecord(bizUser, body, deps) {
  const ts = deps.nowIso();
  return {
    id: crypto.randomUUID(),
    businessId: bizUser.id,
    status: "draft",
    title: String(body.title || "").trim().slice(0, 120),
    whatYouGet: String(body.whatYouGet || "").trim().slice(0, 300),
    whatWeAsk: String(body.whatWeAsk || "").trim().slice(0, 300),
    picksCount: Math.max(0, parseInt(body.picksCount, 10) || 0),
    raiseByAt: body.raiseByAt ? String(body.raiseByAt) : null,
    details: String(body.details || "").trim().slice(0, 2000),
    trackingNote: TRACKING_NOTE,
    categories: cleanCategories(body.categories),
    focusMarkets: cleanFocusMarkets(body.focusMarkets),
    sample: false,
    testOnly: false,
    adminNote: null,
    createdAt: ts,
    updatedAt: ts,
    publishedAt: null,
  };
}

// ---------- views (wire shapes) ----------
function brandProfileView(bizUser, openCampaigns) {
  const b = (bizUser && bizUser.business) || {};
  const national = isNationalBusiness(bizUser);
  return {
    businessId: bizUser.id,
    scope: national ? "national" : "market",
    brandName: brandDisplayName(bizUser),
    businessName: b.businessName || "",
    logoUrl: b.logoUrl || null,
    initial: (brandDisplayName(bizUser).charAt(0) || "M").toUpperCase(),
    about: (national ? (b.brandAbout || b.about) : b.about) || "",
    website: national ? (b.website || null) : null,
    websiteHost: national ? (websiteHostOf(b.website) || null) : null,
    basedIn: bizUser.city ? `Based in ${bizUser.city}, ${bizUser.country || ""}`.replace(/, $/, "") : null,
    nationalLine: national ? "A national brand. Their products ship across the country." : null,
    verified: !!(national && b.verifiedAt),
    verifiedLine: national && b.verifiedAt ? "Verified by Magpie" : null,
    verifiedExplainer: national && b.verifiedAt ? "Magpie checked that this is the real brand behind this campaign." : null,
    market: national ? null : (bizUser.market || null),
    openCampaigns: openCampaigns || [],
  };
}

function campaignCardView(campaign, bizUser, myHand) {
  const b = (bizUser && bizUser.business) || {};
  return {
    id: campaign.id,
    kind: "national_campaign",
    businessId: campaign.businessId,
    brandName: brandDisplayName(bizUser),
    logoUrl: b.logoUrl || null,
    initial: (brandDisplayName(bizUser).charAt(0) || "M").toUpperCase(),
    verified: !!b.verifiedAt,
    nationalTag: "National brand",
    title: campaign.title,
    whatYouGet: campaign.whatYouGet,
    whatWeAsk: campaign.whatWeAsk,
    picksCount: campaign.picksCount,
    raiseByAt: campaign.raiseByAt,
    categories: campaign.categories || [],
    status: campaign.status,
    raiseExplainer: RAISE_EXPLAINER,
    pickedLine: "If you are picked, Magpie messages you here with the details and next steps.",
    myHand: myHand ? { status: myHand.status, line: HAND_STATE_LINES[myHand.status] || "" } : { status: "none", line: "" },
    createdAt: campaign.createdAt,
  };
}

// A creator's local numbers in every market they are listed in —
// the existing audience-markets machinery, the same numbers and
// labels a market business sees (spec §6).
function creatorMarketLines(creator, deps) {
  const total = deps.audienceTotalOf(creator.creator || {});
  return listedMarketsFor(creator).map((e) => ({
    market: e.market,
    home: !!e.home,
    localPct: e.pct,
    localCount: typeof e.pct === "number" ? Math.round((total * e.pct) / 100) : null,
    source: creator.creator && creator.creator.localAudienceSource ? creator.creator.localAudienceSource : "Self-reported",
  }));
}

function discoveryCard(creator, deps, shortlisted) {
  const c = creator.creator || {};
  return {
    creatorId: creator.id,
    name: creator.name || "",
    handle: c.handle || "",
    homeMarket: isNationalSentinelMarket(creator.market) ? null : (creator.market || null),
    city: creator.city || "",
    categories: (c.categories || []).map((x) => canonicalFromList(x, CREATOR_CATEGORIES) || x),
    totalAudience: deps.audienceTotalOf(c),
    markets: creatorMarketLines(creator, deps),
    shortlisted: !!shortlisted,
    hasPhoto: !!c.hasPhoto,
  };
}

module.exports = {
  NATIONAL_MARKET,
  TRACKING_NOTE,
  RAISE_EXPLAINER,
  HAND_STATE_LINES,
  FULFILL_STATUSES,
  VERIFY_CHECKLIST_KEYS,
  businessScopeOf,
  isNationalBusiness,
  isNationalSentinelMarket,
  countsTowardMarket,
  brandDisplayName,
  validateWebsiteUrl,
  websiteHostOf,
  cleanFocusMarkets,
  cleanCategories,
  campaignStatusOnRead,
  campaignOnRead,
  campaignVisibleToCreator,
  campaignHiddenReason,
  publishGateErrors,
  raiserEligibility,
  buildNationalBusinessUser,
  newCampaignRecord,
  brandProfileView,
  campaignCardView,
  creatorMarketLines,
  discoveryCard,
  businessCampaignView,
  handleNationalApi,
  handleAdminNationalApi,
  nationalRollup,
  adminAccountView,
  sigBusinessNational,
  sigCreatorNationalHands,
  listCampaigns,
  listAllHands,
};

// ---------- store reads (prefix lists + getMany only) ----------
async function listCampaigns() {
  const rows = await store.list("ncampaign:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function listHandsForCampaign(campaignId) {
  const rows = await store.list(`nhand:${campaignId}:`);
  return rows.map((r) => r.value).filter(Boolean);
}
async function listAllHands() {
  const rows = await store.list("nhand:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function listFulfillmentsForCampaign(campaignId) {
  const rows = await store.list(`nfulfill:${campaignId}:`);
  return rows.map((r) => r.value).filter(Boolean);
}
async function usersByIds(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await store.getMany(uniq.map((id) => `user:${id}`));
  const out = new Map();
  for (const r of rows) if (r.value) out.set(r.value.id, r.value);
  return out;
}
async function getCampaign(id) {
  return id ? await store.get(`ncampaign:${id}`) : null;
}
async function getHand(campaignId, creatorId) {
  return await store.get(`nhand:${campaignId}:${creatorId}`);
}
async function getFulfillment(campaignId, creatorId) {
  return await store.get(`nfulfill:${campaignId}:${creatorId}`);
}

// Discovery population: approved, finished-profile, non-tester
// creators across ALL markets (spec §6). Reuses the caller's
// memoized all-users read where the router passes one in.
async function discoveryPopulation(deps) {
  const users = await deps.allUsers();
  return users.filter((u) => u.role === "creator" && u.status === "approved" && !deps.isTester(u) && deps.profileCompleteOf(u));
}

function sortDiscovery(cards, focusMarkets, marketFilter) {
  const localIn = (card, m) => {
    const line = (card.markets || []).find((x) => x.market === m);
    return line && typeof line.localCount === "number" ? line.localCount : -1;
  };
  if (marketFilter) {
    // Single-market view: ranked by local reach IN that market,
    // the platform's standing ranking rule (spec §6).
    return cards.sort((a, b) => (localIn(b, marketFilter) - localIn(a, marketFilter)) || ((b.totalAudience || 0) - (a.totalAudience || 0)));
  }
  const focus = focusMarkets || [];
  if (focus.length) {
    const bestFocus = (card) => Math.max(-1, ...focus.map((m) => localIn(card, m)));
    return cards.sort((a, b) => bestFocus(b) - bestFocus(a) || ((b.totalAudience || 0) - (a.totalAudience || 0)));
  }
  return cards.sort((a, b) => (b.totalAudience || 0) - (a.totalAudience || 0));
}

// ---------- the /api/national/* handler ----------
async function handleNationalApi(ctx) {
  const { user, seg, method, event, query, deps } = ctx;
  const { json, err, parseBody, nowIso } = deps;
  if (!user) return err(401, "Sign in required");
  const b = method === "GET" ? {} : parseBody(event);

  // ----- creator lane: the national feed -----
  // GET /api/national/feed — open campaigns this creator may see,
  // category matches first, then newest. No hand counts, no ranks,
  // no market counts ever ride this payload (Build -177 rule).
  if (seg[1] === "feed" && method === "GET") {
    if (user.role !== "creator") return err(403, "Creators only");
    const campaigns = (await listCampaigns()).map((c) => campaignOnRead(c));
    const brands = await usersByIds(campaigns.map((c) => c.businessId));
    const myHands = new Map((await listAllHands()).filter((h) => h.creatorId === user.id).map((h) => [h.campaignId, h]));
    const visible = campaigns.filter((c) => campaignVisibleToCreator(c, brands.get(c.businessId), user, deps));
    const myCats = new Set(((user.creator && user.creator.categories) || []).map((x) => canonicalFromList(x, CREATOR_CATEGORIES) || x));
    visible.sort((a, z) => {
      const am = (a.categories || []).some((c) => myCats.has(c)) ? 1 : 0;
      const zm = (z.categories || []).some((c) => myCats.has(c)) ? 1 : 0;
      if (zm !== am) return zm - am;
      return a.createdAt < z.createdAt ? 1 : -1;
    });
    return json(200, { campaigns: visible.map((c) => campaignCardView(c, brands.get(c.businessId), myHands.get(c.id))) });
  }

  // ----- brand profile (spec §2.1) -----
  // GET /api/national/brands/:id — the profile a creator opens
  // from a campaign card. Same builder renders a market business's
  // overlapping fields; national accounts carry the fuller set.
  if (seg[1] === "brands" && seg.length === 3 && method === "GET") {
    const target = await store.get(`user:${seg[2]}`);
    if (!target || target.role !== "business" || !target.business) return err(404, "That brand is not on Magpie.");
    if (deps.isTester(target) && !deps.isTester(user) && user.role !== "admin") return err(404, "That brand is not on Magpie.");
    let open = [];
    if (isNationalBusiness(target)) {
      const campaigns = (await listCampaigns()).map((c) => campaignOnRead(c)).filter((c) => c.businessId === target.id && c.status === "open");
      if (user.role === "creator") {
        open = campaigns.filter((c) => campaignVisibleToCreator(c, target, user, deps)).map((c) => ({ id: c.id, title: c.title, whatYouGet: c.whatYouGet, raiseByAt: c.raiseByAt }));
      } else {
        open = campaigns.map((c) => ({ id: c.id, title: c.title, whatYouGet: c.whatYouGet, raiseByAt: c.raiseByAt }));
      }
    }
    return json(200, { brand: brandProfileView(target, open) });
  }

  // ----- one campaign, creator side -----
  if (seg[1] === "campaigns" && seg.length === 3 && method === "GET" && user.role === "creator") {
    const campaign = campaignOnRead(await getCampaign(seg[2]));
    if (!campaign) return err(404, "Campaign not found");
    const brand = await store.get(`user:${campaign.businessId}`);
    if (!brand) return err(404, "Campaign not found");
    const visible = campaignVisibleToCreator(campaign, brand, user, deps);
    const hand = await getHand(campaign.id, user.id);
    // A creator who already raised a hand keeps their own page
    // even after the campaign closes or they were not picked:
    // their own record is their own data.
    if (!visible && !hand) return err(404, campaignHiddenReason(campaign, brand, user, deps));
    const fulfillment = hand && hand.status === "picked" ? await getFulfillment(campaign.id, user.id) : null;
    return json(200, {
      campaign: {
        ...campaignCardView(campaign, brand, hand),
        details: campaign.details || "",
        whatWeAskFull: campaign.whatWeAsk,
        trackingNote: campaign.trackingNote || TRACKING_NOTE,
        pickLine: `The brand picks ${campaign.picksCount} creator${campaign.picksCount === 1 ? "" : "s"} from everyone who raises a hand by the deadline.`,
      },
      brand: brandProfileView(brand, []),
      fulfillment: fulfillment ? { status: fulfillment.status, productPicks: fulfillment.productPicks || [], shippingName: fulfillment.shippingName || "", shippingAddress: fulfillment.shippingAddress || "", phone: fulfillment.phone || "", trackingNumber: fulfillment.trackingNumber || null, postLinks: fulfillment.postLinks || [] } : null,
    });
  }

  // ----- raise / withdraw a hand -----
  if (seg[1] === "campaigns" && seg.length === 4 && (seg[3] === "raise" || seg[3] === "withdraw") && method === "POST") {
    if (user.role !== "creator") return err(403, "Creators only");
    const campaign = campaignOnRead(await getCampaign(seg[2]));
    if (!campaign) return err(404, "Campaign not found");
    const brand = await store.get(`user:${campaign.businessId}`);
    if (!brand) return err(404, "Campaign not found");
    const existing = await getHand(campaign.id, user.id);
    if (seg[3] === "raise") {
      if (!campaignVisibleToCreator(campaign, brand, user, deps)) return err(403, campaignHiddenReason(campaign, brand, user, deps) || "This campaign is not open right now.");
      const ts = nowIso();
      const hand = existing && existing.status !== "withdrawn"
        ? existing
        : { campaignId: campaign.id, creatorId: user.id, businessId: campaign.businessId, createdAt: existing ? existing.createdAt : ts, status: "raised", pickedAt: null, decidedBy: null };
      hand.status = "raised";
      hand.updatedAt = ts;
      await store.set(`nhand:${campaign.id}:${user.id}`, hand);
      await logEvent({ type: "national_hand_raised", actorId: user.id, actorRole: "creator", subjectId: campaign.id, market: null, data: { businessId: campaign.businessId } });
      return json(200, { hand: { status: hand.status, line: HAND_STATE_LINES.raised } });
    }
    // withdraw
    if (!existing || existing.status === "withdrawn") return json(200, { hand: { status: "none", line: "" } });
    const ts = nowIso();
    const wasPicked = existing.status === "picked";
    existing.status = "withdrawn";
    existing.updatedAt = ts;
    await store.set(`nhand:${campaign.id}:${user.id}`, existing);
    if (wasPicked) {
      const f = await getFulfillment(campaign.id, user.id);
      if (f && f.status !== "withdrawn") { f.status = "withdrawn"; f.updatedAt = ts; await store.set(`nfulfill:${campaign.id}:${user.id}`, f); }
    }
    await logEvent({ type: "national_hand_withdrawn", actorId: user.id, actorRole: "creator", subjectId: campaign.id, market: null, data: { businessId: campaign.businessId, wasPicked } });
    return json(200, { hand: { status: "withdrawn", line: HAND_STATE_LINES.withdrawn } });
  }

  // ----- picked creator: gift fulfillment details -----
  if (seg[1] === "campaigns" && seg.length === 4 && seg[3] === "fulfillment" && method === "POST") {
    if (user.role !== "creator") return err(403, "Creators only");
    const campaign = await getCampaign(seg[2]);
    if (!campaign) return err(404, "Campaign not found");
    const hand = await getHand(campaign.id, user.id);
    if (!hand || hand.status !== "picked") return err(403, "This step opens once the brand picks you.");
    const ts = nowIso();
    const f = (await getFulfillment(campaign.id, user.id)) || { campaignId: campaign.id, creatorId: user.id, businessId: campaign.businessId, status: "pending", createdAt: ts };
    if (Array.isArray(b.productPicks)) f.productPicks = b.productPicks.map((x) => String(x || "").trim().slice(0, 120)).filter(Boolean).slice(0, 10);
    if (b.shippingName !== undefined) f.shippingName = String(b.shippingName || "").trim().slice(0, 120);
    if (b.shippingAddress !== undefined) f.shippingAddress = String(b.shippingAddress || "").trim().slice(0, 400);
    if (b.phone !== undefined) f.phone = String(b.phone || "").trim().slice(0, 40);
    if (Array.isArray(b.postLinks) && f.status === "delivered") {
      f.postLinks = b.postLinks.map((x) => String(x || "").trim().slice(0, 500)).filter(Boolean).slice(0, 5);
      if (f.postLinks.length) f.status = "posted";
    }
    f.updatedAt = ts;
    await store.set(`nfulfill:${campaign.id}:${user.id}`, f);
    return json(200, { fulfillment: { status: f.status, productPicks: f.productPicks || [], shippingName: f.shippingName || "", shippingAddress: f.shippingAddress || "", phone: f.phone || "", trackingNumber: f.trackingNumber || null, postLinks: f.postLinks || [] } });
  }

  // Everything below is the national business's own surfaces.
  if (!isNationalBusiness(user)) {
    if (seg[1] === "campaigns" || seg[1] === "discover" || seg[1] === "reports" || seg[1] === "shortlist" || seg[1] === "me") {
      return err(403, "That is a national account surface. Your account reaches creators in its own market.");
    }
    return err(404, "Not found");
  }

  // ----- business home summary -----
  if (seg[1] === "me" && method === "GET") {
    const campaigns = (await listCampaigns()).map((c) => campaignOnRead(c)).filter((c) => c.businessId === user.id);
    const hands = (await listAllHands()).filter((h) => h.businessId === user.id);
    const biz = user.business || {};
    return json(200, {
      account: {
        scope: "national",
        brandName: brandDisplayName(user),
        businessName: biz.businessName || "",
        status: user.status,
        accessState: deps.businessAccessState(user),
        verified: !!biz.verifiedAt,
        verifiedAt: biz.verifiedAt || null,
        website: biz.website || "",
        logoUrl: biz.logoUrl || null,
        brandAbout: biz.brandAbout || "",
        about: biz.about || "",
        focusMarkets: biz.focusMarkets || [],
        plan: null,
      },
      counts: {
        campaigns: campaigns.length,
        open: campaigns.filter((c) => c.status === "open").length,
        draft: campaigns.filter((c) => c.status === "draft").length,
        hands: hands.filter((h) => h.status === "raised" || h.status === "picked").length,
        picks: hands.filter((h) => h.status === "picked").length,
        picksToMake: campaigns.filter((c) => (c.status === "open" || c.status === "closed")).reduce((n, c) => n + Math.max(0, (c.picksCount || 0) - hands.filter((h) => h.campaignId === c.id && h.status === "picked").length), 0),
      },
      campaigns: campaigns.map((c) => businessCampaignView(c, hands.filter((h) => h.campaignId === c.id))),
    });
  }

  // ----- business campaign list / create -----
  if (seg[1] === "campaigns" && seg.length === 2) {
    if (method === "GET") {
      const campaigns = (await listCampaigns()).map((c) => campaignOnRead(c)).filter((c) => c.businessId === user.id);
      const hands = (await listAllHands()).filter((h) => h.businessId === user.id);
      return json(200, { campaigns: campaigns.map((c) => businessCampaignView(c, hands.filter((h) => h.campaignId === c.id))) });
    }
    if (method === "POST") {
      const campaign = newCampaignRecord(user, b, deps);
      await store.set(`ncampaign:${campaign.id}`, campaign);
      await logEvent({ type: "national_campaign_created", actorId: user.id, actorRole: "business", subjectId: campaign.id, market: null, data: { title: campaign.title } });
      return json(201, { campaign: businessCampaignView(campaign, []) });
    }
  }

  // ----- one campaign, business side -----
  if (seg[1] === "campaigns" && seg.length >= 3) {
    const campaign = await getCampaign(seg[2]);
    if (!campaign || campaign.businessId !== user.id) return err(404, "Campaign not found");

    if (seg.length === 3 && method === "GET") {
      const hands = await listHandsForCampaign(campaign.id);
      return json(200, { campaign: businessCampaignView(campaignOnRead(campaign), hands) });
    }
    if (seg.length === 3 && method === "PATCH") {
      if (campaign.status === "completed" || campaign.status === "cancelled") return err(409, "This campaign is finished, so it no longer changes.");
      if (b.title !== undefined) campaign.title = String(b.title || "").trim().slice(0, 120);
      if (b.whatYouGet !== undefined) campaign.whatYouGet = String(b.whatYouGet || "").trim().slice(0, 300);
      if (b.whatWeAsk !== undefined) campaign.whatWeAsk = String(b.whatWeAsk || "").trim().slice(0, 300);
      if (b.picksCount !== undefined) campaign.picksCount = Math.max(0, parseInt(b.picksCount, 10) || 0);
      if (b.raiseByAt !== undefined) campaign.raiseByAt = b.raiseByAt ? String(b.raiseByAt) : null;
      if (b.details !== undefined) campaign.details = String(b.details || "").trim().slice(0, 2000);
      if (b.categories !== undefined) campaign.categories = cleanCategories(b.categories);
      if (b.focusMarkets !== undefined) campaign.focusMarkets = cleanFocusMarkets(b.focusMarkets);
      campaign.updatedAt = nowIso();
      await store.set(`ncampaign:${campaign.id}`, campaign);
      return json(200, { campaign: businessCampaignView(campaignOnRead(campaign), await listHandsForCampaign(campaign.id)) });
    }
    if (seg.length === 4 && seg[3] === "publish" && method === "POST") {
      const current = campaignOnRead(campaign);
      if (current.status !== "draft") return err(409, "Only a draft can go out. This campaign is already " + current.status + ".");
      const errs = publishGateErrors(current, user);
      if (errs.length) return err(400, errs[0], );
      const ts = nowIso();
      campaign.status = "open";
      campaign.publishedAt = ts;
      campaign.updatedAt = ts;
      await store.set(`ncampaign:${campaign.id}`, campaign);
      await logEvent({ type: "national_campaign_published", actorId: user.id, actorRole: "business", subjectId: campaign.id, market: null, data: { title: campaign.title, picksCount: campaign.picksCount } });
      return json(200, { campaign: businessCampaignView(campaign, await listHandsForCampaign(campaign.id)) });
    }
    if (seg.length === 4 && seg[3] === "close" && method === "POST") {
      if (campaign.status === "completed" || campaign.status === "cancelled") return err(409, "This campaign is already finished.");
      campaign.status = "closed";
      campaign.closedBy = "business";
      campaign.updatedAt = nowIso();
      await store.set(`ncampaign:${campaign.id}`, campaign);
      await logEvent({ type: "national_campaign_closed", actorId: user.id, actorRole: "business", subjectId: campaign.id, market: null, data: { by: "business" } });
      return json(200, { campaign: businessCampaignView(campaignOnRead(campaign), await listHandsForCampaign(campaign.id)) });
    }
    if (seg.length === 4 && seg[3] === "raisers" && method === "GET") {
      const hands = await listHandsForCampaign(campaign.id);
      const creators = await usersByIds(hands.map((h) => h.creatorId));
      const shortlistRows = await store.list(`nshortlist:${user.id}:`);
      const shortlisted = new Set(shortlistRows.map((r) => String(r.key).slice(`nshortlist:${user.id}:`.length)));
      const rows = hands.map((h) => {
        const creator = creators.get(h.creatorId);
        const elig = raiserEligibility(creator, campaign, deps);
        return {
          creatorId: h.creatorId,
          status: h.status,
          raisedAt: h.createdAt,
          eligible: elig.eligible,
          ineligibleReason: elig.eligible ? "" : elig.reason,
          creator: creator ? discoveryCard(creator, deps, shortlisted.has(h.creatorId)) : null,
          fulfillment: null,
        };
      });
      const fulfillments = await listFulfillmentsForCampaign(campaign.id);
      const fByCreator = new Map(fulfillments.map((f) => [f.creatorId, f]));
      for (const row of rows) {
        const f = fByCreator.get(row.creatorId);
        if (f) row.fulfillment = { status: f.status, trackingNumber: f.trackingNumber || null, postLinks: f.postLinks || [], ordersAttributed: f.ordersAttributed != null ? f.ordersAttributed : null, revenueAttributed: f.revenueAttributed != null ? f.revenueAttributed : null, resultNote: f.resultNote || "" };
      }
      return json(200, { campaign: businessCampaignView(campaignOnRead(campaign), hands), raisers: rows });
    }
    if (seg.length === 4 && seg[3] === "pick" && method === "POST") {
      const creatorId = String(b.creatorId || "");
      const hand = await getHand(campaign.id, creatorId);
      if (!hand || hand.status !== "raised") return err(404, "That creator has not raised a hand for this campaign, or their hand is already decided.");
      const creator = await store.get(`user:${creatorId}`);
      const elig = raiserEligibility(creator, campaign, deps);
      if (!elig.eligible) return err(400, elig.reason);
      const hands = await listHandsForCampaign(campaign.id);
      const activePicks = hands.filter((h) => h.status === "picked").length;
      const current = campaignOnRead(campaign);
      if (current.status === "draft" || current.status === "cancelled") return err(409, "This campaign is not open for picks.");
      // Replacements (spec §13): after completion, a pick is only
      // a replacement — it opens when a picked creator withdrew,
      // which is exactly activePicks < picksCount.
      if (activePicks >= (campaign.picksCount || 0)) return err(409, `You have picked your ${campaign.picksCount} creator${campaign.picksCount === 1 ? "" : "s"} for this campaign. If one withdraws, you can pick a replacement here.`);
      const ts = nowIso();
      hand.status = "picked";
      hand.pickedAt = ts;
      hand.decidedBy = user.id;
      hand.updatedAt = ts;
      await store.set(`nhand:${campaign.id}:${creatorId}`, hand);
      const existingF = await getFulfillment(campaign.id, creatorId);
      if (!existingF || existingF.status === "withdrawn") {
        await store.set(`nfulfill:${campaign.id}:${creatorId}`, { campaignId: campaign.id, creatorId, businessId: user.id, status: "pending", productPicks: [], shippingName: "", shippingAddress: "", phone: "", trackingNumber: null, postLinks: [], resultNote: "", ordersAttributed: null, revenueAttributed: null, createdAt: ts, updatedAt: ts });
      }
      await deps.notifyUser(creatorId, "national_picked", `You were picked for ${brandDisplayName(user)}'s campaign "${campaign.title}". Open the campaign to share where your gift should go.`, { campaignId: campaign.id });
      await logEvent({ type: "national_creator_picked", actorId: user.id, actorRole: "business", subjectId: campaign.id, market: null, data: { creatorId } });
      return json(200, { hand: { creatorId, status: "picked" }, picksMade: activePicks + 1, picksCount: campaign.picksCount });
    }
    if (seg.length === 4 && seg[3] === "complete-picks" && method === "POST") {
      const current = campaignOnRead(campaign);
      if (current.status !== "open" && current.status !== "closed") return err(409, "Picks can only be finished on an open or closed campaign.");
      const hands = await listHandsForCampaign(campaign.id);
      const ts = nowIso();
      let flipped = 0;
      for (const h of hands) {
        if (h.status !== "raised") continue;
        h.status = "not_picked";
        h.decidedBy = user.id;
        h.updatedAt = ts;
        await store.set(`nhand:${campaign.id}:${h.creatorId}`, h);
        flipped += 1;
        await deps.notifyUser(h.creatorId, "national_not_picked", `${brandDisplayName(user)} picked its creators for "${campaign.title}". You are first in line for their next campaign.`, { campaignId: campaign.id });
      }
      campaign.status = "completed";
      campaign.completedAt = ts;
      campaign.updatedAt = ts;
      await store.set(`ncampaign:${campaign.id}`, campaign);
      await logEvent({ type: "national_picks_completed", actorId: user.id, actorRole: "business", subjectId: campaign.id, market: null, data: { notPicked: flipped } });
      return json(200, { campaign: businessCampaignView(campaign, await listHandsForCampaign(campaign.id)), notPicked: flipped });
    }
    if (seg.length === 5 && seg[3] === "fulfillment" && method === "PATCH") {
      const creatorId = seg[4];
      const f = await getFulfillment(campaign.id, creatorId);
      if (!f) return err(404, "No gift is being fulfilled for that creator yet. Picks come first.");
      if (b.status !== undefined) {
        if (!FULFILL_STATUSES.includes(b.status)) return err(400, "Fulfillment status must be one of: " + FULFILL_STATUSES.join(", ") + ".");
        f.status = b.status;
      }
      if (b.trackingNumber !== undefined) f.trackingNumber = String(b.trackingNumber || "").trim().slice(0, 80) || null;
      if (b.opsNote !== undefined) f.opsNote = String(b.opsNote || "").trim().slice(0, 500);
      f.updatedAt = nowIso();
      await store.set(`nfulfill:${campaign.id}:${creatorId}`, f);
      return json(200, { fulfillment: f });
    }
    return err(404, "Not found");
  }

  // ----- discovery across all markets (spec §6) -----
  if (seg[1] === "discover" && method === "GET") {
    if (deps.businessAccessState(user) !== "active") return err(403, "Your account is on the founding list. Finding creators opens when Magpie activates your account.");
    const marketFilter = query.market ? (MARKETS.find((m) => m.name === normalizeMarketName(String(query.market))) || {}).name || null : null;
    if (query.market && !marketFilter) return err(400, "That is not one of the Magpie markets.");
    const catWanted = query.category ? (canonicalFromList(String(query.category), CREATOR_CATEGORIES) || String(query.category)) : null;
    const q = String(query.q || "").trim().toLowerCase();
    const population = await discoveryPopulation(deps);
    const shortlistRows = await store.list(`nshortlist:${user.id}:`);
    const shortlisted = new Set(shortlistRows.map((r) => String(r.key).slice(`nshortlist:${user.id}:`.length)));
    let cards = population.map((c) => discoveryCard(c, deps, shortlisted.has(c.id)));
    if (marketFilter) cards = cards.filter((card) => (card.markets || []).some((x) => x.market === marketFilter));
    if (catWanted) cards = cards.filter((card) => (card.categories || []).includes(catWanted));
    if (q) cards = cards.filter((card) => `${card.name} ${card.handle}`.toLowerCase().includes(q));
    const focus = (campaign0Focus(user)) || [];
    cards = sortDiscovery(cards, focus, marketFilter);
    return json(200, {
      creators: cards.slice(0, 200),
      total: cards.length,
      markets: MARKETS.map((m) => m.name),
      categories: CREATOR_CATEGORIES,
      focusMarkets: (user.business && user.business.focusMarkets) || [],
      marketFilter: marketFilter || null,
    });
  }

  // ----- shortlist (spec §6): the business's own working list.
  // It notifies nobody and shows nowhere on the creator's side.
  if (seg[1] === "shortlist") {
    if (method === "GET") {
      const rows = await store.list(`nshortlist:${user.id}:`);
      const creators = await usersByIds(rows.map((r) => String(r.key).slice(`nshortlist:${user.id}:`.length)));
      const cards = [...creators.values()].map((c) => discoveryCard(c, deps, true));
      return json(200, { creators: cards });
    }
    if (method === "POST") {
      const creatorId = String(b.creatorId || "");
      const target = await store.get(`user:${creatorId}`);
      if (!target || target.role !== "creator") return err(404, "Creator not found");
      if (b.on === false) { await store.del(`nshortlist:${user.id}:${creatorId}`); return json(200, { creatorId, shortlisted: false }); }
      await store.set(`nshortlist:${user.id}:${creatorId}`, { businessId: user.id, creatorId, createdAt: nowIso() });
      return json(200, { creatorId, shortlisted: true });
    }
  }

  // ----- reporting (spec §11) -----
  if (seg[1] === "reports" && method === "GET") {
    const campaigns = (await listCampaigns()).map((c) => campaignOnRead(c)).filter((c) => c.businessId === user.id);
    const hands = (await listAllHands()).filter((h) => h.businessId === user.id);
    const creators = await usersByIds(hands.map((h) => h.creatorId));
    const perCampaign = [];
    for (const c of campaigns) {
      const ch = hands.filter((h) => h.campaignId === c.id);
      const fulfillments = await listFulfillmentsForCampaign(c.id);
      const fStates = {};
      for (const f of fulfillments) fStates[f.status] = (fStates[f.status] || 0) + 1;
      const attributed = fulfillments.reduce((acc, f) => ({ orders: acc.orders + (Number(f.ordersAttributed) || 0), revenue: acc.revenue + (Number(f.revenueAttributed) || 0) }), { orders: 0, revenue: 0 });
      perCampaign.push({
        id: c.id, title: c.title, status: c.status, picksCount: c.picksCount,
        hands: ch.filter((h) => h.status !== "withdrawn").length,
        picks: ch.filter((h) => h.status === "picked").length,
        fulfillmentStates: fStates,
        attributed: { orders: attributed.orders, revenue: attributed.revenue, source: "Reported by the brand's store" },
      });
    }
    // Per-market breakdowns, both views labeled: where raisers
    // live (home market) and every market they are listed in.
    const byHome = {};
    const byListed = {};
    for (const h of hands) {
      if (h.status === "withdrawn") continue;
      const creator = creators.get(h.creatorId);
      if (!creator) continue;
      const home = isNationalSentinelMarket(creator.market) ? "Not listed yet" : (creator.market || "Not listed yet");
      byHome[home] = byHome[home] || { market: home, hands: 0, picks: 0 };
      byHome[home].hands += 1;
      if (h.status === "picked") byHome[home].picks += 1;
      for (const line of creatorMarketLines(creator, deps)) {
        byListed[line.market] = byListed[line.market] || { market: line.market, hands: 0, picks: 0 };
        byListed[line.market].hands += 1;
        if (h.status === "picked") byListed[line.market].picks += 1;
      }
    }
    return json(200, {
      campaigns: perCampaign,
      totals: {
        campaigns: campaigns.length,
        hands: hands.filter((h) => h.status !== "withdrawn").length,
        picks: hands.filter((h) => h.status === "picked").length,
      },
      byHomeMarket: Object.values(byHome).sort((a, z) => z.hands - a.hands),
      byListedMarket: Object.values(byListed).sort((a, z) => z.hands - a.hands),
      homeMarketLabel: "By the market each creator calls home",
      listedMarketLabel: "By every market each creator is listed in (a creator can count in more than one)",
      resultsLabel: "Sales numbers are reported by the brand's store and entered by the Magpie team. They are not live-synced.",
    });
  }

  return err(404, "Not found");
}

function campaign0Focus(user) {
  return (user.business && user.business.focusMarkets) || [];
}

// The business's own view of its campaign: hand counts included —
// the no-counts rule binds creator surfaces, not a business's view
// of its own campaign (spec §5.1).
function businessCampaignView(campaign, hands) {
  const list = hands || [];
  return {
    ...campaign,
    status: campaign.status,
    handCount: list.filter((h) => h.status === "raised" || h.status === "picked").length,
    raisedCount: list.filter((h) => h.status === "raised").length,
    pickedCount: list.filter((h) => h.status === "picked").length,
    notPickedCount: list.filter((h) => h.status === "not_picked").length,
    withdrawnCount: list.filter((h) => h.status === "withdrawn").length,
    publishChecks: null,
  };
}

// ---------- the /api/admin/national/* handler (spec §10) ----------
async function nationalRollup(deps) {
  const users = await deps.allUsers();
  const accounts = users.filter((u) => isNationalBusiness(u));
  const campaigns = (await listCampaigns()).map((c) => campaignOnRead(c));
  const hands = await listAllHands();
  const byStatus = {};
  for (const c of campaigns) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  // Brand-never-picks nudge (spec §13): campaigns whose deadline
  // passed 14+ days ago with no picks made. Surfaced in the admin
  // roll-up so the team can close them out; raisers flip to
  // not_picked when the campaign is closed from here.
  const staleNoPicks = [];
  const now = Date.now();
  for (const c of campaigns) {
    if (c.status !== "closed" || !c.raiseByAt) continue;
    if (now - Date.parse(c.raiseByAt) < 14 * 24 * 3600 * 1000) continue;
    const ch = hands.filter((h) => h.campaignId === c.id);
    if (ch.length && !ch.some((h) => h.status === "picked")) staleNoPicks.push({ campaignId: c.id, title: c.title, businessId: c.businessId, raiseByAt: c.raiseByAt, handsWaiting: ch.filter((h) => h.status === "raised").length });
  }
  return {
    accounts: accounts.length,
    verifiedAccounts: accounts.filter((u) => u.business && u.business.verifiedAt).length,
    campaignsByStatus: byStatus,
    campaigns: campaigns.length,
    hands: hands.filter((h) => h.status === "raised" || h.status === "picked").length,
    picks: hands.filter((h) => h.status === "picked").length,
    staleNoPicks,
  };
}

async function handleAdminNationalApi(ctx) {
  const { user, seg, method, event, deps } = ctx;
  const { json, err, parseBody, nowIso } = deps;
  // seg: ["admin", "national", ...]

  if (seg.length === 2 && method === "GET") {
    const users = await deps.allUsers();
    const accounts = users.filter((u) => isNationalBusiness(u)).map((u) => adminAccountView(u));
    const campaigns = (await listCampaigns()).map((c) => campaignOnRead(c));
    const brands = await usersByIds(campaigns.map((c) => c.businessId));
    const hands = await listAllHands();
    return json(200, {
      rollup: await nationalRollup(deps),
      accounts,
      campaigns: campaigns.map((c) => ({ ...businessCampaignView(c, hands.filter((h) => h.campaignId === c.id)), brandName: brands.get(c.businessId) ? brandDisplayName(brands.get(c.businessId)) : "", verified: !!(brands.get(c.businessId) && brands.get(c.businessId).business && brands.get(c.businessId).business.verifiedAt) })),
      markets: MARKETS.map((m) => m.name),
    });
  }

  // Create a national account (spec §10). Admin only; lands
  // pending in the same review pipeline as any business. No email
  // is sent automatically — first contact is by hand.
  if (seg.length === 3 && seg[2] === "accounts" && method === "POST") {
    const b = parseBody(event);
    const email = String(b.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(400, "A valid email is required");
    const name = deps.plausibleBizName ? deps.plausibleBizName(b.businessName || b.brandName || "") : String(b.businessName || b.brandName || "").trim();
    if (!name) return err(400, "Give the business its real name — creators see it on every campaign.");
    const website = validateWebsiteUrl(b.website);
    if (!website.ok) return err(400, website.error);
    const existing = await store.get(`email:${email}`);
    if (existing) return err(409, "An account with this email already exists. One email is one account on Magpie, so this brand needs its own email or the existing account's owner.");
    // Same website host already on a national account: a warning,
    // not a block (an agency may run two brands) — spec §13.
    const users = await deps.allUsers();
    const sameHost = users.filter((u) => isNationalBusiness(u) && websiteHostOf(u.business.website) === website.host).map((u) => ({ id: u.id, brandName: brandDisplayName(u), email: u.email }));
    const record = buildNationalBusinessUser({ ...b, email, businessName: name, brandName: b.brandName || name, website: website.url }, deps);
    await store.set(`user:${record.id}`, record);
    await store.set(`email:${email}`, { userId: record.id });
    await logEvent({ type: "national_account_created", actorId: user.id, actorRole: "admin", subjectId: record.id, market: null, data: { brandName: record.business.brandName, websiteHost: website.host } });
    return json(201, { account: adminAccountView(record), sameWebsiteWarning: sameHost.length ? sameHost : null });
  }

  if (seg.length === 5 && seg[2] === "accounts") {
    const target = await store.get(`user:${seg[3]}`);
    if (!target || target.role !== "business" || !target.business) return err(404, "Business not found");
    const action = seg[4];

    if (action === "verify" && method === "POST") {
      if (!isNationalBusiness(target)) return err(400, "Only a national account carries the Verified brand check.");
      const b = parseBody(event);
      if (b.verified === false) {
        target.business = { ...target.business, verifiedAt: null, verifiedBy: null, verifyChecklist: null };
        target.updatedAt = nowIso();
        await store.set(`user:${target.id}`, target);
        await logEvent({ type: "national_brand_unverified", actorId: user.id, actorRole: "admin", subjectId: target.id, market: null, data: {} });
        return json(200, { account: adminAccountView(target) });
      }
      const checklist = b.checklist || {};
      const missing = VERIFY_CHECKLIST_KEYS.filter((k) => checklist[k] !== true);
      if (missing.length) return err(400, "Finish the verification checklist first: the website resolves and belongs to the brand, the brand name matches the site, and a real product or store exists at the other end.");
      target.business = { ...target.business, verifiedAt: nowIso(), verifiedBy: user.id, verifyChecklist: { websiteResolves: true, nameMatches: true, storeExists: true } };
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "national_brand_verified", actorId: user.id, actorRole: "admin", subjectId: target.id, market: null, data: { checklist: target.business.verifyChecklist } });
      return json(200, { account: adminAccountView(target) });
    }

    if (action === "convert" && method === "POST") {
      if (isNationalBusiness(target)) return err(409, "This account is already a national account.");
      const offers = (await store.list("offer:")).map((r) => r.value).filter((o) => o && o.businessId === target.id);
      if (offers.length) return err(409, `This business has ${offers.length} offer${offers.length === 1 ? "" : "s"} on record, so it cannot convert to a national account in this build. Conversion is only for accounts with no offers yet.`);
      const b = parseBody(event);
      const oldPlan = { plan: target.business.plan || null, planName: target.business.planName || null, planPriceMonthly: target.business.planPriceMonthly != null ? target.business.planPriceMonthly : null, market: target.market };
      const website = b.website ? validateWebsiteUrl(b.website) : { ok: true, url: target.business.website || "" };
      if (!website.ok) return err(400, website.error);
      target.business = {
        ...target.business,
        scope: "national",
        brandName: String(b.brandName || target.business.brandName || target.business.businessName || "").trim().slice(0, 120),
        website: website.url || target.business.website || "",
        logoUrl: String(b.logoUrl !== undefined ? b.logoUrl : target.business.logoUrl || "").trim().slice(0, 500),
        brandAbout: String(b.brandAbout !== undefined ? b.brandAbout : target.business.brandAbout || target.business.about || "").trim().slice(0, 600),
        focusMarkets: b.focusMarkets !== undefined ? cleanFocusMarkets(b.focusMarkets) : cleanFocusMarkets(target.business.focusMarkets),
        verifiedAt: null, verifiedBy: null, verifyChecklist: null,
        plan: null, planName: null, planPriceMonthly: null, planMinMonths: null,
        billingStatus: "National account. No plan yet: Magpie will share plan options before anything is ever charged.",
        planSelectedAt: null,
      };
      target.market = NATIONAL_MARKET;
      target.city = "";
      // A national account has no territory: any partner stamp
      // comes off, and is preserved in the audit event (spec §7.5).
      const oldPartnerId = target.partnerId || null;
      delete target.partnerId;
      target.updatedAt = nowIso();
      await store.set(`user:${target.id}`, target);
      await logEvent({ type: "national_account_converted", actorId: user.id, actorRole: "admin", subjectId: target.id, market: null, data: { fromMarket: oldPlan.market, oldPlan, oldPartnerId } });
      return json(200, { account: adminAccountView(target) });
    }
    return err(404, "Not found");
  }

  // Campaign moderation (spec §10): close a campaign with an
  // admin note. Closing flips waiting raisers to not_picked with
  // the standard close-out, so nobody waits in silence.
  if (seg.length === 5 && seg[2] === "campaigns" && seg[4] === "close" && method === "POST") {
    const campaign = await getCampaign(seg[3]);
    if (!campaign) return err(404, "Campaign not found");
    const b = parseBody(event);
    const ts = nowIso();
    const hands = await listHandsForCampaign(campaign.id);
    let flipped = 0;
    for (const h of hands) {
      if (h.status !== "raised") continue;
      h.status = "not_picked";
      h.decidedBy = user.id;
      h.updatedAt = ts;
      await store.set(`nhand:${campaign.id}:${h.creatorId}`, h);
      flipped += 1;
      await deps.notifyUser(h.creatorId, "national_not_picked", `A Magpie campaign you raised your hand for has closed. You are first in line for the brand's next campaign.`, { campaignId: campaign.id });
    }
    campaign.status = "closed";
    campaign.closedBy = "admin";
    campaign.adminNote = String(b.note || "").trim().slice(0, 500) || null;
    campaign.updatedAt = ts;
    await store.set(`ncampaign:${campaign.id}`, campaign);
    await deps.notifyUser(campaign.businessId, "national_campaign_closed", `Magpie closed your campaign "${campaign.title}". ${campaign.adminNote ? "Note from the Magpie team: " + campaign.adminNote : "Open your campaigns list for details."}`, { campaignId: campaign.id });
    await logEvent({ type: "national_campaign_admin_closed", actorId: user.id, actorRole: "admin", subjectId: campaign.id, market: null, data: { note: campaign.adminNote, notPicked: flipped } });
    return json(200, { campaign: businessCampaignView(campaignOnRead(campaign), await listHandsForCampaign(campaign.id)), notPicked: flipped });
  }

  // Attributed results entry (spec §4.3): admin/ops enter what the
  // brand's store reported. Labeled as brand-store-reported on
  // every surface that shows it; never presented as live-synced.
  if (seg.length === 5 && seg[2] === "campaigns" && seg[4] === "results" && method === "POST") {
    const campaign = await getCampaign(seg[3]);
    if (!campaign) return err(404, "Campaign not found");
    const b = parseBody(event);
    const creatorId = String(b.creatorId || "");
    const f = await getFulfillment(campaign.id, creatorId);
    if (!f) return err(404, "No fulfillment record for that creator on this campaign.");
    if (b.ordersAttributed !== undefined) { const n = Number(b.ordersAttributed); f.ordersAttributed = Number.isFinite(n) && n >= 0 ? Math.round(n) : null; }
    if (b.revenueAttributed !== undefined) { const n = Number(b.revenueAttributed); f.revenueAttributed = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; }
    if (b.resultNote !== undefined) f.resultNote = String(b.resultNote || "").trim().slice(0, 500);
    if (f.ordersAttributed != null || f.revenueAttributed != null) f.resultsEnteredBy = user.id;
    f.updatedAt = nowIso();
    await store.set(`nfulfill:${campaign.id}:${creatorId}`, f);
    await logEvent({ type: "national_results_entered", actorId: user.id, actorRole: "admin", subjectId: campaign.id, market: null, data: { creatorId, ordersAttributed: f.ordersAttributed, revenueAttributed: f.revenueAttributed } });
    return json(200, { fulfillment: f });
  }

  return err(404, "Not found");
}

function adminAccountView(u) {
  const b = u.business || {};
  return {
    id: u.id,
    email: u.email,
    scope: "national",
    brandName: brandDisplayName(u),
    businessName: b.businessName || "",
    website: b.website || "",
    websiteHost: websiteHostOf(b.website) || null,
    logoUrl: b.logoUrl || null,
    status: u.status,
    accessState: b.accessState === "active" ? "active" : "founding",
    verified: !!b.verifiedAt,
    verifiedAt: b.verifiedAt || null,
    verifiedBy: b.verifiedBy || null,
    focusMarkets: b.focusMarkets || [],
    market: NATIONAL_MARKET,
    plan: null,
    createdAt: u.createdAt,
  };
}

// ---------- Maggie (Sig) scoped facts (spec §8) ----------
// A national business's Maggie reads its own records only: its
// campaigns, hands, picks, fulfillments. No other business, no
// platform aggregates, no creator private data beyond the
// shipping details a PICKED creator submitted for their own gift.
async function sigBusinessNational(user) {
  if (!isNationalBusiness(user)) return null;
  const campaigns = (await listCampaigns()).map((c) => campaignOnRead(c)).filter((c) => c.businessId === user.id);
  const hands = (await listAllHands()).filter((h) => h.businessId === user.id);
  const out = {
    scope: "national",
    brandName: brandDisplayName(user),
    verified: !!(user.business && user.business.verifiedAt),
    campaigns: campaigns.map((c) => ({
      title: c.title, status: c.status, picksCount: c.picksCount,
      hands: hands.filter((h) => h.campaignId === c.id && (h.status === "raised" || h.status === "picked")).length,
      picks: hands.filter((h) => h.campaignId === c.id && h.status === "picked").length,
      raiseByAt: c.raiseByAt || null,
    })),
  };
  return out;
}

// A creator's own national hands are the creator's own data:
// brand, campaign, and their own state in plain words. Other
// creators' hands and hand counts never appear here.
async function sigCreatorNationalHands(user) {
  if (!user || user.role !== "creator") return [];
  const hands = (await listAllHands()).filter((h) => h.creatorId === user.id);
  if (!hands.length) return [];
  const campaigns = await store.getMany(hands.map((h) => `ncampaign:${h.campaignId}`));
  const campaignById = new Map(campaigns.map((r) => [r.value && r.value.id, r.value]));
  const brands = await usersByIds(hands.map((h) => h.businessId));
  return hands.map((h) => {
    const c = campaignById.get(h.campaignId);
    const brand = brands.get(h.businessId);
    return {
      brandName: brand ? brandDisplayName(brand) : "A national brand",
      campaignTitle: c ? c.title : "A campaign",
      status: h.status,
      line: HAND_STATE_LINES[h.status] || "",
    };
  });
}
