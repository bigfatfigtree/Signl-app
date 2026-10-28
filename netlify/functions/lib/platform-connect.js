// Connect Accounts: creator platform connections for audience sync
// (Jeff, 2026-10-28: "connect these things to their platforms so it
// always updates their numbers" — hugely important, his words).
//
// One creator connects a platform once (OAuth, server-side). From
// then on that platform's audience count is fetched by the provider,
// written over the hand-typed number on every sync, and labeled
// Synced everywhere it shows. Platforms that are not connected stay
// exactly as they were: typed by the creator, labeled Self-reported.
//
// HONESTY BOUNDARY (the rule this module exists to keep): a count
// may only be labeled "Synced" when a real provider fetch produced
// it. Nothing here scrapes, guesses, or simulates a count. A
// platform whose provider is not live reports its gate plainly
// (Meta: in review; TikTok: application being prepared) and its
// rows stay Self-reported until a real fetch lands.
//
// TOKEN STORAGE: OAuth tokens live ONLY in platconn: records
// (server-side store), never on any client payload. The creator
// record carries a display-only mirror (creator.platformSync:
// last sync time, last count, account label) so every payload that
// already ships the creator record can render the Synced mark with
// no extra reads and no secrets anywhere near it.
//
// PROVIDERS
//   YouTube — LIVE path, built end to end in this module. Google
//     OAuth (youtube.readonly) + YouTube Data API v3
//     channels?mine statistics.subscriberCount. Credentials come
//     from env: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
//     (+ optional YOUTUBE_REDIRECT_URI; defaults to
//     {APP_URL}/api/me/platforms/youtube/callback). With the env
//     absent the connect button renders an honest "being enabled"
//     state instead of a dead OAuth link.
//   Meta (Instagram + Facebook) — GATED. The Meta app's Access
//     Verification is In Review; the rows render "In review with
//     Meta" and no OAuth flow exists yet. The flip list lives in
//     files/meta-connect-gap-note-2026-10-28.md (goal workspace).
//   TikTok — NOT BUILT against an unapproved API. The developer
//     application packet is files/tiktok-developer-application-
//     packet-2026-10-28.md (goal workspace). Rows stay Self-reported.
//
// TEST SEAMS (unset in production): GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL
// and YOUTUBE_API_BASE_URL override the Google endpoints so the
// verify suite can run the full flow against a local stub.

const crypto = require("crypto");
const store = require("./store");

const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;

function appBaseUrl() {
  return (process.env.APP_URL || "https://app.joinsignl.com").replace(/\/+$/, "");
}

function youtubeConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function youtubeRedirectUri() {
  if (process.env.YOUTUBE_REDIRECT_URI) return process.env.YOUTUBE_REDIRECT_URI;
  return `${appBaseUrl()}/api/me/platforms/youtube/callback`;
}

function googleAuthUrl() {
  return process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
}
function googleTokenUrl() {
  return process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
}
function youtubeApiBase() {
  return (process.env.YOUTUBE_API_BASE_URL || "https://www.googleapis.com").replace(/\/+$/, "");
}

// ---------- connection records ----------

function connKey(userId, platform) {
  return `platconn:${userId}:${platform}`;
}

async function getConnection(userId, platform) {
  return (await store.get(connKey(userId, platform))) || null;
}

async function saveConnection(conn) {
  conn.updatedAt = new Date().toISOString();
  await store.set(connKey(conn.userId, conn.platform), conn);
  return conn;
}

async function deleteConnection(userId, platform) {
  await store.del(connKey(userId, platform));
}

async function listConnectionsForUser(userId) {
  const rows = await store.list(`platconn:${userId}:`);
  return rows.map((r) => r.value).filter(Boolean);
}

async function listAllConnections() {
  const rows = await store.list("platconn:");
  return rows.map((r) => r.value).filter(Boolean);
}

// ---------- OAuth state (single-use, short-lived) ----------

async function createOAuthState(userId, platform) {
  const token = crypto.randomBytes(24).toString("hex");
  await store.set(`oauthstate:${token}`, {
    userId,
    platform,
    createdAt: Date.now(),
  });
  return token;
}

async function consumeOAuthState(token) {
  if (!token || typeof token !== "string") return null;
  const rec = await store.get(`oauthstate:${token}`);
  if (!rec) return null;
  await store.del(`oauthstate:${token}`);
  if (Date.now() - (rec.createdAt || 0) > OAUTH_STATE_TTL_MS) return null;
  return rec;
}

// ---------- YouTube OAuth + Data API ----------

function buildYouTubeAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    redirect_uri: youtubeRedirectUri(),
    response_type: "code",
    scope: YOUTUBE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${googleAuthUrl()}?${params.toString()}`;
}

async function postTokenRequest(fields) {
  const res = await fetch(googleTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) {
    throw new Error(`Google token request failed (HTTP ${res.status})`);
  }
  return data;
}

async function exchangeYouTubeCode(code) {
  return postTokenRequest({
    code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    redirect_uri: youtubeRedirectUri(),
    grant_type: "authorization_code",
  });
}

async function refreshYouTubeAccessToken(conn) {
  if (!conn.refreshToken) throw new Error("No refresh token stored for this YouTube connection");
  const data = await postTokenRequest({
    refresh_token: conn.refreshToken,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    grant_type: "refresh_token",
  });
  conn.accessToken = data.access_token;
  if (data.refresh_token) conn.refreshToken = data.refresh_token;
  conn.tokenExpiresAt = Date.now() + Math.max(60, data.expires_in || 3600) * 1000;
  await saveConnection(conn);
  return conn;
}

async function fetchYouTubeChannel(accessToken) {
  const url = `${youtubeApiBase()}/youtube/v3/channels?part=snippet,statistics&mine=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`YouTube channels request failed (HTTP ${res.status})`);
  const data = await res.json().catch(() => null);
  const item = data && Array.isArray(data.items) ? data.items[0] : null;
  if (!item) return null;
  const stats = item.statistics || {};
  return {
    id: item.id || null,
    title: (item.snippet && item.snippet.title) || null,
    customUrl: (item.snippet && item.snippet.customUrl) || null,
    hiddenSubscriberCount: stats.hiddenSubscriberCount === true,
    subscriberCount: stats.subscriberCount === undefined ? null : Number(stats.subscriberCount),
  };
}

