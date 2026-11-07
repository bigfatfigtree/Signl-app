#!/usr/bin/env node
// Build -108 verification (Tier 3 item 12: verified local % via
// Instagram). The live fetch stays gated on Meta App Review
// (G4), so the whole lane is proven against a local Meta STUB
// through the platform module's own test seams
// (INSTAGRAM_AUTH_URL / INSTAGRAM_TOKEN_URL / INSTAGRAM_GRAPH_BASE),
// never against real Meta. Instance A (9033) carries stub Meta
// credentials; instance B (9035) carries none (the gate state).
// Proves:
//   - the connect flow end to end (start -> stub OAuth -> code
//     exchange -> long-lived token -> profile + audience_city
//     fetch) with tokens ONLY in the platconn record: a scan of
//     every client-facing payload finds no token string;
//   - the ladder math: Nashville stated 62 vs Instagram 52.0 is
//     exactly 10 points = Verified; Austin stated 20 vs 9.5 is
//     10.5 = not verified; the stated numbers never move;
//   - the follower count syncs through the YouTube lane's own
//     writer (stack.instagram becomes the fetched count, marked
//     Synced); under-100 and no-city-data land as plain states;
//   - Verified is a TIEBREAK only: two creators with EQUAL
//     rankScore / Local Impact order verified-first despite the
//     verified one being created later; a stale verification
//     (60 days) earns nothing;
//   - captions flip per segment on the server profile page, the
//     top-bar badge shows only for the viewed market, Sig
//     answers for creator + business read the same record, the
//     home chips fire, and disconnect removes the record;
//   - flag-off: no credentials -> start bounces ?ig=unavailable,
//     the row reads in_review, bootstrap says not configured;
//   - canon locks: stamp -108, rank weights untouched,
//     founding prices unarmed.
//
// Run: node scripts/verify-build108.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9033;
const PORTB = 9035;
const STUB = 9034;
const BASE = `http://127.0.0.1:${PORT}`;
const BASEB = `http://127.0.0.1:${PORTB}`;
const ADMIN_EMAIL = "admin@b108.dev";
const ADMIN_PASSWORD = ["fixture", "admin", "108"].join("-");

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
  async raw(p) {
    const headers = {};
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { headers, redirect: "manual" });
    return { status: res.status, location: res.headers.get("location") || "", text: await res.text() };
  }
  async page(p) {
    const headers = {};
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { headers });
    return { status: res.status, text: await res.text() };
  }
}

