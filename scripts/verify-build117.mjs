#!/usr/bin/env node
// Build -117 verification (Jeff, 2026-11-03): New Zealand joins
// the market roster — Auckland restored (removed in the
// 2026-10-23 reset), Wellington and Christchurch added, so the
// staged NZ founding-creator outreach has real claim links.
// Proves:
//   S. source pins: the three NZ entries in markets.js (ids,
//      labels, country), the NZ country aliases, the stamp.
//   U. unit: roster 41 markets / 9 countries; each NZ market
//      carries its metro list (anchor first, 40+ areas); the
//      typed-city resolver files NZ towns uniquely, ties bare
//      "Wellington" with Miami (the designed outcome) and
//      resolves it on the New Zealand hint; the pinned
//      outcomes do not move (Henderson -> Las Vegas, Sydenham
//      -> London, bare London ties Columbus); NZ markets
//      launched with NO currency override (USD / $50 default)
//      and Build -118 superseded that pin the same night: the
//      trio now carries NZD (NZ$90 floor), asserted below, and
//      London's GBP is untouched.
//   G. Sig: Admin facts built with the config-driven market
//      name list carry an Auckland marketReach row from a
//      listed Auckland creator, and the facts lines name it.
//   H. server: bootstrap serves 41 markets incl. the NZ trio;
//      claims land under market=Auckland (name), wellington
//      (stable id) and Christchurch (name) with country New
//      Zealand stored; Admin markets list is 41 rows with the
//      NZ rows present, country New Zealand, NOT live; the
//      public roster surface treats a new market by the same
//      rule as every market — below the 5-finished-profiles
//      threshold /roster/auckland is the friendly 404 and the
//      sitemap does not list it (no thin page, no counts).
//
// Run: node scripts/verify-build117.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require = createRequire(import.meta.url);
const { MARKETS, normalizeMarketName, resolveTypedCity, currencyForMarket, paidFloorForMarket } = require("../netlify/functions/lib/markets.js");

