// verify-build123.mjs — Build -123 (Google sign-in + email
// sign-in link + Connected accounts hub + Sig wiring).
//
// Everything runs against a MOCK Google: the token, JWKS and
// YouTube endpoints are seams (GOOGLE_SIGNIN_TOKEN_URL /
// GOOGLE_SIGNIN_JWKS_URL / GOOGLE_TOKEN_URL / GOOGLE_AUTH_URL /
// YOUTUBE_API_BASE_URL) pointed at a local HTTP server that
// mints real RS256 ID tokens with a throwaway key. No live
// Google call happens anywhere in this suite.
//
// Pins:
//   - the OAuth state machine: PKCE S256 challenge on the way
//     out, state single-use, nonce/aud/iss/exp/email_verified
//     all enforced on the ID token;
//   - account rules: email match signs into THAT account (no
//     duplicate), subject match wins, link conflicts refuse,
//     a brand-new Google identity on the apply path prefills
//     only, and register-with-token links ONLY when the emails
//     match — and never approves anyone;
//   - the self-serve sign-in link: neutral answers, single-use,
//     expiring, newest-wins, password untouched, rate-limited;
//   - env-off behavior in a child process (no button state, the
//     start lane refuses softly, email lanes untouched);
//   - the hub states from GET /me/platforms incl. a REAL mocked
//     YouTube connect landing "connected" with a synced count;
//   - Sig's deterministic connected-accounts answers.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

// ---------- mock Google ----------
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "b123-test-key";
jwk.alg = "RS256";
jwk.use = "sig";

const CLIENT_ID = "b123-google-client-id";
const mockGoogle = {
  sub: "google-sub-0001",
  email: "gina.google@b123.dev",
  name: "Gina Google",
  emailVerified: true,
  nonce: "",
  aud: CLIENT_ID,
  iss: "https://accounts.google.com",
  expired: false,
  lastTokenBody: null,
  channel: {
    items: [{
      id: "UCb123channel",
      snippet: { customUrl: "@ginacreates", title: "Gina Creates" },
      statistics: { subscriberCount: "4321" },
    }],
  },
};

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function mintIdToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: "b123-test-key", typ: "JWT" };
  const payload = {
    iss: mockGoogle.iss,
    aud: mockGoogle.aud,
    sub: mockGoogle.sub,
    email: mockGoogle.email,
    email_verified: mockGoogle.emailVerified,
    name: mockGoogle.name,
    nonce: mockGoogle.nonce,
    iat: now - 10,
    exp: mockGoogle.expired ? now - 60 : now + 600,
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createSign("RSA-SHA256").update(data).sign(privateKey);
  return `${data}.${b64url(sig)}`;
}

const mockServer = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (u.pathname === "/certs") return send(200, { keys: [jwk] });
  if (u.pathname === "/youtube/v3/channels") return send(200, mockGoogle.channel);
  if (u.pathname === "/token") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      mockGoogle.lastTokenBody = Object.fromEntries(new URLSearchParams(body));
      send(200, { access_token: "mock-access-token", token_type: "Bearer", expires_in: 3600, id_token: mintIdToken() });
    });
    return;
  }
  send(404, { error: "not_found" });
});
await new Promise((r) => mockServer.listen(0, "127.0.0.1", r));
const MOCK = `http://127.0.0.1:${mockServer.address().port}`;

// ---------- env (before the handler loads) ----------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b123-"));
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = path.join(dataDir, "db.json");
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_MAIL_STUB = "1";
process.env.ADMIN_EMAIL = "admin@b123.dev";
process.env.ADMIN_PASSWORD = "b123-admin-password";
process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = "b123-google-secret";
process.env.GOOGLE_SIGNIN_AUTH_URL = `${MOCK}/auth`;
process.env.GOOGLE_SIGNIN_TOKEN_URL = `${MOCK}/token`;
process.env.GOOGLE_SIGNIN_JWKS_URL = `${MOCK}/certs`;
process.env.GOOGLE_AUTH_URL = `${MOCK}/auth`;
process.env.GOOGLE_TOKEN_URL = `${MOCK}/token`;
process.env.YOUTUBE_API_BASE_URL = MOCK;

const { handler } = require("./netlify/functions/api.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 240) : ""}`); }
}