// The sync fetch: returns { status: "ok", count } and persists the
// fresh count + sync stamp on the connection record, or a plain
// non-ok status ("hidden" when the channel hides its subscriber
// count, "error" when the provider could not be read). Token
// refresh happens here, once, when the stored token is expired or
// rejected; a revoked grant surfaces as "error" and the row falls
// back to its last synced display until the creator reconnects.
async function fetchYouTubeSubscriberCount(conn) {
  try {
    if (!conn.accessToken || (conn.tokenExpiresAt && Date.now() > conn.tokenExpiresAt - 60000)) {
      await refreshYouTubeAccessToken(conn);
    }
    let channel;
    try {
      channel = await fetchYouTubeChannel(conn.accessToken);
    } catch (e) {
      await refreshYouTubeAccessToken(conn);
      channel = await fetchYouTubeChannel(conn.accessToken);
    }
    if (!channel) {
      conn.lastSyncStatus = "error";
      conn.lastSyncAt = new Date().toISOString();
      await saveConnection(conn);
      return { status: "error" };
    }
    conn.accountId = channel.id || conn.accountId;
    conn.accountLabel = channel.title || conn.accountLabel;
    conn.lastSyncAt = new Date().toISOString();
    if (channel.hiddenSubscriberCount || channel.subscriberCount === null || !Number.isFinite(channel.subscriberCount)) {
      conn.lastSyncStatus = "hidden";
      await saveConnection(conn);
      return { status: "hidden" };
    }
    conn.lastCount = Math.floor(channel.subscriberCount);
    conn.lastSyncStatus = "ok";
    await saveConnection(conn);
    return { status: "ok", count: conn.lastCount };
  } catch (e) {
    try {
      conn.lastSyncStatus = "error";
      conn.lastSyncAt = new Date().toISOString();
      await saveConnection(conn);
    } catch (ignored) { /* the status report below is the contract */ }
    return { status: "error" };
  }
}

async function saveYouTubeConnection(userId, tokens, channel) {
  const now = new Date().toISOString();
  const existing = await getConnection(userId, "youtube");
  const conn = {
    userId,
    platform: "youtube",
    accountId: channel.id || null,
    accountLabel: channel.title || null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || (existing && existing.refreshToken) || null,
    tokenExpiresAt: Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000,
    connectedAt: (existing && existing.connectedAt) || now,
    lastSyncAt: (existing && existing.lastSyncAt) || null,
    lastCount: existing && typeof existing.lastCount === "number" ? existing.lastCount : null,
    lastSyncStatus: (existing && existing.lastSyncStatus) || null,
  };
  await saveConnection(conn);
  return conn;
}

// ---------- public per-platform state (NO tokens, ever) ----------

// The state machine every row of the Connect surface renders from:
//   connected  — a live connection exists; the count is synced
//   available  — the creator can connect right now (YouTube, once
//                the Google OAuth env is set)
//   enabling   — the provider works but its credentials are not in
//                this environment yet (honest placeholder, no button)
//   in_review  — gated on Meta's Access Verification (IG + FB)
//   planned    — the developer application is being prepared (TikTok)
//   manual     — no connect exists for this platform (X, LinkedIn,
//                Snapchat); the count stays typed and Self-reported
async function publicStates(userId) {
  const conns = await listConnectionsForUser(userId);
  const byPlatform = {};
  for (const conn of conns) byPlatform[conn.platform] = conn;
  const defs = [
    { platform: "instagram", label: "Instagram" },
    { platform: "tiktok", label: "TikTok" },
    { platform: "facebook", label: "Facebook" },
    { platform: "x", label: "X" },
    { platform: "linkedin", label: "LinkedIn" },
    { platform: "youtube", label: "YouTube" },
    { platform: "snapchat", label: "Snapchat" },
  ];
  return defs.map((d) => {
    const conn = byPlatform[d.platform] || null;
    let state;
    if (conn) state = "connected";
    else if (d.platform === "youtube") state = youtubeConfigured() ? "available" : "enabling";
    else if (d.platform === "instagram" || d.platform === "facebook") state = "in_review";
    else if (d.platform === "tiktok") state = "planned";
    else state = "manual";
    return {
      platform: d.platform,
      label: d.label,
      state,
      connected: !!conn,
      accountLabel: conn ? conn.accountLabel || null : null,
      lastSyncAt: conn ? conn.lastSyncAt || null : null,
      lastCount: conn && typeof conn.lastCount === "number" ? conn.lastCount : null,
      lastSyncStatus: conn ? conn.lastSyncStatus || null : null,
    };
  });
}

module.exports = {
  appBaseUrl,
  youtubeConfigured,
  youtubeRedirectUri,
  buildYouTubeAuthUrl,
  createOAuthState,
  consumeOAuthState,
  exchangeYouTubeCode,
  fetchYouTubeChannel,
  fetchYouTubeSubscriberCount,
  saveYouTubeConnection,
  getConnection,
  deleteConnection,
  listConnectionsForUser,
  listAllConnections,
  publicStates,
};