const PORT = 9054;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build117-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build117-${Date.now()}.json`);

let passed = 0;
let failed = 0;
let currentPart = "boot";
const failures = [];
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- S: source pins ----------
part("S: source pins");
const marketsJs = fs.readFileSync(path.join(root, "netlify/functions/lib/markets.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("stamp is 2026.11.03-118 on both sides", indexHtml.includes("2026.11.03-118") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.03-118"));
check("markets.js carries the Auckland entry", marketsJs.includes('id: "auckland"') && marketsJs.includes('label: "Auckland, New Zealand"'));
check("markets.js carries the Wellington entry", marketsJs.includes('id: "wellington"') && marketsJs.includes('label: "Wellington, New Zealand"'));
check("markets.js carries the Christchurch entry", marketsJs.includes('id: "christchurch"') && marketsJs.includes('label: "Christchurch, New Zealand"'));
check("markets.js carries the New Zealand country aliases", marketsJs.includes('"new zealand": "New Zealand"') && marketsJs.includes('nz: "New Zealand"'));

// ---------- U: unit ----------
part("U: roster + resolver + currency");
check("roster is 41 markets", MARKETS.length === 41, String(MARKETS.length));
const countries = [...new Set(MARKETS.map((m) => m.country))];
check("country set is 9 and includes New Zealand", countries.length === 9 && countries.includes("New Zealand"), JSON.stringify(countries));
const nz = ["Auckland", "Wellington", "Christchurch"].map((n) => MARKETS.find((m) => m.name === n));
check("NZ ids are the stable slugs", nz.every((m) => !!m) && nz[0].id === "auckland" && nz[1].id === "wellington" && nz[2].id === "christchurch");
check("each NZ market carries its metro list, anchor city first, 40+ areas", nz.every((m) => m.cities[0] === m.name && m.cities.length >= 40), JSON.stringify(nz.map((m) => m.cities.length)));
check("normalizeMarketName leaves the NZ names canonical", normalizeMarketName("Auckland") === "Auckland" && normalizeMarketName("Wellington") === "Wellington" && normalizeMarketName("Christchurch") === "Christchurch");
const uniqueCases = [["Takapuna", "Auckland"], ["Pukekohe", "Auckland"], ["Lower Hutt", "Wellington"], ["Paraparaumu", "Wellington"], ["Rolleston", "Christchurch"], ["Rangiora", "Christchurch"]];
check("NZ metro towns resolve uniquely to their market", uniqueCases.every(([t, want]) => { const r = resolveTypedCity(t); return r.status === "unique" && r.market === want; }),
  JSON.stringify(uniqueCases.map(([t]) => [t, resolveTypedCity(t)])));
check("bare Wellington is the designed Miami/Wellington tie; the New Zealand hint resolves it",
  (() => { const bare = resolveTypedCity("Wellington"); const hinted = resolveTypedCity("Wellington, New Zealand"); return bare.status === "ambiguous" && bare.markets.includes("Miami") && bare.markets.includes("Wellington") && hinted.status === "unique" && hinted.market === "Wellington"; })());
check("pinned resolver outcomes do not move (Henderson -> Las Vegas, Sydenham -> London, bare London ties)",
  resolveTypedCity("Henderson").market === "Las Vegas" && resolveTypedCity("Sydenham").market === "London" && resolveTypedCity("London").status === "ambiguous");
check("NZ markets carry the NZD override (Build -118 supersedes the -117 USD-default pin)",
  nz.every((m) => m.currency === "NZD") && ["Auckland", "Wellington", "Christchurch"].every((n) => { const c = currencyForMarket(n); return c.code === "NZD" && c.symbol === "$" && c.paidFloor === 90; }) && paidFloorForMarket("Auckland") === 90);
check("London's GBP override is untouched (£40 floor)", (() => { const c = currencyForMarket("London"); return c.code === "GBP" && c.symbol === "£" && c.paidFloor === 40; })());

// ---------- G: Sig facts pick the new markets up from config ----------
part("G: Sig facts");
const sigdata = require(path.join(root, "netlify/functions/lib/sigdata.js"));
const router = require(path.join(root, "netlify/functions/lib/router.js"));
const { listedMarketsFor } = require(path.join(root, "netlify/functions/lib/audience-markets.js"));
const aklCreator = {
  id: "b117-akl", role: "creator", email: "akl@fixtures.dev", name: "Aroha Auckland", status: "approved",
  market: "Auckland", city: "Takapuna", country: "New Zealand", tester: false,
  createdAt: "2026-11-03T12:00:00.000Z", updatedAt: "2026-11-03T12:00:00.000Z",
  creator: { handle: "akleats", followerCount: 42000, totalAudience: 42000, audienceStack: { instagram: 42000 }, audienceMarkets: [{ market: "Auckland", pct: 62 }], localAudiencePct: 62, tierBand: "Headliners", hasPhoto: true },
};
const facts = sigdata.buildAdminFacts({
  users: [aklCreator], offers: [], bookings: [], posts: [], partners: [], marketFlags: {}, dealFacts: null, territoryConflicts: [], londonRace: null, teamByPartner: {},
  marketNames: MARKETS.map((m) => m.name),
  isTester: (u) => u.tester === true,
  profileCompleteOf: router.profileCompleteOf,
  businessAccessState: (u) => (u.business && u.business.accessState === "active" ? "active" : "founding"),
  planNameOf: () => "Growth",
  listedMarketsFor, audienceTotalOf: router.audienceTotalOf,
  now: Date.now(),
});
const aklReach = (facts.creators.marketReach || []).find((m) => m.market === "Auckland");
check("Sig marketReach carries Auckland from the config-driven market list (1 listed creator, 42,000 combined)",
  !!aklReach && aklReach.creators === 1 && aklReach.combinedFollowers === 42000, JSON.stringify(aklReach));
const factLines = sigdata.factsLines("admin", facts).join("\n");
check("Sig facts lines name Auckland's combined reach", factLines.includes("Auckland: 42,000 combined followers across 1 listed creator"), factLines.slice(0, 200));

// ---------- H: server ----------
part("H: server");
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
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: root,
  // Deliberately NO SIGNL_TEST_ALLOW_BUSINESS (the verify-build59
  // pattern): the override makes every market READ live, and this
  // suite pins the NZ markets' real production default — NOT live.
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, [["ADMIN", "PASSWORD"].join("_")]: ADMIN_PW, APP_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const boot = await client()("GET", "/api/bootstrap");
  const bootMarkets = boot.data.markets || [];
  check("bootstrap serves 41 markets", bootMarkets.length === 41, String(bootMarkets.length));
  check("bootstrap serves the NZ trio with country New Zealand",
    ["Auckland", "Wellington", "Christchurch"].every((n) => { const m = bootMarkets.find((x) => x.name === n); return !!m && m.country === "New Zealand"; }),
    JSON.stringify(bootMarkets.filter((m) => m.country === "New Zealand").map((m) => m.name)));

  const quickClaim = async (email, handle, market) => {
    const c = client();
    return c("POST", "/api/auth/register", { role: "creator", quickClaim: true, email, password: "claim-" + "pass-1234", market, handle, ...AGREE });
  };
  const cAkl = await quickClaim("aklclaim@fixtures.dev", "aklclaim", "Auckland");
  check("claim link market=Auckland lands (201, stored Auckland / New Zealand)",
    cAkl.status === 201 && !!cAkl.data.user && cAkl.data.user.market === "Auckland" && cAkl.data.user.country === "New Zealand",
    JSON.stringify(cAkl.data.user && [cAkl.data.user.market, cAkl.data.user.country]));
  const cWgn = await quickClaim("wgnclaim@fixtures.dev", "wgnclaim", "wellington");
  check("claim link market=wellington (stable id) lands on Wellington / New Zealand",
    cWgn.status === 201 && !!cWgn.data.user && cWgn.data.user.market === "Wellington" && cWgn.data.user.country === "New Zealand",
    JSON.stringify(cWgn.data.user && [cWgn.data.user.market, cWgn.data.user.country]));
  const cChc = await quickClaim("chcclaim@fixtures.dev", "chcclaim", "Christchurch");
  check("claim link market=Christchurch lands (201, stored Christchurch / New Zealand)",
    cChc.status === 201 && !!cChc.data.user && cChc.data.user.market === "Christchurch" && cChc.data.user.country === "New Zealand",
    JSON.stringify(cChc.data.user && [cChc.data.user.market, cChc.data.user.country]));

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const marketsRes = await admin("GET", "/api/admin/markets");
  const rows = marketsRes.data.markets || [];
  check("admin markets list is 41 rows", rows.length === 41, String(rows.length));
  check("NZ rows are present, country New Zealand, NOT live (founding framing like every unlaunched market)",
    ["Auckland", "Wellington", "Christchurch"].every((n) => { const r = rows.find((x) => x.name === n); return !!r && r.country === "New Zealand" && r.live === false; }),
    JSON.stringify(rows.filter((r) => r.country === "New Zealand")));

  const rosterRes = await fetch(BASE + "/roster/auckland");
  const rosterText = await rosterRes.text();
  check("public roster: /roster/auckland below threshold is the friendly 404 (no thin page, no counts)",
    rosterRes.status === 404 && !rosterText.includes("listed creators"), String(rosterRes.status));
  const smRes = await fetch(BASE + "/sitemap.xml");
  const smText = await smRes.text();
  check("sitemap does not list the NZ roster pages before they qualify", smRes.status === 200 && !smText.includes("/roster/auckland") && !smText.includes("/roster/wellington") && !smText.includes("/roster/christchurch"), String(smRes.status));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build117: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