// ---------- the Meta stub ----------
// Keyed by the long-lived token each flow ends with:
//   A: 1000 followers, cities Nashville 520 / Austin 95 / other 385
//   B: 80 followers (below the city-data floor)
//   C: 5000 followers, insights return no rows (no city data yet)
const STUB_PROFILES = {
  "LONG-TOKEN-A": { id: "ig-a", username: "mollyfixture", followers_count: 1000 },
  "LONG-TOKEN-B": { id: "ig-b", username: "tinyfixture", followers_count: 80 },
  "LONG-TOKEN-C": { id: "ig-c", username: "nadiafixture", followers_count: 5000 },
};
const STUB_CITIES = {
  "LONG-TOKEN-A": { "Nashville, Tennessee": 520, "Austin, Texas": 95, "Elsewhere, ZZ": 385 },
  "LONG-TOKEN-B": {},
  "LONG-TOKEN-C": {},
};
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${STUB}`);
  const send = (obj) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (u.pathname === "/oauth/access_token") {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      const code = new URLSearchParams(body).get("code") || "";
      const letter = code.replace("code-", "").toUpperCase();
      send({ access_token: `SHORT-TOKEN-${letter}`, user_id: `ig-${letter.toLowerCase()}`, permissions: ["instagram_business_basic", "instagram_business_manage_insights"] });
    });
    return;
  }
  if (u.pathname === "/access_token") {
    const short = u.searchParams.get("access_token") || "";
    return send({ access_token: short.replace("SHORT", "LONG"), token_type: "bearer", expires_in: 5184000 });
  }
  if (u.pathname === "/refresh_access_token") {
    return send({ access_token: u.searchParams.get("access_token") || "", token_type: "bearer", expires_in: 5184000 });
  }
  if (u.pathname === "/me") {
    const p = STUB_PROFILES[u.searchParams.get("access_token") || ""];
    if (!p) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "bad token" })); }
    return send(p);
  }
  if (/^\/ig-[a-z]\/insights$/.test(u.pathname)) {
    const cities = STUB_CITIES[u.searchParams.get("access_token") || ""] || {};
    return send(Object.keys(cities).length ? { data: [{ name: "audience_city", period: "lifetime", values: [{ value: cities }] }] } : { data: [] });
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "stub 404 " + u.pathname }));
});
await new Promise((r) => stub.listen(STUB, "127.0.0.1", r));

// ---------- seeds ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-108", salt, 64).toString("hex");
const D1 = "2026-09-01T00:00:00.000Z";
const D2 = "2026-09-02T00:00:00.000Z";
const D3 = "2026-09-03T00:00:00.000Z";
const FRESH = "2026-11-02T00:00:00.000Z";
const STALE = "2026-09-04T00:00:00.000Z"; // 60 days before the suite's "now"
const data = {};
function creator(id, handle, createdAt, extra = {}, cextra = {}) {
  data[`user:${id}`] = {
    id, role: "creator", email: `${id}@b108.dev`, name: handle, passwordSalt: salt, passwordHash: hash,
    status: "approved", market: "Nashville", city: "Nashville", createdAt, updatedAt: createdAt,
    creator: { handle, categories: ["Food & Drink"], localAudiencePct: 62, audienceStack: { instagram: 1000 }, totalAudience: 1000, followerCount: 1000, tierBand: "Neighbors", publicPage: true, bio: "Fixture creator.", neighborhood: "East Nashville", ...cextra },
    ...extra,
  };
  data[`email:${id}@b108.dev`] = { userId: id };
}
creator("cr-main", "mainmolly108", D1, {}, { audienceStack: { instagram: 640, tiktok: 300 }, totalAudience: 940, followerCount: 640, audienceMarkets: [{ market: "Austin", pct: 20 }] });
creator("cr-tie-a", "earlyerin108", D1);
creator("cr-tie-b", "latelena108", D2, {}, { audienceVerification: { source: "instagram", status: "verified", verifiedAt: FRESH, lastCheckedAt: FRESH, perMarket: { Nashville: { igPct: 55, selfPct: 62, withinTolerance: true } }, followerCountVerified: 1000, note: null } });
creator("cr-stale", "stalesara108", D3, {}, { audienceVerification: { source: "instagram", status: "verified", verifiedAt: STALE, lastCheckedAt: STALE, perMarket: { Nashville: { igPct: 58, selfPct: 62, withinTolerance: true } }, followerCountVerified: 1000, note: null } });
creator("cr-small", "tinytim108", D1, {}, { audienceStack: { instagram: 75 }, totalAudience: 75, followerCount: 75 });
creator("cr-nodata", "nadianodata108", D1, {}, { audienceStack: { instagram: 4200 }, totalAudience: 4200, followerCount: 4200 });
data["user:biz-1"] = { id: "biz-1", role: "business", email: "biz-1@b108.dev", name: "Biz Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: D1, updatedAt: D1, business: { businessName: "Fixture Tacos", category: "Restaurant", planId: "growth", planName: "Growth", planPriceMonthly: 349, planStatus: "active", subscriptionStatus: "active", accessState: "active", neighborhood: "East Nashville" } };
data["email:biz-1@b108.dev"] = { userId: "biz-1" };
data["offer:offer-1"] = { id: "offer-1", businessId: "biz-1", businessName: "Fixture Tacos", market: "Nashville", title: "Taco night", kind: "comp", status: "open", spots: 2, createdAt: D1, updatedAt: D1 };
data["application:app-erin"] = { id: "app-erin", offerId: "offer-1", creatorId: "cr-tie-a", businessId: "biz-1", market: "Nashville", status: "applied", createdAt: D1, updatedAt: D1 };
data["application:app-lena"] = { id: "app-lena", offerId: "offer-1", creatorId: "cr-tie-b", businessId: "biz-1", market: "Nashville", status: "applied", createdAt: D2, updatedAt: D2 };

function bootServer(port, dbData, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `signl-build108-${port}-`));
  const dbPath = path.join(tmp, "db.json");
  fs.writeFileSync(dbPath, JSON.stringify(dbData));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbPath, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: base, ADMIN_EMAIL, ADMIN_PASSWORD, ...extraEnv };
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM", "SQUARE_APP_ID", "SQUARE_APP_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]) delete env[k];
  const server = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } });
  return { dbPath, base };
}
const A = bootServer(PORT, data, {
  META_APP_ID: "stub-app-108", META_APP_SECRET: "stub-secret-108",
  INSTAGRAM_AUTH_URL: `http://127.0.0.1:${STUB}/oauth/authorize`,
  INSTAGRAM_TOKEN_URL: `http://127.0.0.1:${STUB}/oauth/access_token`,
  INSTAGRAM_GRAPH_BASE: `http://127.0.0.1:${STUB}`,
});
const B = bootServer(PORTB, JSON.parse(JSON.stringify(data)), {});
for (const base of [BASE, BASEB]) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) break; } catch (e) { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
}
const dbA = () => JSON.parse(fs.readFileSync(A.dbPath, "utf8"));
async function loginAs(base, email, password = "fixture-pass-108") {
  const c = new Client(base);
  const r = await c.req("POST", "/api/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return c;
}
const ask = async (client, q) => { const r = await client.req("POST", "/api/sig/ask", { q }); return r.data || {}; };
async function connectFlow(client, code) {
  const start = await client.raw("/api/me/platforms/instagram/start");
  if (start.status !== 302) throw new Error(`start: ${start.status}`);
  const state = new URL(start.location).searchParams.get("state");
  const cb = await client.raw(`/api/me/platforms/instagram/callback?code=${code}&state=${encodeURIComponent(state)}`);
  return { start, cb };
}

// ---------- gate-off instance: the lane is dark without Meta credentials ----------
console.log("Gate state (instance B, no Meta credentials)");
const bootB = await (await fetch(BASEB + "/api/bootstrap")).json();
check("bootstrap says Instagram is not configured", bootB.platformConnect && bootB.platformConnect.instagram && bootB.platformConnect.instagram.oauthConfigured === false, JSON.stringify(bootB.platformConnect || {}));
const mainB = await loginAs(BASEB, "cr-main@b108.dev");
const platsB = await mainB.req("GET", "/api/me/platforms");
const igRowB = (platsB.data.platforms || []).find((p) => p.platform === "instagram");
check("without credentials the Instagram row reads in_review", !!igRowB && igRowB.state === "in_review", JSON.stringify(igRowB || {}));
const startB = await mainB.raw("/api/me/platforms/instagram/start");
check("start bounces back ?ig=unavailable (no dead OAuth)", startB.status === 302 && startB.location.includes("?ig=unavailable"), `${startB.status} ${startB.location}`);

// ---------- the connect flow against the stub ----------
console.log("Connect flow (instance A, stub Meta)");
const molly = await loginAs(BASE, "cr-main@b108.dev");
const flow = await connectFlow(molly, "code-a");
check("start redirects to the Meta authorize URL carrying both scopes", flow.start.location.includes("/oauth/authorize") && flow.start.location.includes("instagram_business_basic") && flow.start.location.includes("instagram_business_manage_insights"), flow.start.location.slice(0, 200));
check("the callback completes to ?ig=connected", flow.cb.status === 302 && flow.cb.location.includes("?ig=connected"), `${flow.cb.status} ${flow.cb.location}`);
const connRec = dbA()["platconn:cr-main:instagram"];
check("the connection record holds the long-lived token server-side", !!connRec && connRec.accessToken === "LONG-TOKEN-A" && connRec.accountLabel === "@mollyfixture", JSON.stringify(connRec && { t: connRec.accessToken, l: connRec.accountLabel }));
const mollyRec = dbA()["user:cr-main"];
const av = mollyRec.creator.audienceVerification || {};
check("the verification record is written from the fetch", av.status === "verified" && av.followerCountVerified === 1000 && !!av.verifiedAt, JSON.stringify(av).slice(0, 200));
check("tolerance edge: stated 62 vs Instagram 52.0 (exactly 10) is Verified", !!(av.perMarket && av.perMarket.Nashville && av.perMarket.Nashville.igPct === 52 && av.perMarket.Nashville.selfPct === 62 && av.perMarket.Nashville.withinTolerance === true), JSON.stringify(av.perMarket || {}));
check("tolerance edge: stated 20 vs Instagram 9.5 (10.5) is NOT verified", !!(av.perMarket && av.perMarket.Austin && av.perMarket.Austin.igPct === 9.5 && av.perMarket.Austin.withinTolerance === false), JSON.stringify((av.perMarket || {}).Austin || {}));
check("the stated shares never moved (62 home, 20 Austin still stored)", mollyRec.creator.localAudiencePct === 62 && (mollyRec.creator.audienceMarkets || [])[0].pct === 20, "");
check("the follower count synced: stack.instagram is the fetched 1000, marked Synced", mollyRec.creator.audienceStack.instagram === 1000 && mollyRec.creator.platformSync.instagram.verified === true, JSON.stringify(mollyRec.creator.audienceStack));
const plats = await molly.req("GET", "/api/me/platforms");
const igRow = (plats.data.platforms || []).find((p) => p.platform === "instagram");
check("the platforms payload shows connected, with no token field", !!igRow && igRow.state === "connected" && igRow.accountLabel === "@mollyfixture" && !JSON.stringify(plats.data).includes("TOKEN"), "");
const mePayload = await molly.req("GET", "/api/auth/me");
const pubPage = await molly.page("/c/mainmolly108");
const bootText = await (await fetch(BASE + "/api/bootstrap")).text();
check("no token string reaches any client payload (me, profile page, bootstrap)", !JSON.stringify(mePayload.data).includes("TOKEN") && !pubPage.text.includes("TOKEN") && !bootText.includes("LONG-TOKEN"), "");

// ---------- captions, badge, Sig ----------
console.log("Labels + Sig");
check("the server profile caption flips per segment", pubPage.text.includes("Nashville verified from Instagram; the rest is self-reported by the creator."), pubPage.text.includes("Self-reported by the creator.") ? "still fully self-reported" : "caption missing");
check("the top bar carries the Verified badge for the viewed (verified) market", pubPage.text.includes("Verified from Instagram"), "");
const sara = await loginAs(BASE, "cr-stale@b108.dev");
const saraPage = await sara.page("/c/stalesara108");
check("a 60-day-old verification reads stale: no Verified claim anywhere on the page", !saraPage.text.includes("Verified from Instagram") && saraPage.text.includes("Self-reported by the creator."), "");
const vAsk = await ask(molly, "Is my local audience verified?");
check("creator Sig reports the verified market and the below-self market", vAsk.source === "data" && /Verified in Nashville/.test(vAsk.text || "") && /Austin/.test(vAsk.text || ""), JSON.stringify(vAsk).slice(0, 260));
const meanAsk = await ask(molly, "What does verified mean?");
check("creator Sig explains Verified in plain words", meanAsk.source === "data" && /within 10 points/.test(meanAsk.text || "") && /never changes/.test(meanAsk.text || ""), JSON.stringify(meanAsk).slice(0, 200));
const homeMolly = await molly.req("GET", "/api/sig/home");
const chipText = (homeMolly.data.chips || []).map((c) => (typeof c === "string" ? c : c.text || "")).join(" | ");
check("home chips carry the verified line and the private mismatch line", /Local audience verified in Nashville/.test(chipText) && /lower local share in Austin/.test(chipText), chipText.slice(0, 220));

// ---------- tiebreaks (scores equal by construction) ----------
console.log("Tiebreaks");
const biz = await loginAs(BASE, "biz-1@b108.dev");
const apps = await biz.req("GET", "/api/offers/offer-1/applications");
const appRows = apps.data.applications || [];
check("the two applications score EXACTLY equal (so only the tiebreak can order them)", appRows.length === 2 && appRows[0].rankScore === appRows[1].rankScore, JSON.stringify(appRows.map((a) => [a.creator.userId, a.rankScore])));
check("the verified creator (created later) ranks FIRST on the tie", appRows.length === 2 && appRows[0].creator.userId === "cr-tie-b", JSON.stringify(appRows.map((a) => a.creator.userId)));
const disc = await biz.req("GET", "/api/discover?market=Nashville&sort=score");
const discIds = (disc.data.creators || []).map((c) => c.userId);
check("Discover's score sort uses the same tiebreak (verified before unverified, stale earns nothing)", discIds.indexOf("cr-tie-b") > -1 && discIds.indexOf("cr-tie-b") < discIds.indexOf("cr-tie-a") && discIds.indexOf("cr-stale") > discIds.indexOf("cr-tie-a"), JSON.stringify(discIds));
const bizAsk = await ask(biz, "How many creators are in my market?");
check("business Sig names the Verified carriers on the roster", bizAsk.source === "data" && /Verified mark/.test(bizAsk.text || "") && /2 of them carry/.test(bizAsk.text || ""), JSON.stringify(bizAsk).slice(0, 300));

// ---------- plain states: below 100, no city data, sync, disconnect ----------
console.log("Plain states");
const tim = await loginAs(BASE, "cr-small@b108.dev");
const timFlow = await connectFlow(tim, "code-b");
check("the under-100 connect still completes", timFlow.cb.status === 302 && timFlow.cb.location.includes("?ig=connected"), `${timFlow.cb.status} ${timFlow.cb.location}`);
const timRec = dbA()["user:cr-small"];
check("under 100: the count syncs (80) but verification lands as the below_100 state", timRec.creator.audienceStack.instagram === 80 && timRec.creator.audienceVerification.status === "self_reported" && timRec.creator.audienceVerification.note === "below_100", JSON.stringify(timRec.creator.audienceVerification || {}));
const timAsk = await ask(tim, "Is my local audience verified?");
check("creator Sig states the under-100 limit plainly, never as an error", timAsk.source === "data" && /under 100 followers/.test(timAsk.text || ""), JSON.stringify(timAsk).slice(0, 200));
const nadia = await loginAs(BASE, "cr-nodata@b108.dev");
await connectFlow(nadia, "code-c");
const nadiaRec = dbA()["user:cr-nodata"];
check("no city data yet: plain no_city_data state, count still synced (5000)", nadiaRec.creator.audienceVerification.note === "no_city_data" && nadiaRec.creator.audienceVerification.status === "self_reported" && nadiaRec.creator.audienceStack.instagram === 5000, JSON.stringify(nadiaRec.creator.audienceVerification || {}));
const resync = await molly.req("POST", "/api/me/platforms/instagram/sync");
check("Sync now re-runs the verification pass", resync.status === 200 && resync.data.ok === true && resync.data.status === "verified", `status ${resync.status} ${JSON.stringify(resync.data || {}).slice(0, 120)}`);
const disc2 = await nadia.req("POST", "/api/me/platforms/instagram/disconnect");
const nadiaRec2 = dbA()["user:cr-nodata"];
check("disconnect removes the connection AND the verification record (the label cannot outlive its backing)", disc2.status === 200 && !dbA()["platconn:cr-nodata:instagram"] && !nadiaRec2.creator.audienceVerification && !nadiaRec2.creator.platformSync.instagram, "");

// ---------- canon locks ----------
console.log("Canon locks");
check("build stamp is -108 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.06-139") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.06-139"));
const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("founding Stripe prices stay unarmed (no market live for money)", /STRIPE_PRICE_FOUNDING_SELF_SERVICE \|\| ""/.test(routerSrc) && /STRIPE_PRICE_FOUNDING_GROWTH \|\| ""/.test(routerSrc) && /STRIPE_PRICE_FOUNDING_MANAGED \|\| ""/.test(routerSrc));
check("the rank weights are untouched (0.35 local / 0.25 impact / 0.2 momentum / 0.2 reliability)", routerSrc.includes("0.35 * localPct + 0.25 * (impact ? impact.score : 0) + 0.2 * Math.min(100, totalPts) + 0.2 * reliability"));
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("client wires the IG connect, notice, verification line and ideas", appSrc.includes("igConnect") && appSrc.includes("igNoticeHtml") && appSrc.includes("igVerificationLine") && appSrc.includes("cr_instagram") && appSrc.includes("cr_ig_mismatch"));
stub.close();
console.log(`\nbuild108: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("FAILING: " + fails.join("; ")); process.exit(1); }
