// Multi-market audience shares (Jeff, 2026-11-01): a creator is
// listed and ranked in EVERY SIGNL market where the local share of
// their audience is strong, and can receive offers in all of them,
// not just their home market.
//
// The data is honest and creator-controlled, like the home-market
// localAudiencePct it extends: the creator reports, per SIGNL
// market, the share of their audience that lives there, stored on
// creator.audienceMarkets as [{ market, pct }]. Nothing here is
// computed from outside data and no share is ever invented: a
// market with no reported share simply does not exist for that
// creator.
//
// The home market is NOT part of audienceMarkets: its share is
// the long-standing localAudiencePct, and the home market is
// always the creator's primary listing. audienceMarkets carries
// only OTHER markets.
//
// Listing threshold: a reported share at or above
// MULTI_MARKET_MIN_PCT lists the creator in that market
// (discovery, the Local List, the open-offer board, applying and
// accepting). 5% is the floor the codebase already treats as a
// real local presence: below 5% at scale is the geography-
// mismatch flag in the admin integrity scan. A smaller reported
// share is still stored (it is the creator's own number) and
// still shows in their audience breakdown math as part of
// "everywhere else"; it just does not open a market.
const { MARKETS, normalizeMarketName } = require("./markets");

const MULTI_MARKET_MIN_PCT = 5;
const MAX_AUDIENCE_MARKETS = 10;

function canonicalMarketName(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const canonical = normalizeMarketName(name);
  const hit = MARKETS.find((m) => m.name === canonical || m.id === name.trim());
  return hit ? hit.name : null;
}

function cleanPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

// Normalize creator-supplied per-market shares for storage.
// Drops: the home market (its share lives in localAudiencePct),
// unknown markets, non-numbers, and zero/negative shares.
// Duplicates keep the largest reported share. Order is by share,
// strongest first, so every surface reads the same ranking.
function normalizeAudienceMarkets(input, homeMarket) {
  if (!Array.isArray(input)) return [];
  const home = canonicalMarketName(homeMarket) || normalizeMarketName(String(homeMarket || ""));
  const byMarket = new Map();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const market = canonicalMarketName(raw.market);
    if (!market || market === home) continue;
    const pct = cleanPct(raw.pct);
    if (pct === null || pct <= 0) continue;
    if (!byMarket.has(market) || pct > byMarket.get(market)) byMarket.set(market, pct);
  }
  return [...byMarket.entries()]
    .map(([market, pct]) => ({ market, pct }))
    .sort((a, b) => (b.pct - a.pct) || (a.market < b.market ? -1 : 1))
    .slice(0, MAX_AUDIENCE_MARKETS);
}

// The creator's stored extra-market shares, normalized at read so
// legacy or hand-written records can never smuggle in a phantom
// market or a share for the home market.
function storedAudienceMarkets(user) {
  const c = (user && user.creator) || {};
  return normalizeAudienceMarkets(c.audienceMarkets, user && user.market);
}

// The share of the creator's audience in one market, or null when
// they have reported none there. The home market answers with
// localAudiencePct; any other market answers from
// audienceMarkets. This is THE number ranking reads in a market.
function audienceShareInMarket(user, marketName) {
  if (!user || !user.creator) return null;
  const market = canonicalMarketName(marketName);
  if (!market) return null;
  const home = canonicalMarketName(user.market) || normalizeMarketName(String(user.market || ""));
  if (market === home) {
    const pct = user.creator.localAudiencePct;
    return pct === null || pct === undefined || !Number.isFinite(Number(pct)) ? null : Number(pct);
  }
  const hit = storedAudienceMarkets(user).find((e) => e.market === market);
  return hit ? hit.pct : null;
}

// Is this creator listed in this market? The home market always
// lists its own roster creator (their completeness gates live
// elsewhere); another market lists them when their reported
// share there clears the floor. A creator with no real home
// market (the unlisted pool) lists in their own city only, as
// before: multi-market listing extends a market identity, it
// does not create one.
function isListedInMarket(user, marketName) {
  if (!user || user.role !== "creator" || !user.creator) return false;
  const market = canonicalMarketName(marketName);
  if (!market) return false;
  const home = canonicalMarketName(user.market);
  if (!home) return false;
  if (market === home) return true;
  const share = audienceShareInMarket(user, market);
  return share !== null && share >= MULTI_MARKET_MIN_PCT;
}

