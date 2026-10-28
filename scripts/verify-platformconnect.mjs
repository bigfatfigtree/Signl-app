// End-to-end verification of Connect Accounts (Jeff, 2026-10-28):
// a creator connects YouTube once and the subscriber count then
// syncs from the provider, overwrites the typed number, recomputes
// the total and the automatic tier band, and shows businesses a
// Synced mark, while every unconnected platform stays Self-reported
// with its gate stated (Meta in review, TikTok planned).
//
// Google is impersonated by a local stub (the module's documented
// test seams: GOOGLE_AUTH_URL / GOOGLE_TOKEN_URL /
// YOUTUBE_API_BASE_URL), so the full OAuth exchange, refresh-free
// fetch, manual sync, the daily sync walk, the profile-save guard,
// disconnect semantics, and the hidden-subscriber-count case all
// run for real against the dev server on a throwaway database.
// Run: node scripts/verify-platformconnect.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { tierForFollowers } = require("../netlify/functions/lib/markets.js");

const PORT = 8963;
const STUB_PORT = 8964;
const BASE = `http://localhost:${PORT}`;
const STUB = `http://localhost:${STUB_PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["verify", "admin", "pass", "123"].join("-");
const SWEEP_TOKEN = ["verify", "sweep", "token", "123"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-platformconnect-${Date.now()}.json`);
const DB2 = path.join(os.tmpdir(), `signl-verify-platformconnect-b-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}

// Raw call that does NOT follow redirects (the OAuth legs are 302s).
async function rawNoRedirect(cookieHeader, p) {
  const res = await fetch(BASE + p, { method: "GET", headers: cookieHeader ? { Cookie: cookieHeader } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") || "" };
}
function cookieHeaderFrom(setCookieList) {
  return (setCookieList || []).map((sc) => sc.split(";")[0]).join("; ");
}

// ---------- Google stub ----------
const stubState = { count: 4321, hidden: false };
const stub = http.createServer((req, res) => {
  const url = new URL(req.url, STUB);
  if (req.method === "POST" && url.pathname === "/token") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const fields = new URLSearchParams(body);
      const grant = fields.get("grant_type");
      const payload = grant === "refresh_token"
        ? { access_token: "stub-access-2", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/youtube.readonly" }
        : { access_token: "stub-access-1", refresh_token: "stub-refresh-1", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/youtube.readonly" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/youtube/v3/channels") {
    const authz = req.headers.authorization || "";
    if (!authz.startsWith("Bearer stub-access")) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      items: [{
        id: "UCstubchannel1",
        snippet: { title: "Stub Channel", customUrl: "@stubchannel" },
        statistics: stubState.hidden
          ? { hiddenSubscriberCount: true }
          : { subscriberCount: String(stubState.count), hiddenSubscriberCount: false },
      }],
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/auth") { res.writeHead(200); res.end("stub consent"); return; }
  res.writeHead(404); res.end("{}");
});

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

function startServer(db, extraEnv) {
  return spawn("node", ["scripts/dev-server.mjs", String(extraEnv.PORT || PORT)], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    env: {
      ...process.env,
      SIGNL_LOCAL: "1",
      SIGNL_LOCAL_DB: db,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      APP_URL: extraEnv.APP_URL || BASE,
      SIGNL_TEST_ALLOW_BUSINESS: "1",
      SIGNL_SWEEP_TOKEN: SWEEP_TOKEN,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function waitFor(base) {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(base + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

await new Promise((r) => stub.listen(STUB_PORT, r));

const server = startServer(DB, {
  GOOGLE_OAUTH_CLIENT_ID: "stub-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "stub-client-secret",
  GOOGLE_AUTH_URL: `${STUB}/auth`,
  GOOGLE_TOKEN_URL: `${STUB}/token`,
  YOUTUBE_API_BASE_URL: STUB,
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  check("dev server boots and /api/bootstrap responds", await waitFor(BASE));

  const boot = await client()("GET", "/api/bootstrap");
  check("bootstrap flags YouTube OAuth as configured (stub env)", boot.data.platformConnect && boot.data.platformConnect.youtube.oauthConfigured === true, JSON.stringify(boot.data.platformConnect));
  check("bootstrap carries the Meta gate state", boot.data.platformConnect && boot.data.platformConnect.meta.state === "in_review");

  const anon = await client()("GET", "/api/me/platforms");
  check("signed-out /api/me/platforms is 401", anon.status === 401, String(anon.status));

  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  async function makeCreator(email, handle) {
    const c = client();
    const reg = await c("POST", "/api/auth/register", {
      role: "creator", name: "Connect Creator", email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
      handle, followerCount: 1000, localAudiencePct: 62, categories: ["Food & Drink"], ...AGREE,
    });
    if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
    await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
    return { client: c, id: reg.data.user.id };
  }

  const c1 = await makeCreator("connect1@fixtures.dev", "connectone");
  const meBefore = await c1.client("GET", "/api/auth/me");
  check("fixture creator starts profile-complete", meBefore.data.user.profileCompletion && meBefore.data.user.profileCompletion.complete === true, JSON.stringify(meBefore.data.user.profileCompletion));
  check("fixture creator has no platformSync before connecting", !(meBefore.data.user.creator && meBefore.data.user.creator.platformSync));

  const states = await c1.client("GET", "/api/me/platforms");
  const st = Object.fromEntries((states.data.platforms || []).map((p) => [p.platform, p.state]));
  check("platform states: youtube available, meta in review, tiktok planned, x manual",
    st.youtube === "available" && st.instagram === "in_review" && st.facebook === "in_review" && st.tiktok === "planned" && st.x === "manual" && st.linkedin === "manual" && st.snapchat === "manual",
    JSON.stringify(st));

  // ---------- OAuth legs ----------
  // Capture the session cookie for raw redirect calls.
  const loginRes = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "connect1@fixtures.dev", password: "creator-pass-123" }), redirect: "manual",
  });
  const cookie = cookieHeaderFrom(loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : []);
  check("creator login issues a session cookie for the OAuth legs", cookie.includes("signl_session="), cookie.slice(0, 40));

  const start = await rawNoRedirect(cookie, "/api/me/platforms/youtube/start");
  check("OAuth start answers 302", start.status === 302, String(start.status));
  const authUrl = new URL(start.location);
  check("OAuth start points at the Google auth endpoint with the readonly scope",
    start.location.startsWith(`${STUB}/auth`) && (authUrl.searchParams.get("scope") || "").includes("youtube.readonly"), start.location);
  check("OAuth start carries the app callback as redirect_uri",
    (authUrl.searchParams.get("redirect_uri") || "").endsWith("/api/me/platforms/youtube/callback"), authUrl.searchParams.get("redirect_uri"));
  const oauthState = authUrl.searchParams.get("state");
  check("OAuth start carries a state token", !!oauthState);

  const badCb = await rawNoRedirect(cookie, "/api/me/platforms/youtube/callback?code=x&state=deadbeef");
  check("callback with a forged state bounces to ?yt=error", badCb.status === 302 && badCb.location.endsWith("/?yt=error"), badCb.location);

  const cb = await rawNoRedirect(cookie, `/api/me/platforms/youtube/callback?code=stub-code&state=${oauthState}`);
  check("callback with the real state lands on ?yt=connected", cb.status === 302 && cb.location.endsWith("/?yt=connected"), cb.location);

  const reuse = await rawNoRedirect(cookie, `/api/me/platforms/youtube/callback?code=stub-code&state=${oauthState}`);
  check("OAuth state is single-use (replay bounces to ?yt=error)", reuse.status === 302 && reuse.location.endsWith("/?yt=error"), reuse.location);

  // ---------- state after connect ----------
  const dbAfter = JSON.parse(fs.readFileSync(DB, "utf8"));
  const connKey = `platconn:${c1.id}:youtube`;
  check("connection record stored server-side with tokens", !!(dbAfter[connKey] && dbAfter[connKey].accessToken === "stub-access-1" && dbAfter[connKey].refreshToken === "stub-refresh-1"), JSON.stringify(Object.keys(dbAfter).filter((k) => k.startsWith("platconn:"))));
  const meAfter = await c1.client("GET", "/api/auth/me");
  const crAfter = meAfter.data.user.creator || {};
  check("payload carries NO token material", !JSON.stringify(meAfter.data).includes("stub-access") && !JSON.stringify(meAfter.data).includes("stub-refresh"));
  check("platformSync mirror is verified with the synced count", !!(crAfter.platformSync && crAfter.platformSync.youtube && crAfter.platformSync.youtube.verified === true && crAfter.platformSync.youtube.lastCount === 4321), JSON.stringify(crAfter.platformSync));
  check("synced count overwrote the YouTube stack row", crAfter.audienceStack && crAfter.audienceStack.youtube === 4321, JSON.stringify(crAfter.audienceStack));
  check("total recomputed from the blend (1000 IG + 4321 YT)", crAfter.totalAudience === 5321, String(crAfter.totalAudience));
  check("tier band follows the new total automatically", crAfter.tierBand === tierForFollowers(5321), `${crAfter.tierBand} vs ${tierForFollowers(5321)}`);
  check("connect did not change profile completeness", meAfter.data.user.profileCompletion.complete === true);

  const statesAfter = await c1.client("GET", "/api/me/platforms");
  const ytState = (statesAfter.data.platforms || []).find((p) => p.platform === "youtube");
  check("/me/platforms reports youtube connected with account + count, no tokens",
    ytState && ytState.state === "connected" && ytState.accountLabel === "Stub Channel" && ytState.lastCount === 4321 && !JSON.stringify(statesAfter.data).includes("stub-access"),
    JSON.stringify(ytState));

  // ---------- business-facing Synced mark ----------
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", businessName: "Connect Kitchen", email: "connectbiz@fixtures.dev",
    password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "growth",
    neighborhood: "Carytown", about: "Counter service.", agreedTerms: true,
  });
  await admin("POST", "/api/admin/review", { userId: bizReg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: bizReg.data.user.id });
  const disco = await biz("GET", "/api/discover?market=Richmond");
  const card = (disco.data.creators || []).find((c) => c.userId === c1.id);
  check("activated business sees the creator in Discover", !!card, JSON.stringify((disco.data.creators || []).map((c) => c.userId)));
  const ytEntry = card && (card.audienceStack || []).find((p) => p.platform === "youtube");
  const igEntry = card && (card.audienceStack || []).find((p) => p.platform === "instagram");
  check("business payload marks YouTube synced", !!(ytEntry && ytEntry.count === 4321 && ytEntry.synced === true && ytEntry.syncedAt), JSON.stringify(ytEntry));
  check("business payload leaves Instagram unmarked (Self-reported)", !!(igEntry && igEntry.synced === undefined), JSON.stringify(igEntry));

  // ---------- manual sync ----------
  stubState.count = 5000;
  const syncRes = await c1.client("POST", "/api/me/platforms/youtube/sync");
  check("manual Sync now succeeds", syncRes.status === 200 && syncRes.data.ok === true, JSON.stringify(syncRes.data).slice(0, 200));
  check("manual sync moved the count to 5000 everywhere", syncRes.data.user.creator.audienceStack.youtube === 5000 && syncRes.data.user.creator.totalAudience === 6000, JSON.stringify(syncRes.data.user.creator.audienceStack));

  // ---------- the daily walk (metrics sync route) ----------
  stubState.count = 6000;
  const walkRes = await fetch(BASE + "/api/admin/metrics/sync", {
    method: "POST", headers: { "Content-Type": "application/json", "x-signl-sweep-token": SWEEP_TOKEN }, body: "{}",
  });
  const walk = await walkRes.json();
  check("metrics sync keeps the Meta flag contract (enabled:false, reason)", walk.enabled === false && walk.reason === "METRICS_AUTOSYNC is off", JSON.stringify(walk));
  check("metrics sync ran the audience walk and synced the connection", !!(walk.audience && walk.audience.synced >= 1 && walk.audience.failed === 0), JSON.stringify(walk.audience));
  const meWalk = await c1.client("GET", "/api/auth/me");
  check("the daily walk moved the stack count to 6000", meWalk.data.user.creator.audienceStack.youtube === 6000, JSON.stringify(meWalk.data.user.creator.audienceStack));

  // ---------- profile-save guard ----------
  const guard = await c1.client("PATCH", "/api/me/profile", { audienceStack: { instagram: 1000, youtube: 1 } });
  check("a stale profile save cannot overwrite the synced count", guard.status === 200 && guard.data.user.creator.audienceStack.youtube === 6000, JSON.stringify(guard.data.user && guard.data.user.creator && guard.data.user.creator.audienceStack));

  // ---------- disconnect ----------
  const disc = await c1.client("POST", "/api/me/platforms/youtube/disconnect");
  check("disconnect succeeds", disc.status === 200 && disc.data.ok === true, JSON.stringify(disc.data).slice(0, 160));
  const dbDisc = JSON.parse(fs.readFileSync(DB, "utf8"));
  check("disconnect deletes the connection record (tokens gone)", !dbDisc[connKey]);
  const meDisc = await c1.client("GET", "/api/auth/me");
  check("disconnect removes the Synced mirror", !(meDisc.data.user.creator.platformSync && meDisc.data.user.creator.platformSync.youtube), JSON.stringify(meDisc.data.user.creator.platformSync));
  check("disconnect keeps the last synced count as the editable number", meDisc.data.user.creator.audienceStack.youtube === 6000, JSON.stringify(meDisc.data.user.creator.audienceStack));
  check("completeness still intact after disconnect", meDisc.data.user.profileCompletion.complete === true);
  const statesDisc = await c1.client("GET", "/api/me/platforms");
  const ytDisc = (statesDisc.data.platforms || []).find((p) => p.platform === "youtube");
  check("after disconnect the row is back to available", ytDisc && ytDisc.state === "available", JSON.stringify(ytDisc));
  const discoAfter = await biz("GET", "/api/discover?market=Richmond");
  const cardAfter = (discoAfter.data.creators || []).find((c) => c.userId === c1.id);
  const ytAfter = cardAfter && (cardAfter.audienceStack || []).find((p) => p.platform === "youtube");
  check("business payload drops the Synced mark after disconnect (count stays)", !!(ytAfter && ytAfter.count === 6000 && ytAfter.synced === undefined), JSON.stringify(ytAfter));

  // ---------- hidden subscriber count ----------
  stubState.hidden = true;
  const c2 = await makeCreator("connect2@fixtures.dev", "connecttwo");
  const login2 = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "connect2@fixtures.dev", password: "creator-pass-123" }), redirect: "manual",
  });
  const cookie2 = cookieHeaderFrom(login2.headers.getSetCookie ? login2.headers.getSetCookie() : []);
  const start2 = await rawNoRedirect(cookie2, "/api/me/platforms/youtube/start");
  const state2 = new URL(start2.location).searchParams.get("state");
  const cb2 = await rawNoRedirect(cookie2, `/api/me/platforms/youtube/callback?code=stub-code&state=${state2}`);
  check("hidden-count channel still connects (lands ?yt=connected)", cb2.status === 302 && cb2.location.endsWith("/?yt=connected"), cb2.location);
  const meHidden = await c2.client("GET", "/api/auth/me");
  const syncHidden = meHidden.data.user.creator.platformSync && meHidden.data.user.creator.platformSync.youtube;
  check("hidden-count mirror is connected but NOT verified", !!(syncHidden && syncHidden.verified === false && syncHidden.syncStatus === "hidden"), JSON.stringify(syncHidden));
  check("hidden-count channel writes no stack count", !(meHidden.data.user.creator.audienceStack && meHidden.data.user.creator.audienceStack.youtube), JSON.stringify(meHidden.data.user.creator.audienceStack));
  const discoHidden = await biz("GET", "/api/discover?market=Richmond");
  const cardHidden = (discoHidden.data.creators || []).find((c) => c.userId === c2.id);
  check("business payload never shows a Synced mark for the hidden channel", !!cardHidden && !(cardHidden.audienceStack || []).some((p) => p.platform === "youtube" && p.synced), JSON.stringify(cardHidden && cardHidden.audienceStack));
  stubState.hidden = false;

  // ---------- unconfigured environment renders the honest state ----------
  const server2 = startServer(DB2, { PORT: 8965, APP_URL: "http://localhost:8965" });
  server2.stderr.on("data", (d) => process.stderr.write("[server2] " + d));
  try {
    check("second server boots without Google env", await waitFor("http://localhost:8965"));
    const boot2 = await client()("GET", "/api/bootstrap").catch(() => null);
    const boot2Res = await fetch("http://localhost:8965/api/bootstrap");
    const boot2Data = await boot2Res.json();
    check("bootstrap flags YouTube OAuth as NOT configured without env", boot2Data.platformConnect && boot2Data.platformConnect.youtube.oauthConfigured === false, JSON.stringify(boot2Data.platformConnect));
    void boot2;
  } finally {
    server2.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 350));
  }
} finally {
  server.kill("SIGTERM");
  stub.close();
  await new Promise((r) => setTimeout(r, 350));
}

console.log(`\nverify-platformconnect: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
