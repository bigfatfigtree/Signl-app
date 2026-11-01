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
    .map((e) => ({ market: e.market, pct: e.pct, home: !!e.home }));
  if (!segments.length) return null;
  const used = segments.reduce((s, e) => s + e.pct, 0);
  return { segments, elsewherePct: Math.max(0, Math.round((100 - used) * 10) / 10) };
}

module.exports = {
  MULTI_MARKET_MIN_PCT,
  MAX_AUDIENCE_MARKETS,
  canonicalMarketName,
  normalizeAudienceMarkets,
  storedAudienceMarkets,
  audienceShareInMarket,
  isListedInMarket,
  listedMarketsFor,
  audienceBreakdownFor,
};