// Every market this creator is listed in, home first, then the
// qualifying extra markets strongest first. Each entry carries
// the share that ranks them there. The home entry's pct is null
// until the creator reports localAudiencePct (their profile is
// incomplete until they do, and every roster gate already knows).
function listedMarketsFor(user) {
  if (!user || !user.creator) return [];
  const homeName = canonicalMarketName(user.market);
  const out = [];
  if (homeName) {
    out.push({ market: homeName, pct: audienceShareInMarket(user, homeName), home: true });
  } else {
    return out;
  }
  for (const e of storedAudienceMarkets(user)) {
    if (e.pct >= MULTI_MARKET_MIN_PCT) out.push({ market: e.market, pct: e.pct, home: false });
  }
  return out;
}

// The audience picture for the public profile's visual: the
// listed markets as segments (home first), and everything else
// as one remainder segment. Segments are the creator's own
// reported numbers; the remainder is arithmetic, never a claim:
// max(0, 100 - sum of listed shares). Returns null when the
// creator has reported no local share at all (nothing honest to
// draw yet).
function audienceBreakdownFor(user) {
  const listed = listedMarketsFor(user);
  if (!listed.length || listed[0].pct === null) return null;
  const segments = listed
    .filter((e) => typeof e.pct === "number")
    .map((e) => ({ market: e.market, pct: e.pct, home: !!e.home, verified: verifiedInMarket(user, e.market) }));
  if (!segments.length) return null;
  const used = segments.reduce((s, e) => s + e.pct, 0);
  return { segments, elsewherePct: Math.max(0, Math.round((100 - used) * 10) / 10) };
}

// ---------- Instagram audience verification (Build -108, item 12) ----------
// The creator's self-reported shares stay the stored, displayed
// numbers, always. When Instagram city data has been fetched for
// their connected account, each market where BOTH numbers exist
// is compared: within VERIFICATION_TOLERANCE_PTS points, that
// market's share earns the Verified label. Verified is a label
// and a ranking tiebreak only: it never rewrites the creator's
// stated share and never outweighs the score itself.
//
// The record lives on creator.audienceVerification:
//   { source: "instagram", status, verifiedAt, lastCheckedAt,
//     perMarket: { <market>: { igPct, selfPct, withinTolerance } },
//     followerCountVerified, note }
// status is "verified" while at least one market is within
// tolerance and the check is fresh; a verified record older
// than VERIFICATION_STALE_DAYS reads "stale" (the label comes
// off until the next sync) and anything else is "self_reported".
const VERIFICATION_TOLERANCE_PTS = 10;
const VERIFICATION_STALE_DAYS = 45;

function verificationStatusOf(user, nowMs) {
  const av = user && user.creator ? user.creator.audienceVerification : null;
  if (!av || typeof av !== "object") return "self_reported";
  if (av.status !== "verified") return "self_reported";
  const at = Date.parse(av.verifiedAt || av.lastCheckedAt || "");
  if (Number.isFinite(at) && typeof nowMs === "number" && nowMs - at > VERIFICATION_STALE_DAYS * 86400000) return "stale";
  return "verified";
}

function verifiedInMarket(user, marketName, nowMs) {
  if (!user || !user.creator) return false;
  const market = canonicalMarketName(marketName);
  if (!market) return false;
  if (verificationStatusOf(user, typeof nowMs === "number" ? nowMs : Date.now()) !== "verified") return false;
  const per = (user.creator.audienceVerification || {}).perMarket || {};
  return !!(per[market] && per[market].withinTolerance === true);
}

// Build the verification record from one Instagram geography
// fetch. igShares maps canonical market names to the share
// Instagram's city data sums to. state is "ok", "no_city_data"
// (Meta returned no city rows) or "below_100" (accounts under
// 100 followers get no city data from Meta at all).
function computeAudienceVerification(user, igShares, opts) {
  const o = opts || {};
  const nowIso = o.nowIso || new Date().toISOString();
  const state = o.state || "ok";
  const perMarket = {};
  let anyVerified = false;
  if (state === "ok" && igShares) {
    for (const e of listedMarketsFor(user)) {
      if (typeof e.pct !== "number") continue;
      const ig = igShares[e.market];
      if (typeof ig !== "number" || !Number.isFinite(ig)) continue;
      const within = Math.abs(ig - e.pct) <= VERIFICATION_TOLERANCE_PTS;
      if (within) anyVerified = true;
      perMarket[e.market] = { igPct: Math.round(ig * 10) / 10, selfPct: e.pct, withinTolerance: within };
    }
  }
  const prev = (user && user.creator && user.creator.audienceVerification) || null;
  return {
    source: "instagram",
    status: anyVerified ? "verified" : "self_reported",
    verifiedAt: anyVerified ? nowIso : (prev && prev.status === "verified" ? prev.verifiedAt || null : null),
    lastCheckedAt: nowIso,
    perMarket,
    followerCountVerified: typeof o.followerCount === "number" ? o.followerCount : (prev ? prev.followerCountVerified || null : null),
    note: state === "ok" ? null : state,
  };
}