async function invoke(method, p, { body, cookie, headers: extra } = {}) {
  const headers = { "content-type": "application/json", ...(extra || {}) };
  if (cookie) headers.cookie = cookie;
  const u = new URL(p, "http://x");
  const res = await handler({ httpMethod: method, path: u.pathname, headers, queryStringParameters: Object.fromEntries(u.searchParams), body: body ? JSON.stringify(body) : null, isBase64Encoded: false }, {});
  let json = null;
  try { json = JSON.parse(res.body); } catch (e) { /* redirects have no body */ }
  const setCookie = (res.headers && (res.headers["set-cookie"] || res.headers["Set-Cookie"])) || "";
  const cookiePair = (Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie)).split(";")[0];
  const normHeaders = Object.fromEntries(Object.entries(res.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { status: res.statusCode, json, headers: normHeaders, cookie: cookiePair.includes("=") ? cookiePair : null, raw: res.body || "" };
}
const qs = (p) => Object.fromEntries(new URL(p, "http://x").searchParams);
async function registerCreator(email, password, extra = {}) {
  const r = await invoke("POST", "/api/auth/register", { body: { role: "creator", quickClaim: true, name: "Test Creator", email, password, market: "Nashville", handle: email.split("@")[0].replace(/[^a-z0-9._]/g, ""), agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true, ...extra } });
  if (r.status !== 201) throw new Error(`register ${email} -> ${r.status}: ${r.raw.slice(0, 200)}`);
  return r;
}

// A full Google round trip: start -> capture state/nonce ->
// callback. Returns the callback response.
async function googleTrip(mode, { cookie, profile } = {}) {
  const start = await invoke("GET", `/api/auth/google/start?mode=${mode}`, { cookie });
  if (start.status !== 302) throw new Error(`google start ${mode} -> ${start.status}`);
  const loc = start.headers.location || start.headers.Location || "";
  const q = qs(loc);
  if (profile) Object.assign(mockGoogle, profile);
  mockGoogle.nonce = q.nonce || "";
  const cb = await invoke("GET", `/api/auth/google/callback?code=mock-code&state=${encodeURIComponent(q.state || "")}`, { cookie });
  return { start, loc, q, cb };
}

console.log("== Stamp (landed on -125 in the 2026-11-04 batch; pin re-aimed at the combined tree's top stamp) ==");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("build stamp is 2026.11.06-139 in build.js + index.html (was -123 standalone; -123 landed on top-build -125)", buildJs.includes('"2026.11.06-139"') && indexHtml.includes("2026.11.06-139"));

console.log("== Bootstrap: the lane reports itself ==");
{
  const boot = await invoke("GET", "/api/bootstrap");
  check("bootstrap googleSignin.configured true with env set", !!(boot.json && boot.json.googleSignin && boot.json.googleSignin.configured === true));
  check("bootstrap platformConnect.youtube.oauthConfigured follows the same Google env", !!(boot.json && boot.json.platformConnect && boot.json.platformConnect.youtube && boot.json.platformConnect.youtube.oauthConfigured === true));
}

console.log("== OAuth state machine ==");
const gina = await registerCreator("gina.google@b123.dev", "gina-password-1");
const ginaId = gina.json.user.id;
{
  const { loc, q, cb } = await googleTrip("signin");
  check("start 302s to the Google auth URL", loc.startsWith(`${MOCK}/auth`));
  check("auth request carries client, code flow, openid email profile scopes", q.client_id === CLIENT_ID && q.response_type === "code" && /openid/.test(q.scope || "") && /email/.test(q.scope || ""));
  check("redirect_uri is the app callback", (q.redirect_uri || "").endsWith("/api/auth/google/callback"), q.redirect_uri);
  check("PKCE S256 challenge + state + nonce present", !!q.code_challenge && q.code_challenge_method === "S256" && (q.state || "").length >= 32 && !!q.nonce);
  check("token exchange sent the PKCE verifier matching the challenge", (() => {
    const v = (mockGoogle.lastTokenBody || {}).code_verifier || "";
    return v && b64url(crypto.createHash("sha256").update(v).digest()) === q.code_challenge;
  })());
  check("callback signs in (302 signedin + session cookie)", cb.status === 302 && (cb.headers.location || "").includes("google=signedin") && !!cb.cookie, `${cb.status} ${cb.headers.location}`);
  const me = await invoke("GET", "/api/auth/me", { cookie: cb.cookie });
  check("Google sign-in lands on the EXISTING account (no duplicate)", me.json && me.json.user && me.json.user.id === ginaId);
  check("me exposes google as {email, linkedAt} only — the subject id never reaches the client", !!(me.json.user.google && me.json.user.google.email === "gina.google@b123.dev") && !JSON.stringify(me.json).includes("google-sub-0001"));
  // state is single-use: replaying the same callback refuses.
  const replay = await invoke("GET", `/api/auth/google/callback?code=mock-code&state=${encodeURIComponent(q.state)}`);
  check("state replay refused (single-use)", replay.status === 302 && (replay.headers.location || "").includes("google=error") && !replay.cookie);
}
{
  const badState = await invoke("GET", "/api/auth/google/callback?code=x&state=not-a-real-state");
  check("unknown state refused with the plain error landing", badState.status === 302 && (badState.headers.location || "").includes("google=error") && !badState.cookie);
}
for (const [label, profile] of [
  ["wrong audience refused", { aud: "someone-elses-client" }],
  ["wrong issuer refused", { iss: "https://evil.example.com" }],
  ["expired token refused", { expired: true }],
]) {
  const { cb } = await googleTrip("signin", { profile });
  check(label, cb.status === 302 && (cb.headers.location || "").includes("google=error") && !cb.cookie, cb.headers.location);
  Object.assign(mockGoogle, { aud: CLIENT_ID, iss: "https://accounts.google.com", expired: false, emailVerified: true });
}
{
  // Email matching runs ONLY on a Google-verified address: an
  // unverified claim on someone else's email must not sign in
  // or link; the same identity verified then works.
  const uma = await registerCreator("uma@b123.dev", "uma-password-1");
  Object.assign(mockGoogle, { sub: "google-sub-uma", email: "uma@b123.dev", name: "Uma", emailVerified: false });
  const bad = await googleTrip("signin");
  check("unverified email claim does not sign in", (bad.cb.headers.location || "").includes("google=error") || (bad.cb.headers.location || "").includes("googlelink="), bad.cb.headers.location);
  const meBad = bad.cb.cookie ? await invoke("GET", "/api/auth/me", { cookie: bad.cb.cookie }) : null;
  check("...and mints no session for the account", !meBad);
  const meUma = await invoke("GET", "/api/auth/me", { cookie: uma.cookie });
  check("...and does not link the account either", !(meUma.json.user.google && meUma.json.user.google.email));
  Object.assign(mockGoogle, { emailVerified: true });
  const good = await googleTrip("signin");
  const meGood = await invoke("GET", "/api/auth/me", { cookie: good.cb.cookie });
  check("the same identity, verified, signs in and links", !!(meGood.json && meGood.json.user && meGood.json.user.id === uma.json.user.id && meGood.json.user.google && meGood.json.user.google.email === "uma@b123.dev"));
}
{
  // Nonce mismatch: mint with a nonce Google never issued.
  const start = await invoke("GET", "/api/auth/google/start?mode=signin");
  const q = qs(start.headers.location || "");
  mockGoogle.nonce = "forged-nonce";
  const cb = await invoke("GET", `/api/auth/google/callback?code=mock-code&state=${encodeURIComponent(q.state)}`);
  check("nonce mismatch refused", cb.status === 302 && (cb.headers.location || "").includes("google=error") && !cb.cookie);
}

console.log("== Account rules: apply, link, roles ==");
{
  // Brand-new Google identity on the apply path: prefill only.
  Object.assign(mockGoogle, { sub: "google-sub-newbie", email: "newbie@b123.dev", name: "New Bie" });
  const { cb } = await googleTrip("apply");
  const loc = cb.headers.location || "";
  check("new identity on apply gets the prefill landing, not a session", cb.status === 302 && loc.includes("googlelink=") && !cb.cookie, loc);
  const token = qs(loc).googlelink || "";
  const pf = await invoke("GET", `/api/auth/google/prefill?token=${encodeURIComponent(token)}`);
  check("prefill reads back name + email", pf.status === 200 && pf.json.email === "newbie@b123.dev" && pf.json.name === "New Bie");
  const loginTry = await invoke("POST", "/api/auth/login", { body: { email: "newbie@b123.dev", password: "whatever-123" } });
  check("no account exists before the application is finished", loginTry.status === 401);
  // Register with a DIFFERENT email: created, but Google not linked.
  const other = await registerCreator("other@b123.dev", "other-password-1", { googleLinkToken: token });
  check("register with mismatched email succeeds WITHOUT linking (no hijack)", other.status === 201 && !(other.json.user.google && other.json.user.google.email));
  const pfAfter = await invoke("GET", `/api/auth/google/prefill?token=${encodeURIComponent(token)}`);
  check("a mismatched register does not burn the prefill token", pfAfter.status === 200);
  // Register with the matching email: links, lands as an APPLICANT.
  const nb = await registerCreator("newbie@b123.dev", "newbie-password-1", { googleLinkToken: token });
  check("matching register links Google", !!(nb.json.user.google && nb.json.user.google.email === "newbie@b123.dev"));
  check("Google never bypasses approval: the new creator is not approved", !!(nb.json.user.creator && nb.json.user.creator.status !== "approved"), nb.json.user.creator && nb.json.user.creator.status);
  const pfBurned = await invoke("GET", `/api/auth/google/prefill?token=${encodeURIComponent(token)}`);
  check("prefill token is consumed by the matching register", pfBurned.status === 404);
  // And the linked Google now signs straight in.
  const { cb: cb2 } = await googleTrip("signin");
  const me2 = await invoke("GET", "/api/auth/me", { cookie: cb2.cookie });
  check("linked Google signs into the account it was linked to", !!(me2.json && me2.json.user && me2.json.user.id === nb.json.user.id));
}
{
  // Link mode: conflicts refuse, matches link, subjects are sticky.
  const carl = await registerCreator("carl@b123.dev", "carl-password-1");
  Object.assign(mockGoogle, { sub: "google-sub-carl", email: "carl.work@gmail.dev", name: "Carl" });
  const conflict = await googleTrip("link", { cookie: carl.cookie });
  check("link with a different email lands on the conflict notice, unlinked", (conflict.cb.headers.location || "").includes("google=conflict"));
  const meC = await invoke("GET", "/api/auth/me", { cookie: carl.cookie });
  check("conflict leaves the account untouched", !(meC.json.user.google && meC.json.user.google.email));
  Object.assign(mockGoogle, { email: "carl@b123.dev" });
  const linked = await googleTrip("link", { cookie: carl.cookie });
  check("link with the account's own Google identity links", (linked.cb.headers.location || "").includes("google=linked"));
  // A second account cannot steal the linked subject.
  const dana = await registerCreator("dana@b123.dev", "dana-password-1");
  const steal = await googleTrip("link", { cookie: dana.cookie });
  check("another account cannot link a subject that is already taken", (steal.cb.headers.location || "").includes("google=conflict"));
  const meD = await invoke("GET", "/api/auth/me", { cookie: dana.cookie });
  check("the second account stays unlinked", !(meD.json.user.google && meD.json.user.google.email));
  // Subject wins over email: signing in with the linked Google
  // lands on Carl even though Dana's session exists elsewhere.
  const { cb } = await googleTrip("signin");
  const meS = await invoke("GET", "/api/auth/me", { cookie: cb.cookie });
  check("subject match signs into the linked account", !!(meS.json && meS.json.user && meS.json.user.id === carl.json.user.id));
  // Unlink, then unlink again refuses plainly.
  const un1 = await invoke("POST", "/api/auth/google/unlink", { cookie: carl.cookie, body: {} });
  check("unlink works and clears the stamp", un1.status === 200 && !(un1.json.user.google && un1.json.user.google.email));
  const un2 = await invoke("POST", "/api/auth/google/unlink", { cookie: carl.cookie, body: {} });
  check("second unlink is a plain 400", un2.status === 400);
}
{
  // Admin signs in with Google by email match, like everyone.
  const adminLogin = await invoke("POST", "/api/auth/login", { body: { email: "admin@b123.dev", password: "b123-admin-password" } });
  check("admin password login (fixture)", adminLogin.status === 200 && adminLogin.json.user.role === "admin");
  Object.assign(mockGoogle, { sub: "google-sub-admin", email: "admin@b123.dev", name: "Admin" });
  const { cb } = await googleTrip("signin");
  const meA = await invoke("GET", "/api/auth/me", { cookie: cb.cookie });
  check("Google signs the admin into the admin account", !!(meA.json && meA.json.user && meA.json.user.role === "admin" && meA.json.user.id === adminLogin.json.user.id));
  // Unknown identity in sign-in mode creates nothing.
  Object.assign(mockGoogle, { sub: "google-sub-ghost", email: "ghost@b123.dev", name: "Ghost" });
  const ghost = await googleTrip("signin");
  check("unknown Google identity gets the application prefill landing, no session", (ghost.cb.headers.location || "").includes("googlelink=") && !ghost.cb.cookie, ghost.cb.headers.location);
  const ghostLogin = await invoke("POST", "/api/auth/login", { body: { email: "ghost@b123.dev", password: "whatever-123" } });
  check("...and no account was created for it", ghostLogin.status === 401);
}

console.log("== Email sign-in link (self-serve) ==");
{
  const erin = await registerCreator("erin@b123.dev", "erin-password-1");
  const reqUnknown = await invoke("POST", "/api/auth/signin-link", { body: { email: "nobody@b123.dev" } });
  const reqKnown = await invoke("POST", "/api/auth/signin-link", { body: { email: "erin@b123.dev" } });
  check("known and unknown emails get the same neutral answer", reqUnknown.status === 200 && reqKnown.status === 200 && reqUnknown.json.ok === true && reqKnown.json.ok === true);
  check("the test hook surfaces the token only in test mode", typeof reqKnown.json.devSigninToken === "string" && reqUnknown.json.devSigninToken === undefined);
  const token1 = reqKnown.json.devSigninToken;
  const consume = await invoke("POST", "/api/auth/signin-link/consume", { body: { token: token1 } });
  check("consume signs in and returns the account", consume.status === 200 && !!consume.cookie && consume.json.user.id === erin.json.user.id);
  const again = await invoke("POST", "/api/auth/signin-link/consume", { body: { token: token1 } });
  check("the link is single-use", again.status === 400);
  const pw = await invoke("POST", "/api/auth/login", { body: { email: "erin@b123.dev", password: "erin-password-1" } });
  check("the password still works untouched after link sign-in", pw.status === 200);
  // Newest wins: two fresh links, the first dies.
  const r1 = await invoke("POST", "/api/auth/signin-link", { body: { email: "erin@b123.dev" } });
  const r2 = await invoke("POST", "/api/auth/signin-link", { body: { email: "erin@b123.dev" } });
  const stale = await invoke("POST", "/api/auth/signin-link/consume", { body: { token: r1.json.devSigninToken } });
  check("a newer link retires the older one", stale.status === 400);
  const fresh = await invoke("POST", "/api/auth/signin-link/consume", { body: { token: r2.json.devSigninToken } });
  check("the newest link works", fresh.status === 200);
  // Expiry: with a 1ms TTL the link is dead on arrival.
  process.env.SIGNL_SIGNINLINK_TTL_MS = "1";
  const r3 = await invoke("POST", "/api/auth/signin-link", { body: { email: "erin@b123.dev" } });
  await new Promise((r) => setTimeout(r, 10));
  const dead = await invoke("POST", "/api/auth/signin-link/consume", { body: { token: r3.json.devSigninToken } });
  check("an expired link refuses with its reason", dead.status === 400 && /expired/i.test(dead.json.error || ""));
  delete process.env.SIGNL_SIGNINLINK_TTL_MS;
  // Rate limit: five an hour per email + IP; the sixth stops
  // minting (the answer stays neutral, no token rides along).
  const fred = await registerCreator("fred@b123.dev", "fred-password-1");
  let last = null;
  for (let i = 0; i < 5; i += 1) last = await invoke("POST", "/api/auth/signin-link", { body: { email: "fred@b123.dev" } });
  check("five link requests an hour are fine", !!(last && last.json.devSigninToken));
  const sixth = await invoke("POST", "/api/auth/signin-link", { body: { email: "fred@b123.dev" } });
  check("the sixth mints nothing (rate-limited, still neutral)", sixth.status === 200 && sixth.json.ok === true && sixth.json.devSigninToken === undefined);
  const fredConsume = await invoke("POST", "/api/auth/signin-link/consume", { body: { token: last.json.devSigninToken } });
  check("the last good link still works", fredConsume.status === 200 && fredConsume.json.user.id === fred.json.user.id);
}

console.log("== Connected accounts hub states ==");
{
  const plats = await invoke("GET", "/api/me/platforms", { cookie: gina.cookie });
  const by = Object.fromEntries((plats.json.platforms || []).map((p) => [p.platform, p]));
  check("hub lists all four networks", ["instagram", "tiktok", "youtube", "facebook"].every((p) => !!by[p]));
  check("YouTube reads available (same Google env, not yet connected)", by.youtube && by.youtube.state === "available", by.youtube && by.youtube.state);
  check("Instagram reads in_review (Meta App Review pending)", by.instagram && by.instagram.state === "in_review", by.instagram && by.instagram.state);
  check("TikTok reads planned (no developer app yet)", by.tiktok && by.tiktok.state === "planned", by.tiktok && by.tiktok.state);
  check("Facebook reads in_review alongside Instagram", by.facebook && by.facebook.state === "in_review", by.facebook && by.facebook.state);
}
{
  // A REAL YouTube connect against the mock: start -> Google ->
  // callback -> the channel read lands on the record.
  const hank = await registerCreator("hank@b123.dev", "hank-password-1");
  await invoke("PATCH", "/api/me/profile", { cookie: hank.cookie, body: { audienceStack: { youtube: 900 }, followerCount: 900 } });
  const start = await invoke("GET", "/api/me/platforms/youtube/start", { cookie: hank.cookie });
  const loc = start.headers.location || "";
  check("YouTube start 302s to Google", start.status === 302 && loc.startsWith(`${MOCK}/auth`), `${start.status} ${loc.slice(0, 80)}`);
  const state = qs(loc).state || "";
  const cb = await invoke("GET", `/api/me/platforms/youtube/callback?code=mock-code&state=${encodeURIComponent(state)}`, { cookie: hank.cookie });
  check("YouTube callback lands connected", cb.status === 302 && (cb.headers.location || "").includes("yt=connected"), cb.headers.location);
  const plats = await invoke("GET", "/api/me/platforms", { cookie: hank.cookie });
  const yt = (plats.json.platforms || []).find((p) => p.platform === "youtube");
  check("hub now reads YouTube connected as the channel with the checked date", !!yt && yt.state === "connected" && yt.accountLabel === "Gina Creates" && !!yt.lastSyncAt, JSON.stringify(yt));
  const me = await invoke("GET", "/api/auth/me", { cookie: hank.cookie });
  const c = me.json.user.creator || {};
  check("the synced count feeds the audience stack (typed 900 -> synced 4321, Synced record kept)", !!c.platformSync && !!c.platformSync.youtube && c.platformSync.youtube.lastCount === 4321 && (c.audienceStack || {}).youtube === 4321, JSON.stringify({ ps: c.platformSync, stack: c.audienceStack }));
  const disc = await invoke("POST", "/api/me/platforms/youtube/disconnect", { cookie: hank.cookie, body: {} });
  const plats2 = await invoke("GET", "/api/me/platforms", { cookie: hank.cookie });
  const yt2 = (plats2.json.platforms || []).find((p) => p.platform === "youtube");
  check("disconnect returns the row to available, numbers kept", disc.status === 200 && !!yt2 && yt2.state === "available", yt2 && yt2.state);
}

console.log("== Sig knows the connections ==");
{
  const sigdata = require("./netlify/functions/lib/sigdata.js");
  const mk = (creator, google) => sigdata.buildCreatorFacts({
    user: { id: "u-sig", role: "creator", email: "sig@b123.dev", name: "Sig", creator, google },
    full: { momentum: { points: 0, ledger: [] } }, readout: { overall: {} },
    bookings: [], posts: [], offers: [], markets: [], igConfigured: false, ytConfigured: true,
  });
  const f1 = mk({ status: "approved", market: "Nashville", platformSync: { youtube: { accountLabel: "@ginacreates", followers: 4321, lastSyncAt: "2026-11-04T00:00:00.000Z", verified: true } } }, { sub: "s", email: "sig@gmail.dev", linkedAt: "x" });
  const a1 = sigdata.answerFacts("creator", f1, "which accounts are connected?");
  const txt = (a) => (typeof a === "string" ? a : (a && a.text) || "");
  const t1 = txt(a1);
  check("Sig lists YouTube connected with its handle", /YouTube is connected as @ginacreates/.test(t1), t1.slice(0, 160));
  check("Sig is honest about TikTok + Facebook gates", /TikTok connect is being prepared/.test(t1) && /Facebook connect waits on the same Meta review/.test(t1));
  check("Sig reports the Google link", /Google is linked/.test(t1));
  const lines = sigdata.factsLines("creator", f1, {}).join("\n");
  check("the grounding lines carry the connection states", /Connected accounts:/.test(lines) && /YouTube: connected as @ginacreates/.test(lines));
  const f2 = mk({ status: "approved", market: "Nashville" }, null);
  const a2 = sigdata.answerFacts("creator", f2, "connect my tiktok");
  check("Sig answers a TikTok connect ask with the truthful gate", /being prepared/.test(txt(a2)));
  const a3 = sigdata.answerFacts("creator", f2, "is google linked?");
  check("Sig answers an unlinked Google plainly", /not linked/.test(txt(a3)), txt(a3).slice(0, 120));
}

console.log("== Client surfaces (static) ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("sign-in screen: Google button + email-link form, both env-gated by bootstrap", appJs.includes('googleButtonHtml("signin")') && appJs.includes("Email me a sign-in link") && appJs.includes("googleSignin.configured"));
  check("apply entries carry Continue with Google (claim + full form + business)", appJs.includes("claimGoogleStart()") && appJs.includes('googleButtonHtml("apply")'));
  check("register payloads carry the link token (creator x2 + business)", (appJs.match(/googleLinkToken: storedGoogleLink\(\)/g) || []).length >= 3);
  check("Connected accounts hub renders + loads on the Profile tab", appJs.includes('id="connected-accounts"') && appJs.includes("loadConnectedAccounts") && appJs.includes("connectedAccountsHtml(u)"));
  check("Settings carries the Google link/unlink row", appJs.includes("googleAccountRowHtml(u)") && appJs.includes("googleUnlink()"));
  check("init consumes google / googlelink / signinlink landings", appJs.includes('params.get("googlelink")') && appJs.includes('params.get("signinlink")') && appJs.includes("/auth/signin-link/consume"));
  check("hub copy is honest (coming soon states, no fake connects)", appJs.includes("Instagram connect is in review with Meta") && appJs.includes("TikTok connect is being prepared"));
}

console.log("== Env off: production stays exactly as it was ==");
{
  const child = spawnSync(process.execPath, ["-e", `
    const { createRequire } = require("node:module");
    const req = createRequire(${JSON.stringify(path.join(root, "package.json"))});
    (async () => {
      const { handler } = req("./netlify/functions/api.js");
      const call = async (method, p, body) => {
        const res = await handler({ httpMethod: method, path: p, headers: { "content-type": "application/json" }, queryStringParameters: null, body: body ? JSON.stringify(body) : null, isBase64Encoded: false }, {});
        let j = null; try { j = JSON.parse(res.body); } catch (e) {}
        return { status: res.statusCode, json: j, headers: res.headers || {} };
      };
      const boot = await call("GET", "/api/bootstrap");
      const start = await call("GET", "/api/auth/google/start?mode=signin");
      const link = await call("POST", "/api/auth/signin-link", { email: "nobody@off.dev" });
      console.log(JSON.stringify({
        configured: !!(boot.json && boot.json.googleSignin && boot.json.googleSignin.configured),
        ytConfigured: !!(boot.json && boot.json.platformConnect && boot.json.platformConnect.youtube && boot.json.platformConnect.youtube.oauthConfigured),
        startLocation: start.headers.location || start.headers.Location || "",
        linkStatus: link.status, linkOk: !!(link.json && link.json.ok),
      }));
    })().catch((e) => { console.error(e); process.exit(2); });
  `], {
    env: {
      PATH: process.env.PATH,
      SIGNL_LOCAL: "1",
      SIGNL_LOCAL_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "signl-b123-off-")), "db.json"),
      SIGNL_TEST_ALLOW_BUSINESS: "1",
      SIGNL_MAIL_STUB: "1",
      ADMIN_EMAIL: "admin@off.dev",
      ADMIN_PASSWORD: "off-admin-password",
    },
    encoding: "utf8",
    timeout: 60000,
  });
  let out = null;
  try { out = JSON.parse((child.stdout || "").trim().split("\n").pop()); } catch (e) { /* reported below */ }
  check("child ran", !!out, (child.stderr || child.stdout || "").slice(0, 200));
  if (out) {
    check("no Google env: bootstrap reports the lane off (button hides)", out.configured === false && out.ytConfigured === false);
    check("no Google env: start lands on the plain unavailable notice", /google=unavailable/.test(out.startLocation), out.startLocation);
    check("no Google env: the email sign-in link lane still works", out.linkStatus === 200 && out.linkOk === true);
  }
}

mockServer.close();
console.log(`\nverify-build123: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
