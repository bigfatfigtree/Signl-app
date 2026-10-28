// Instagram handle onboarding: the prefill service (Jeff, 2026-10-28).
//
// One input, a public Instagram handle, becomes a DRAFT profile the
// user confirms field by field. This module is the whole server-side
// foundation and is deliberately independent: it is not wired into
// router.js yet (the Sig Operator branch owns those regions while it
// is in flight; the endpoint + client summaries land on top of it).
// Spec: files/signl-handle-onboarding-spec-2026-10-28.md in the goal
// workspace.
//
// THE DATA ROUTE, as proven on 2026-10-28 from a Node runtime:
//   Rung 1 (official Meta API) is unavailable: no Meta credentials in
//     the environment and the Meta app is still in review.
//   Rung 2 (this module) fetches the public profile page with a
//     crawler user agent and parses the Open Graph preview tags.
//     Proven 8/8 parses across @joinsignl and @jsheaphoto22. It yields
//     ONLY: display name, photo URL, follower / following / post
//     counts, and an existence signal. It cannot yield bio, links,
//     category, city, or captions, and this module never pretends
//     otherwise: those fields come back in the `ask` list.
//   Rung 3 is the question ladder, owned by the client/Sig flows.
//
// HARD RULES encoded here:
//   - A fetch produces a draft. Nothing in this module writes to the
//     store; saving happens only through the existing profile and
//     packet endpoints after the user confirms.
//   - Creator prefill NEVER contains local audience %, Spanish
//     audience %, demographics, a paid rate, or a licensing fee.
//     Those keys exist only in the `ask` list, as questions.
//   - On save, applyEdits makes the user's edits win over the fetch.

const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 250;

const cache = new Map(); // handle -> { at, profile }
let lastFetchAt = 0;