// ---------- Platforms, links + per-platform local % (Build -140) ----------
// Jeff's platform model (2026-11-06, Items E/F as amended):
// a creator can add every platform they are on — handle, link
// and follower count — and every count stacks into the total
// audience. The local % is NEVER diluted: the headline rate R
// is the follower-weighted local % over the platforms that
// carry a local rate, and the matched channels (Instagram,
// Facebook, YouTube when added) are the confirmed source. Any
// other platform joins the rate the moment the creator supplies
// a local % for it; platforms without a rate are excluded from
// the % entirely (numerator and denominator) and, in the hero
// neighbor count only, are estimated at R and labelled
// "potential" until the creator adds their real rate.
const AUDIENCE_PLATFORM_KEYS = [
  "instagram", "tiktok", "facebook", "x", "linkedin", "youtube", "snapchat",
  "pinterest", "reddit", "twitch", "kick", "threads", "bluesky", "discord",
  "spotify", "patreon", "substack", "website",
];
// Platforms that carry a follower count (a website is link-only).
const COUNT_PLATFORM_KEYS = AUDIENCE_PLATFORM_KEYS.filter((k) => k !== "website");
const PLATFORM_LABELS = {
  instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", x: "X",
  linkedin: "LinkedIn", youtube: "YouTube", snapchat: "Snapchat",
  pinterest: "Pinterest", reddit: "Reddit", twitch: "Twitch", kick: "Kick",
  threads: "Threads", bluesky: "Bluesky", discord: "Discord",
  spotify: "Spotify", patreon: "Patreon", substack: "Substack", website: "Website",
};
// The matched channels: their local rates are the confirmed rate.
const MATCHED_LOCAL_PLATFORMS = ["instagram", "facebook", "youtube"];

// The stack stored on a creator record, normalized over the
// count platforms, with the legacy fallback (no stack yet means
// followerCount IS the Instagram count). Mirrors the router's
// audienceStackOf — kept here so the rate model and the router
// can never disagree about who has how many followers where.
function stackOf(creator) {
  const c = creator || {};
  const raw = c.audienceStack && typeof c.audienceStack === "object" ? c.audienceStack : {};
  const out = {};
  for (const k of COUNT_PLATFORM_KEYS) {
    const n = Math.floor(Number(raw[k]));
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  if (!Object.keys(out).length && (c.followerCount || 0) > 0) {
    const fc = Math.floor(Number(c.followerCount)) || 0;
    if (fc > 0) out.instagram = fc;
  }
  return out;
}

// Per-platform local rates for storage: known count platforms,
// values clamped 0-100. A filled 0 is a REAL rate (a creator can
// honestly have no local audience on a platform) and is kept.
function normalizePlatformLocalPct(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const k of COUNT_PLATFORM_KEYS) {
    if (input[k] === undefined || input[k] === null || input[k] === "") continue;
    const pct = cleanPct(input[k]);
    if (pct !== null) out[k] = pct;
  }
  return out;
}

