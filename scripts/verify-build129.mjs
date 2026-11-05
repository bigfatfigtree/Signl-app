// Build -129 verification (Jeff, 2026-11-04): creator
// self-service market change. The Zamp Camp case, replayed:
// a creator filed under Tampa (her invite link's market) whose
// audience is really in Charlotte had no way to fix it herself;
// her profile literally told her to email support. Now:
//  - an APPROVED creator moves her own market via POST
//    /me/market (the route the pending screen always used);
//  - her status never changes (no re-approval);
//  - EVERY audience number survives: the share she reported
//    for Charlotte becomes her home share, her old Tampa home
//    share rides along as an other-market entry, so her Tampa
//    listing survives on the same number and Charlotte
//    discovery ranks her by her Charlotte share;
//  - the move is event-logged with via "profile_self_serve";
//  - the pending path still works exactly as before;
//  - businesses are refused, and an approved creator cannot
//    drop back to not-listed through this route.
// Run: node scripts/verify-build129.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8957;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-build129-admin";
const DB = path.join(os.tmpdir(), `signl-verify-build129-${Date.now()}.json`);
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

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

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  // ---------- the Zamp-shaped creator: filed in Tampa, audience in Charlotte ----------
  const zed = client();
  const zedReg = await zed("POST", "/api/auth/register", {
    role: "creator",
    name: "Jamie Zed",
    email: "zed@fixtures.dev",
    password: "zed-pass-129",
    market: "Tampa",
    city: "Tampa",
    handle: "zamp_shaped",
    followerCount: 23700,
    localAudiencePct: 55,
    categories: ["Lifestyle"],
    ...AGREE,
  });
  check("creator registers under Tampa, complete (201)", zedReg.status === 201 && zedReg.data.user.creator.profileComplete === true, JSON.stringify(zedReg.data).slice(0, 200));
  const zedId = zedReg.data.user.id;
  const approveZed = await admin("POST", "/api/admin/review", { userId: zedId, decision: "approve" });
  check("admin approves her", approveZed.status === 200 && approveZed.data.user.status === "approved");

  const zedPatch = await zed("PATCH", "/api/me/profile", {
    paidRate: 180,
    publicPage: true,
    audienceMarkets: [
      { market: "Charlotte", pct: 30 },
      { market: "Austin", pct: 10 },
    ],
  });
  check("she reports her other-market shares (Charlotte 30, Austin 10)",
    zedPatch.status === 200 && JSON.stringify(zedPatch.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Charlotte", pct: 30 }, { market: "Austin", pct: 10 }]),
    JSON.stringify(zedPatch.data.user && zedPatch.data.user.creator && zedPatch.data.user.creator.audienceMarkets));

  // A Charlotte business, approved + active, for discovery checks.
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business",
    name: "Charlotte Owner",
    businessName: "Queen City Eats",
    email: "cltbiz@fixtures.dev",
    password: "cltbiz-pass-129",
    market: "Charlotte",
    city: "Charlotte",
    category: "Restaurant",
    planId: "growth",
    agreedTerms: true,
  });
  const bizId = bizReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  const activateBiz = await admin("POST", "/api/admin/businesses/activate", { userId: bizId });
  check("Charlotte business approved + activated", activateBiz.status === 200 && activateBiz.data.user.business.accessState === "active");

  const discBefore = await biz("GET", "/api/discover?market=Charlotte");
  const cardBefore = (discBefore.data.creators || []).find((c) => c.userId === zedId);
  check("before the move: Charlotte discovery already lists her at her reported 30%",
    !!cardBefore && cardBefore.profile.localAudiencePct === 30 && cardBefore.marketContext && cardBefore.marketContext.homeMarket === "Tampa",
    JSON.stringify(cardBefore && { pct: cardBefore.profile.localAudiencePct, ctx: cardBefore.marketContext }));

  // ---------- THE MOVE: Tampa -> Charlotte, by the creator herself ----------
  const move = await zed("POST", "/api/me/market", { market: "Charlotte", city: "Charlotte" });
  check("approved creator moves her own market (200)", move.status === 200, JSON.stringify(move.data).slice(0, 200));
  const mu = move.data.user || {};
  check("record now reads Charlotte / Charlotte", mu.market === "Charlotte" && mu.city === "Charlotte", JSON.stringify({ market: mu.market, city: mu.city }));
  check("status untouched: still approved, no re-approval", mu.status === "approved", mu.status);
  check("her reported Charlotte share (30) became the home share", mu.creator && mu.creator.localAudiencePct === 30, JSON.stringify(mu.creator && mu.creator.localAudiencePct));
  check("Tampa home share (55) preserved as an other-market entry; Austin (10) kept; Charlotte not duplicated",
    JSON.stringify((mu.creator || {}).audienceMarkets) === JSON.stringify([{ market: "Tampa", pct: 55 }, { market: "Austin", pct: 10 }]),
    JSON.stringify(mu.creator && mu.creator.audienceMarkets));
  check("profile still complete after the move (gate did not reopen)", mu.profileCompletion ? mu.profileCompletion.complete === true : mu.creator.profileComplete === true, JSON.stringify(mu.profileCompletion || mu.creator.profileComplete));
  check("the move is stamped on the record (marketChangedAt)", !!mu.marketChangedAt, JSON.stringify(mu.marketChangedAt));

  const meAfter = await zed("GET", "/api/auth/me");
  const meUser = meAfter.data.user || meAfter.data;
  check("GET /auth/me agrees: Charlotte, approved, numbers intact",
    meUser.market === "Charlotte" && meUser.status === "approved" && meUser.creator.localAudiencePct === 30
    && JSON.stringify(meUser.creator.audienceMarkets) === JSON.stringify([{ market: "Tampa", pct: 55 }, { market: "Austin", pct: 10 }]),
    JSON.stringify({ m: meUser.market, s: meUser.status }));

  const discAfter = await biz("GET", "/api/discover?market=Charlotte");
  const cardAfter = (discAfter.data.creators || []).find((c) => c.userId === zedId);
  check("after the move: Charlotte discovery reads her as home (30%, no market context)",
    !!cardAfter && cardAfter.profile.localAudiencePct === 30 && cardAfter.marketContext === null && cardAfter.market === "Charlotte",
    JSON.stringify(cardAfter && { pct: cardAfter.profile.localAudiencePct, ctx: cardAfter.marketContext, m: cardAfter.market }));
  const discTampa = await biz("GET", "/api/discover?market=Tampa");
  const tampaCard = (discTampa.data.creators || []).find((c) => c.userId === zedId);
  check("Tampa listing survives on the preserved 55% share, context names Charlotte as home",
    !!tampaCard && tampaCard.profile.localAudiencePct === 55 && tampaCard.marketContext && tampaCard.marketContext.homeMarket === "Charlotte",
    JSON.stringify(tampaCard && { pct: tampaCard.profile.localAudiencePct, ctx: tampaCard.marketContext }));

  const founding = await zed("GET", "/api/me/founding");
  const listedAfter = ((founding.data.card || {}).listedMarkets || []).map((e) => [e.market, e.pct, e.home]);
  check("her dashboard card lists Charlotte (home 30), Tampa (55), Austin (10)",
    JSON.stringify(listedAfter) === JSON.stringify([["Charlotte", 30, true], ["Tampa", 55, false], ["Austin", 10, false]]),
    JSON.stringify(listedAfter));

  // Public page: the audience visual now leads with Charlotte.
  const page = await client()("GET", "/c/zamp_shaped");
  const pageText = typeof page.data.raw === "string" ? page.data.raw : "";
  check("public profile page renders with Charlotte first in the audience breakdown",
    page.status === 200 && pageText.includes("Charlotte 30%") && pageText.includes("Tampa 55%") && pageText.indexOf("Charlotte 30%") < pageText.indexOf("Tampa 55%"),
    `status=${page.status} hasCLT=${pageText.includes("Charlotte 30%")} hasTPA=${pageText.includes("Tampa 55%")}`);

  // Same-market city change: numbers untouched.
  const cityMove = await zed("POST", "/api/me/market", { market: "Charlotte", city: "Matthews" });
  check("same-market city change works and keeps every number",
    cityMove.status === 200 && cityMove.data.user.city === "Matthews" && cityMove.data.user.creator.localAudiencePct === 30
    && JSON.stringify(cityMove.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Tampa", pct: 55 }, { market: "Austin", pct: 10 }]),
    JSON.stringify(cityMove.data).slice(0, 200));

  // An invalid city for the market is refused, record unharmed.
  const badCity = await zed("POST", "/api/me/market", { market: "Austin", city: "Charlotte" });
  check("a city outside the picked market is refused (400)", badCity.status === 400, JSON.stringify(badCity.data).slice(0, 160));
  const meStill = await zed("GET", "/api/auth/me");
  const meStillUser = meStill.data.user || meStill.data;
  check("record unharmed after the refused move", meStillUser.market === "Charlotte" && meStillUser.city === "Matthews");

  // Approved creators cannot drop back to not-listed here.
  const unlistedTry = await zed("POST", "/api/me/market", { market: "Not listed yet", customCity: "Tulsa", customCountry: "United States" });
  check("approved creator choosing not-listed is refused (400)", unlistedTry.status === 400, JSON.stringify(unlistedTry.data).slice(0, 160));

  // Businesses cannot use the route at all.
  const bizTry = await biz("POST", "/api/me/market", { market: "Austin", city: "Austin" });
  check("business is refused the creator route (403)", bizTry.status === 403, JSON.stringify(bizTry.data).slice(0, 160));

  // ---------- the pending path is unchanged ----------
  const pen = client();
  const penReg = await pen("POST", "/api/auth/register", {
    role: "creator",
    name: "Penny Pending",
    email: "penny@fixtures.dev",
    password: "penny-pass-129",
    market: "Tampa",
    city: "Tampa",
    handle: "pennypending",
    followerCount: 3000,
    localAudiencePct: 40,
    categories: ["Lifestyle"],
    ...AGREE,
  });
  check("second creator registers pending under Tampa", penReg.status === 201 && penReg.data.user.status === "pending");
  const penMove = await pen("POST", "/api/me/market", { market: "Austin", city: "Austin" });
  check("pending creator still moves her application herself (200)",
    penMove.status === 200 && penMove.data.user.market === "Austin" && penMove.data.user.status === "pending",
    JSON.stringify(penMove.data).slice(0, 200));

  // ---------- the Admin-visible trail ----------
  const raw = fs.readFileSync(DB, "utf8");
  check("event log carries market_changed via profile_self_serve (Tampa -> Charlotte)",
    raw.includes("\"profile_self_serve\"") && raw.includes("market_changed"), "event not found in the local store");
  check("event log still carries the pending path's via (pending_self_serve)",
    raw.includes("\"pending_self_serve\""), "pending event not found in the local store");
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`\nBuild -129 verification: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