function normalizeHandle(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  // Accept a pasted profile URL in any common shape.
  const urlMatch = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (urlMatch) s = urlMatch[1];
  s = s.replace(/^@+/, "").replace(/[/?#].*$/, "").trim().toLowerCase();
  if (!HANDLE_RE.test(s)) return null;
  if (s.startsWith(".") || s.endsWith(".")) return null;
  return s;
}

function decodeEntities(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseCountToken(tok) {
  if (!tok) return null;
  const t = String(tok).replace(/,/g, "").trim();
  const m = t.match(/^(\d+(?:\.\d+)?)([KM])?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  let approx = false;
  if (m[2]) {
    n *= m[2].toUpperCase() === "K" ? 1000 : 1000000;
    approx = true;
  }
  return { count: Math.round(n), approx };
}

function metaContent(html, key) {
  const tags = html.match(/<meta[^>]*>/gi) || [];
  for (const tag of tags) {
    const prop = (tag.match(/(?:property|name)\s*=\s*"([^"]+)"/i) || [])[1];
    if (prop !== key) continue;
    const content = (tag.match(/content\s*=\s*"([^"]*)"/i) || [])[1];
    if (content !== undefined) return decodeEntities(content);
  }
  return null;
}

// Returns the parsed public profile, or null when the page carries no
// profile preview (the proven not-found / data-free discriminator).
function parseOgProfile(html) {
  if (typeof html !== "string" || !html) return null;
  const type = metaContent(html, "og:type");
  const title = metaContent(html, "og:title");
  const description = metaContent(html, "og:description");
  const image = metaContent(html, "og:image");
  if (!title || !description) return null;
  const titleMatch = title.match(/^(.*?)\s*\(@([a-z0-9._]+)\)/i);
  if (!titleMatch) return null;
  const counts = description.match(/([\d][\d.,]*\s*[KM]?)\s+Followers,\s+([\d][\d.,]*\s*[KM]?)\s+Following,\s+([\d][\d.,]*\s*[KM]?)\s+Posts/i);
  if (!counts && type !== "profile") return null;
  const followers = counts ? parseCountToken(counts[1]) : null;
  const following = counts ? parseCountToken(counts[2]) : null;
  const posts = counts ? parseCountToken(counts[3]) : null;
  return {
    handle: titleMatch[2].toLowerCase(),
    displayName: titleMatch[1].trim(),
    photoUrl: image || null,
    followerCount: followers ? followers.count : null,
    followerApprox: followers ? followers.approx : false,
    followingCount: following ? following.count : null,
    postCount: posts ? posts.count : null,
  };
}

async function fetchIgProfile(rawHandle, opts = {}) {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return { ok: false, reason: "invalid_handle" };
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const hit = cache.get(handle);
  if (hit && now() - hit.at < CACHE_TTL_MS && !opts.skipCache) {
    return { ok: true, profile: hit.profile, cached: true };
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return { ok: false, reason: "fetch_failed" };
  const cooldownMs = opts.cooldownMs !== undefined ? opts.cooldownMs : DEFAULT_COOLDOWN_MS;
  const since = now() - lastFetchAt;
  if (cooldownMs > 0 && since < cooldownMs) {
    await new Promise((r) => setTimeout(r, cooldownMs - since));
  }
  lastFetchAt = now();
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
  let res;
  try {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      res = await fetchImpl(`https://www.instagram.com/${handle}/`, {
        headers: { "User-Agent": CRAWLER_UA, "Accept-Language": "en-US" },
        redirect: "follow",
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, reason: "fetch_failed" };
  }
  if (res.status === 429) return { ok: false, reason: "rate_limited" };
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (res.status !== 200) return { ok: false, reason: "fetch_failed", status: res.status };
  let html;
  try {
    html = await res.text();
  } catch (e) {
    return { ok: false, reason: "fetch_failed" };
  }
  const profile = parseOgProfile(html);
  if (!profile) return { ok: false, reason: "not_found" };
  if (profile.handle !== handle) return { ok: false, reason: "not_found" };
  cache.set(handle, { at: now(), profile });
  return { ok: true, profile, cached: false };
}

function fetchedField(value) {
  return { value, source: "instagram_public", confidence: "high" };
}

// Creator draft. The `fields` object is the ONLY thing a save may
// draw from; the never-public numbers live in `ask`, as questions.
function creatorPrefill(profile) {
  if (!profile) return null;
  return {
    side: "creator",
    handle: profile.handle,
    fields: {
      displayName: fetchedField(profile.displayName),
      handle: fetchedField(profile.handle),
      instagramUrl: fetchedField(`https://instagram.com/${profile.handle}`),
      photoUrl: fetchedField(profile.photoUrl),
      followerCount: profile.followerCount === null ? null : { ...fetchedField(profile.followerCount), approx: !!profile.followerApprox },
    },
    ask: [
      { field: "categories", why: "not_fetchable" },
      { field: "city", why: "not_fetchable" },
      { field: "bio", why: "not_fetchable" },
      { field: "localAudiencePct", why: "never_prefill" },
      { field: "spanishAudiencePct", why: "never_prefill" },
      { field: "paidRate", why: "never_prefill" },
      { field: "licensingFee", why: "never_prefill" },
    ],
  };
}

// Business draft. Name and photo are all the public route can honestly
// give a business; the rest is asked (spec section 3).
function businessPrefill(profile) {
  if (!profile) return null;
  return {
    side: "business",
    handle: profile.handle,
    fields: {
      businessName: fetchedField(profile.displayName),
      photoUrl: fetchedField(profile.photoUrl),
      instagramUrl: fetchedField(`https://instagram.com/${profile.handle}`),
      packetHandle: fetchedField(profile.handle),
    },
    ask: [
      { field: "category", why: "not_fetchable" },
      { field: "city", why: "not_fetchable" },
      { field: "about", why: "not_fetchable" },
      { field: "packetLinks", why: "not_fetchable" },
      { field: "packetHashtags", why: "not_fetchable" },
    ],
  };
}

// The confirmation contract: user edits win over the fetch, unknown
// edit keys are dropped and reported, an empty edit clears the field.
function applyEdits(fields, edits) {
  const values = {};
  const dropped = [];
  const src = fields || {};
  const ed = edits && typeof edits === "object" ? edits : {};
  for (const key of Object.keys(ed)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) dropped.push(key);
  }
  for (const key of Object.keys(src)) {
    if (Object.prototype.hasOwnProperty.call(ed, key)) {
      const v = ed[key];
      values[key] = v === "" || v === undefined ? null : v;
    } else {
      values[key] = src[key] ? src[key].value : null;
    }
  }
  return { values, dropped };
}

const PLAY_LABELS = {
  weekend_fill: "Weekend Fill",
  grand_opening: "Grand Opening",
  event_night: "Event Night",
  build_regulars: "Build Regulars",
};
const FOOD_CATEGORIES = ["Restaurant", "Bar", "Coffee & Bakery"];

// The one-play suggestion (spec section 3): a deterministic rule over
// confirmed signals only. Integration calls this after the business
// confirms; accepting routes into the brief flow, nothing is created.
function suggestPlayForBusiness(signals = {}) {
  const category = signals.category || "";
  let play = "build_regulars";
  let reason = "A steady first campaign while Sig learns your crowd.";
  if (signals.opening) {
    play = "grand_opening";
    reason = "You are opening, so the first campaign should make the opening the event.";
  } else if (signals.liveMusic || category === "Attraction") {
    play = "event_night";
    reason = "Your draw is a night and a crowd, so the campaign points at one event.";
  } else if (FOOD_CATEGORIES.includes(category) && signals.weekendHeavy) {
    play = "weekend_fill";
    reason = "Your posts and your answers both point at weekends, so the campaign aims there.";
  } else if (FOOD_CATEGORIES.includes(category)) {
    play = "build_regulars";
    reason = "Food and drink builds on regulars first, then weekends once the base is posting.";
  }
  return { play, playLabel: PLAY_LABELS[play], reason };
}

module.exports = {
  CRAWLER_UA,
  normalizeHandle,
  decodeEntities,
  parseCountToken,
  parseOgProfile,
  fetchIgProfile,
  creatorPrefill,
  businessPrefill,
  applyEdits,
  suggestPlayForBusiness,
  PLAY_LABELS,
  _clearCache: () => cache.clear(),
};
