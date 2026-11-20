// Count lookup (Build -215): a public, pre-auth follower-count
// lookup for the claim flow. One platform + handle in, one plain
// answer out: { count, platform, handle, reason } where reason is
// "found" | "manual" | "not_found" | "blocked" | "error".
//
// What is actually possible without the creator signing in
// (tested live 2026-11-20):
//   - TikTok: the public profile page carries the exact follower
//     count in its rehydration JSON. The count is trusted ONLY
//     when the page's own uniqueId matches the requested handle.
//   - YouTube: the official Data API v3, and ONLY when
//     YOUTUBE_API_KEY is configured. No key = manual, and the
//     HTML is never scraped (rounded counts, unstable anchors).
//   - Instagram / Facebook / X / LinkedIn / Snapchat: closed to
//     unauthenticated lookup (login walls, 429s, paid APIs).
//     They answer "manual" immediately; no workaround attempts.
//
// Results cache in the shared store under
// lookup:{platform}:{handleLower} with a cachedAt stamp:
// successes for 24 hours, failures for 1 hour. Cache trouble
// never breaks a lookup, and a lookup never blocks a claim:
// every failure mode is a soft reason, never a throw.

const store = require("./store");

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 5000;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;

const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "x", "linkedin", "snapchat"];
const PLATFORM_ALIASES = { twitter: "x", yt: "youtube", tt: "tiktok", fb: "facebook", ig: "instagram", li: "linkedin", snap: "snapchat" };
const MANUAL_PLATFORMS = ["instagram", "facebook", "x", "linkedin", "snapchat"];

function normalizePlatform(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (PLATFORMS.includes(s)) return s;
  return PLATFORM_ALIASES[s] || null;
}

// Accepts a bare handle, an @handle, or a pasted profile URL in
// any common shape ("tiktok.com/@name", "https://x.com/name").
// Returns the bare handle, or null when nothing handle-shaped
// survives.
function normalizeHandle(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/\s+/g, "");
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (s.includes("/")) {
    const parts = s.split("/").filter(Boolean);
    const atPart = parts.find((p) => p.startsWith("@"));
    if (atPart) s = atPart;
    else if (parts.length && parts[0].includes(".")) s = parts[parts.length - 1];
    else s = parts[0];
  }
  s = s.replace(/^@+/, "").replace(/[/?#].*$/, "").trim();
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(s)) return null;
  return s;
}

async function fetchWithTimeout(fetchImpl, url, headers) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    return await fetchImpl(url, { headers, redirect: "follow", ...(ctrl ? { signal: ctrl.signal } : {}) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Parse TikTok's rehydration JSON out of the profile page.
// Returns { count } on a verified match, { reason } otherwise.
// The uniqueId check is the trust anchor: a page that resolved
// to a different account (redirect, fuzzy match) never counts.
function parseTikTokProfile(html, handle) {
  if (typeof html !== "string" || !html) return { reason: "blocked" };
  const m = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { reason: "blocked" };
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { return { reason: "blocked" }; }
  const scope = data && data.__DEFAULT_SCOPE__;
  const detail = scope && scope["webapp.user-detail"];
  if (!detail || !detail.userInfo || !detail.userInfo.user) return { reason: "not_found" };
  if (detail.statusCode) return { reason: "not_found" };
  const uniqueId = String(detail.userInfo.user.uniqueId || "");
  if (!uniqueId || uniqueId.toLowerCase() !== String(handle).toLowerCase()) return { reason: "not_found" };
  const stats = detail.userInfo.statsV2 || detail.userInfo.stats || {};
  const count = Number(stats.followerCount);
  if (!Number.isFinite(count) || count < 0) return { reason: "error" };
  return { count: Math.floor(count) };
}

async function lookupTikTok(handle, opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return { count: null, reason: "error" };
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `https://www.tiktok.com/@${encodeURIComponent(handle)}`, { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US" });
  } catch (e) {
    return { count: null, reason: "error" };
  }
  if (res.status === 404) return { count: null, reason: "not_found" };
  if (res.status === 403 || res.status === 429) return { count: null, reason: "blocked" };
  if (res.status !== 200) return { count: null, reason: "error" };
  let html;
  try { html = await res.text(); } catch (e) { return { count: null, reason: "error" }; }
  const parsed = parseTikTokProfile(html, handle);
  if (parsed.count !== undefined) return { count: parsed.count, reason: "found" };
  return { count: null, reason: parsed.reason || "error" };
}

async function lookupYouTube(handle, opts) {
  const apiKey = opts.apiKey !== undefined ? opts.apiKey : process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { count: null, reason: "manual" };
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return { count: null, reason: "error" };
  let res;
  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=${encodeURIComponent("@" + handle)}&key=${encodeURIComponent(apiKey)}`;
    res = await fetchWithTimeout(fetchImpl, url, { "User-Agent": DESKTOP_UA });
  } catch (e) {
    return { count: null, reason: "error" };
  }
  if (res.status === 403 || res.status === 429) return { count: null, reason: "blocked" };
  if (res.status !== 200) return { count: null, reason: "error" };
  let body;
  try { body = await res.json(); } catch (e) { return { count: null, reason: "error" }; }
  const item = body && Array.isArray(body.items) ? body.items[0] : null;
  if (!item || !item.statistics) return { count: null, reason: "not_found" };
  if (item.statistics.hiddenSubscriberCount) return { count: null, reason: "not_found" };
  const count = Number(item.statistics.subscriberCount);
  if (!Number.isFinite(count) || count < 0) return { count: null, reason: "error" };
  return { count: Math.floor(count), reason: "found" };
}

async function readCache(key) {
  try {
    const hit = await store.get(key);
    if (!hit || typeof hit.cachedAt !== "number") return null;
    const ttl = hit.count !== null && hit.count !== undefined ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    if (Date.now() - hit.cachedAt >= ttl) return null;
    return hit;
  } catch (e) {
    return null;
  }
}

async function writeCache(key, result) {
  try {
    await store.set(key, { count: result.count, reason: result.reason, cachedAt: Date.now() });
  } catch (e) { /* a cache write never breaks the lookup */ }
}

// The one entry point. Always resolves to the contract shape;
// it never throws.
async function lookupCount(platformRaw, handleRaw, opts = {}) {
  const platform = normalizePlatform(platformRaw);
  const handle = normalizeHandle(handleRaw);
  const echoPlatform = platform || (typeof platformRaw === "string" ? platformRaw.trim().toLowerCase().slice(0, 30) : "");
  const echoHandle = handle || "";
  if (!platform || !handle) return { count: null, platform: echoPlatform, handle: echoHandle, reason: "error" };
  if (MANUAL_PLATFORMS.includes(platform)) return { count: null, platform, handle, reason: "manual" };
  if (platform === "youtube" && !(opts.apiKey !== undefined ? opts.apiKey : process.env.YOUTUBE_API_KEY)) {
    return { count: null, platform, handle, reason: "manual" };
  }
  const cacheKey = `lookup:${platform}:${handle.toLowerCase()}`;
  if (!opts.skipCache) {
    const hit = await readCache(cacheKey);
    if (hit) return { count: hit.count, platform, handle, reason: hit.reason, cached: true };
  }
  const result = platform === "tiktok" ? await lookupTikTok(handle, opts) : await lookupYouTube(handle, opts);
  if (!opts.skipCache) await writeCache(cacheKey, result);
  return { count: result.count, platform, handle, reason: result.reason, cached: false };
}

module.exports = { lookupCount, normalizeHandle, normalizePlatform, parseTikTokProfile, PLATFORMS };