// Platform links for storage: [{ platform, handle, url }] in or
// a { platform: { handle, url } } map. A bare domain typed as a
// URL earns its https://; anything that still is not an http(s)
// URL drops out (the handle, if any, still stands).
function normalizePlatformLinks(input) {
  const entries = Array.isArray(input)
    ? input.map((e) => [e && e.platform, e || {}])
    : (input && typeof input === "object" ? Object.entries(input) : []);
  const out = {};
  for (const [platform, raw] of entries) {
    if (!AUDIENCE_PLATFORM_KEYS.includes(platform) || !raw || typeof raw !== "object") continue;
    const handle = String(raw.handle || "").trim().slice(0, 90);
    let url = String(raw.url || "").trim().slice(0, 320);
    if (url && !/^https?:\/\//i.test(url) && !/\s/.test(url) && url.includes(".")) url = `https://${url}`;
    if (url && !/^https?:\/\/\S+$/i.test(url)) url = "";
    if (!handle && !url) continue;
    out[platform] = { ...(handle ? { handle } : {}), ...(url ? { url } : {}) };
  }
  return out;
}

// THE local-follower model. R = the confirmed rate: the
// follower-weighted local % across matched channels that carry
// a rate; if no matched channel carries one but some other
// platform does, R falls back to the weighted filled rates
// (fallbackUsed says so — a conscious, reported choice, never
// silent). neighborCount sums EVERY added platform at its own
// rate, or at R when it has none (those platforms are the
// extrapolated set, and the hero labels their followers
// "potential neighbors"). Returns R null when no rate exists
// anywhere — the legacy manual localAudiencePct then rules.
function localRateModel(creator) {
  const c = creator || {};
  const stack = stackOf(c);
  const rates = normalizePlatformLocalPct(c.platformLocalPct);
  const present = COUNT_PLATFORM_KEYS.filter((k) => (stack[k] || 0) > 0);
  const hasRate = (k) => rates[k] !== undefined;
  const weighted = (keys) => {
    let num = 0, den = 0;
    for (const k of keys) { num += (stack[k] || 0) * rates[k]; den += (stack[k] || 0); }
    if (den > 0) return num / den;
    if (keys.length) return keys.reduce((s, k) => s + rates[k], 0) / keys.length;
    return null;
  };
  const matchedWithRate = MATCHED_LOCAL_PLATFORMS.filter(hasRate);
  let R = weighted(matchedWithRate);
  let fallbackUsed = false;
  if (R === null) {
    const anyWithRate = COUNT_PLATFORM_KEYS.filter(hasRate);
    if (anyWithRate.length) { R = weighted(anyWithRate); fallbackUsed = R !== null; }
  }
  if (R !== null) R = Math.round(R * 10) / 10;
  let neighborCount = null;
  if (R !== null) {
    let sum = 0;
    for (const k of present) sum += (stack[k] || 0) * (hasRate(k) ? rates[k] : R) / 100;
    neighborCount = Math.round(sum);
  }
  const extrapolatedPlatforms = R === null ? [] : present.filter((k) => !hasRate(k));
  return {
    stack, rates, present, R, fallbackUsed, neighborCount,
    extrapolatedPlatforms,
    allReal: present.length > 0 && extrapolatedPlatforms.length === 0,
  };
}

// Geography-breakdown completion (the Momentum award + Sig
// prompt read this one definition): local rates supplied for
// the matched channels the creator actually has (Instagram,
// Facebook, YouTube if added), plus their market splits saved.
// A creator with no matched channel present completes on any
// supplied rate instead. Supplying an extra platform's rate is
// a bonus, never a requirement. `links` is the caller's merged
// platform-links map (router's platformLinksOf), so presence
// can rest on a link alone; the stored platformLinks ride the
// record and are merged in here as a floor.
function geoBreakdownState(user, links) {
  const c = (user && user.creator) || {};
  const model = localRateModel(c);
  const mergedLinks = { ...normalizePlatformLinks(c.platformLinks), ...(links || {}) };
  const presentSet = new Set([...model.present, ...Object.keys(mergedLinks)]);
  const presentMatched = MATCHED_LOCAL_PLATFORMS.filter((k) => presentSet.has(k));
  const missingPlatforms = presentMatched.filter((k) => model.rates[k] === undefined);
  const splitsDone = Array.isArray(c.audienceMarkets);
  const anyRate = Object.keys(model.rates).length > 0;
  const complete = splitsDone && missingPlatforms.length === 0 && (presentMatched.length > 0 || anyRate);
  return {
    complete,
    missingPlatforms,
    splitsMissing: !splitsDone,
    unfilledPlatforms: model.extrapolatedPlatforms,
    R: model.R,
    rates: model.rates,
  };
}

module.exports = {
  MULTI_MARKET_MIN_PCT,
  MAX_AUDIENCE_MARKETS,
  VERIFICATION_TOLERANCE_PTS,
  VERIFICATION_STALE_DAYS,
  canonicalMarketName,
  normalizeAudienceMarkets,
  storedAudienceMarkets,
  audienceShareInMarket,
  isListedInMarket,
  listedMarketsFor,
  audienceBreakdownFor,
  verificationStatusOf,
  verifiedInMarket,
  computeAudienceVerification,
  AUDIENCE_PLATFORM_KEYS,
  COUNT_PLATFORM_KEYS,
  PLATFORM_LABELS,
  MATCHED_LOCAL_PLATFORMS,
  stackOf,
  normalizePlatformLocalPct,
  normalizePlatformLinks,
  localRateModel,
  geoBreakdownState,
};
